# Design: Phase 11 — Browser Lens: Investigation MCP Tools

## Overview

Phase 11 adds the agent-facing investigation interface. Four MCP tools let agents query recorded browser sessions: list sessions, get overviews, search events, and inspect specific moments. Token-budgeted renderers present evidence compactly. CLI commands mirror the MCP tools for agents with filesystem access.

**Mental model:** Forensic analyst examining evidence, not robot clicking buttons.

**Depends on:** Phase 10 (SQLite index, JSONL storage, network body extraction)

---

## Architecture

### Tool Registration

Browser investigation tools register alongside existing `debug_*` tools in the same MCP server. They use a `session_` prefix to distinguish from debug tools.

```
src/
  browser/
    investigation/
      renderers.ts         # Token-budgeted output renderers
      query-engine.ts      # Wraps BrowserDatabase with higher-level query patterns
    types.ts               # Shared types (from Phase 9)
  mcp/
    tools/
      debug.ts             # Existing debug_* tools (unchanged)
      browser.ts           # New session_* tools
  cli/
    commands/
      browser.ts           # Extended with investigation subcommands
```

### Tool Surface

| Tool | Purpose | Primary Query |
|---|---|---|
| `session_list` | Find recorded sessions | `SELECT * FROM sessions` with filters |
| `session_overview` | Table of contents for a session | Aggregation + timeline rendering |
| `session_search` | Find specific events | FTS5 + structured filters |
| `session_inspect` | Deep-dive into a moment | Byte-offset JSONL read + surrounding context |

These 4 tools cover the core investigation flow. `session_diff` and `session_replay_context` are Phase 12.

---

## Implementation Units

### Unit 1: Query Engine

**File**: `src/browser/investigation/query-engine.ts`

Higher-level query interface on top of `BrowserDatabase`. Handles the composition of SQLite queries + JSONL reads + network body loading.

```typescript
export class QueryEngine {
	constructor(
		private db: BrowserDatabase,
		private dataDir: string,
	) {}

	// --- Session queries ---

	listSessions(filter?: SessionListFilter): SessionSummary[] {
		const rows = this.db.listSessions(filter);
		return rows.map((row) => ({
			id: row.id,
			startedAt: row.started_at,
			duration: (row.ended_at ?? Date.now()) - row.started_at,
			url: row.tab_url,
			title: row.tab_title,
			eventCount: row.event_count,
			markerCount: row.marker_count,
			errorCount: row.error_count,
		}));
	}

	// --- Overview queries ---

	getOverview(sessionId: string, options?: OverviewOptions): SessionOverview {
		const session = this.db.getSession(sessionId);
		const markers = this.db.queryMarkers(sessionId);

		const result: SessionOverview = {
			session: { id: session.id, startedAt: session.started_at, url: session.tab_url, title: session.tab_title },
			markers,
			timeline: [],
			networkSummary: null,
			errorSummary: null,
		};

		// Navigation timeline
		if (!options?.include || options.include.includes("timeline")) {
			result.timeline = this.db.queryEvents(sessionId, {
				types: ["navigation", "marker"],
				limit: 50,
			});
		}

		// Network summary
		if (!options?.include || options.include.includes("network_summary")) {
			const allNetwork = this.db.queryEvents(sessionId, {
				types: ["network_response"],
			});
			result.networkSummary = this.summarizeNetwork(allNetwork);
		}

		// Error summary
		if (!options?.include || options.include.includes("errors")) {
			result.errorSummary = this.db.queryEvents(sessionId, {
				types: ["network_response", "page_error", "console"],
			}).filter((e) => this.isErrorEvent(e));
		}

		// Time range focus
		if (options?.aroundMarker) {
			const marker = markers.find((m) => m.id === options.aroundMarker);
			if (marker) {
				const padding = 60_000; // ±60 seconds for overview
				result.timeline = result.timeline.filter(
					(e) => Math.abs(e.timestamp - marker.timestamp) <= padding,
				);
			}
		}

		return result;
	}

	// --- Search queries ---

	search(sessionId: string, params: SearchParams): SearchResult[] {
		if (params.query) {
			// FTS search
			return this.db.searchFTS(sessionId, params.query, params.maxResults ?? 10);
		}

		// Structured filter search
		return this.db.queryEvents(sessionId, {
			types: params.filters?.eventTypes,
			timeRange: params.filters?.timeRange,
			statusCodes: params.filters?.statusCodes,
			limit: params.maxResults ?? 10,
		});
	}

	// --- Inspect queries ---

	inspect(sessionId: string, params: InspectParams): InspectResult {
		const session = this.db.getSession(sessionId);
		const recordingDir = session.recording_dir;

		// Resolve the target event
		let targetEvent: EventRow;
		if (params.eventId) {
			targetEvent = this.db.getEventById(sessionId, params.eventId);
		} else if (params.markerId) {
			const marker = this.db.getMarkerById(params.markerId);
			// Find the closest event to the marker timestamp
			const events = this.db.queryEvents(sessionId, {
				timeRange: { start: marker.timestamp - 1000, end: marker.timestamp + 1000 },
				limit: 1,
			});
			targetEvent = events[0];
		} else if (params.timestamp) {
			const events = this.db.queryEvents(sessionId, {
				timeRange: { start: params.timestamp - 500, end: params.timestamp + 500 },
				limit: 1,
			});
			targetEvent = events[0];
		} else {
			throw new Error("Must provide event_id, marker_id, or timestamp");
		}

		// Read full event detail from JSONL
		const fullEvent = EventWriter.readAt(
			resolve(recordingDir, "events.jsonl"),
			targetEvent.detail_offset,
			targetEvent.detail_length,
		);

		const result: InspectResult = {
			event: fullEvent,
			surroundingEvents: [],
			networkBody: null,
			screenshot: null,
		};

		// Surrounding context
		if (params.include?.includes("surrounding_events")) {
			const windowMs = (params.contextWindow ?? 5) * 1000;
			result.surroundingEvents = this.db.queryEvents(sessionId, {
				timeRange: {
					start: fullEvent.timestamp - windowMs,
					end: fullEvent.timestamp + windowMs,
				},
				limit: 20,
			});
		}

		// Network body
		if (params.include?.includes("network_body")) {
			const bodyRef = this.db.getNetworkBody(targetEvent.event_id);
			if (bodyRef) {
				if (bodyRef.response_body_path) {
					const bodyPath = resolve(recordingDir, "network", bodyRef.response_body_path);
					if (existsSync(bodyPath)) {
						result.networkBody = {
							response: readFileSync(bodyPath, "utf-8"),
							contentType: bodyRef.content_type,
							size: bodyRef.response_size,
						};
					}
				}
				if (bodyRef.request_body_path) {
					const bodyPath = resolve(recordingDir, "network", bodyRef.request_body_path);
					if (existsSync(bodyPath)) {
						result.networkBody = result.networkBody ?? {};
						result.networkBody.request = readFileSync(bodyPath, "utf-8");
					}
				}
			}
		}

		// Nearest screenshot
		if (params.include?.includes("screenshot")) {
			const screenshotDir = resolve(recordingDir, "screenshots");
			if (existsSync(screenshotDir)) {
				const files = readdirSync(screenshotDir).sort();
				// Find nearest screenshot by timestamp
				const targetTs = fullEvent.timestamp;
				let nearest = files[0];
				let nearestDist = Infinity;
				for (const f of files) {
					const ts = parseInt(f.replace(".png", ""), 10);
					const dist = Math.abs(ts - targetTs);
					if (dist < nearestDist) {
						nearest = f;
						nearestDist = dist;
					}
				}
				if (nearest) {
					result.screenshot = resolve(screenshotDir, nearest);
				}
			}
		}

		return result;
	}

	private summarizeNetwork(events: EventRow[]): NetworkSummary {
		let total = 0;
		let succeeded = 0;
		let failed = 0;
		const notable: string[] = [];

		for (const e of events) {
			total++;
			// Parse status from summary (format: "200 GET /path (143ms)")
			const status = parseInt(e.summary, 10);
			if (status >= 400) {
				failed++;
				notable.push(e.summary);
			} else {
				succeeded++;
			}
		}

		return { total, succeeded, failed, notable };
	}

	private isErrorEvent(e: EventRow): boolean {
		if (e.type === "page_error") return true;
		if (e.type === "console" && e.summary.startsWith("[error]")) return true;
		if (e.type === "network_response") {
			const status = parseInt(e.summary, 10);
			return status >= 400;
		}
		return false;
	}
}

// --- Query types ---

export interface SessionListFilter {
	after?: number;
	before?: number;
	urlContains?: string;
	hasMarkers?: boolean;
	hasErrors?: boolean;
	limit?: number;
}

export interface OverviewOptions {
	include?: ("timeline" | "markers" | "errors" | "network_summary")[];
	aroundMarker?: string;
	timeRange?: { start: number; end: number };
}

export interface SearchParams {
	query?: string;
	filters?: {
		eventTypes?: string[];
		statusCodes?: number[];
		urlPattern?: string;
		consoleLevels?: string[];
		timeRange?: { start: number; end: number };
		containsText?: string;
	};
	maxResults?: number;
}

export interface InspectParams {
	eventId?: string;
	markerId?: string;
	timestamp?: number;
	include?: ("surrounding_events" | "network_body" | "screenshot" | "form_state" | "console_context")[];
	contextWindow?: number; // seconds
}

// --- Result types ---

export interface SessionSummary {
	id: string;
	startedAt: number;
	duration: number;
	url: string;
	title: string;
	eventCount: number;
	markerCount: number;
	errorCount: number;
}

export interface SessionOverview {
	session: { id: string; startedAt: number; url: string; title: string };
	markers: MarkerRow[];
	timeline: EventRow[];
	networkSummary: NetworkSummary | null;
	errorSummary: EventRow[] | null;
}

export interface NetworkSummary {
	total: number;
	succeeded: number;
	failed: number;
	notable: string[];
}

export interface InspectResult {
	event: RecordedEvent;
	surroundingEvents: EventRow[];
	networkBody: { request?: string; response?: string; contentType?: string; size?: number } | null;
	screenshot: string | null; // file path
}
```

**Tests:** Unit tests with pre-populated SQLite + JSONL. Test each query method with various filter combinations.

---

### Unit 2: Browser Viewport Renderers

**File**: `src/browser/investigation/renderers.ts`

Token-budgeted renderers that format investigation results for agent consumption. Uses `fitToBudget` and `estimateTokens` from `src/core/token-budget.ts`.

```typescript
import { estimateTokens, fitToBudget, truncateToTokens, type RenderSection } from "../../core/token-budget.js";

/**
 * Render a session list for the agent.
 */
export function renderSessionList(sessions: SessionSummary[]): string {
	if (sessions.length === 0) return "No recorded sessions found.";

	const lines: string[] = [`Sessions (${sessions.length}):\n`];
	for (const s of sessions) {
		const duration = formatDuration(s.duration);
		const markers = s.markerCount > 0 ? `, ${s.markerCount} markers` : "";
		const errors = s.errorCount > 0 ? `, ${s.errorCount} errors` : "";
		lines.push(`  ${s.id}  ${formatTime(s.startedAt)}  ${duration}  ${s.url}  (${s.eventCount} events${markers}${errors})`);
	}
	return lines.join("\n");
}

/**
 * Render a session overview with token budgeting.
 * Sections are prioritized: markers > errors > timeline > network summary.
 */
export function renderSessionOverview(overview: SessionOverview, tokenBudget = 3000): string {
	const sections: RenderSection[] = [];

	// Header (always included, highest priority)
	const header = [
		`Session: ${overview.session.id}`,
		`URL: ${overview.session.url}`,
		`Started: ${formatTime(overview.session.startedAt)}`,
		"",
	].join("\n");
	sections.push({ key: "header", content: header, priority: 100 });

	// Markers (high priority — this is what the agent is usually looking for)
	if (overview.markers.length > 0) {
		const markerLines = ["Markers:"];
		for (const m of overview.markers) {
			const prefix = m.auto_detected ? "[auto]" : "[user]";
			const sev = m.severity ? ` (${m.severity})` : "";
			markerLines.push(`  ${prefix} ${formatTime(m.timestamp)} — ${m.label ?? "unmarked"}${sev}`);
		}
		markerLines.push("");
		sections.push({ key: "markers", content: markerLines.join("\n"), priority: 90 });
	}

	// Errors (high priority)
	if (overview.errorSummary && overview.errorSummary.length > 0) {
		const errorLines = ["Errors:"];
		for (const e of overview.errorSummary.slice(0, 10)) {
			errorLines.push(`  ${formatTime(e.timestamp)}  [${e.type}] ${e.summary}`);
		}
		if (overview.errorSummary.length > 10) {
			errorLines.push(`  (${overview.errorSummary.length - 10} more...)`);
		}
		errorLines.push("");
		sections.push({ key: "errors", content: errorLines.join("\n"), priority: 80 });
	}

	// Navigation timeline (medium priority)
	if (overview.timeline.length > 0) {
		const timelineLines = ["Timeline:"];
		for (const e of overview.timeline) {
			const marker = e.type === "marker" ? " ← MARKER" : "";
			timelineLines.push(`  ${formatTime(e.timestamp)}  ${e.summary}${marker}`);
		}
		timelineLines.push("");
		sections.push({ key: "timeline", content: timelineLines.join("\n"), priority: 60 });
	}

	// Network summary (lower priority)
	if (overview.networkSummary) {
		const ns = overview.networkSummary;
		const netLines = [
			`Network: ${ns.total} requests | ${ns.succeeded} succeeded | ${ns.failed} failed`,
		];
		if (ns.notable.length > 0) {
			netLines.push("Notable:");
			for (const n of ns.notable.slice(0, 5)) {
				netLines.push(`  ${n}`);
			}
		}
		netLines.push("");
		sections.push({ key: "network", content: netLines.join("\n"), priority: 40 });
	}

	const included = fitToBudget(sections, tokenBudget);
	return included.map((s) => s.content).join("\n");
}

/**
 * Render search results with token budgeting.
 */
export function renderSearchResults(results: EventRow[], tokenBudget = 2000): string {
	if (results.length === 0) return "No matching events found.";

	const lines: string[] = [`Found ${results.length} events:\n`];
	let tokens = estimateTokens(lines[0]);

	for (const r of results) {
		const line = `  ${formatTime(r.timestamp)}  [${r.type}] ${r.summary}  (id: ${r.event_id})`;
		const lineTokens = estimateTokens(line);
		if (tokens + lineTokens > tokenBudget) {
			lines.push(`  ... (${results.length - lines.length + 1} more results)`);
			break;
		}
		lines.push(line);
		tokens += lineTokens;
	}

	return lines.join("\n");
}

/**
 * Render a detailed event inspection with token budgeting.
 */
export function renderInspectResult(result: InspectResult, tokenBudget = 3000): string {
	const sections: RenderSection[] = [];

	// Event detail (highest priority)
	const event = result.event;
	const eventLines = [
		`Event: ${event.summary}`,
		`Type: ${event.type}`,
		`Time: ${formatTime(event.timestamp)}`,
		`ID: ${event.id}`,
	];

	// Add type-specific detail
	if (event.type === "network_request" || event.type === "network_response") {
		if (event.data.method) eventLines.push(`Method: ${event.data.method}`);
		if (event.data.url) eventLines.push(`URL: ${event.data.url}`);
		if (event.data.status) eventLines.push(`Status: ${event.data.status}`);
		if (event.data.durationMs) eventLines.push(`Duration: ${event.data.durationMs}ms`);
	}
	if (event.type === "console" || event.type === "page_error") {
		if (event.data.stackTrace) eventLines.push(`Stack: ${event.data.stackTrace}`);
	}
	eventLines.push("");
	sections.push({ key: "event", content: eventLines.join("\n"), priority: 100 });

	// Network body (high priority — often the key evidence)
	if (result.networkBody) {
		const bodyLines = [];
		if (result.networkBody.request) {
			bodyLines.push("Request Body:");
			bodyLines.push(truncateToTokens(result.networkBody.request, 500));
			bodyLines.push("");
		}
		if (result.networkBody.response) {
			bodyLines.push(`Response Body (${result.networkBody.contentType ?? "unknown"}, ${result.networkBody.size ?? 0} bytes):`);
			bodyLines.push(truncateToTokens(result.networkBody.response, 800));
			bodyLines.push("");
		}
		if (bodyLines.length > 0) {
			sections.push({ key: "body", content: bodyLines.join("\n"), priority: 90 });
		}
	}

	// Surrounding events (medium priority — context)
	if (result.surroundingEvents.length > 0) {
		const ctxLines = [`Context (${result.surroundingEvents.length} events ±5s):`];
		for (const e of result.surroundingEvents) {
			const isCurrent = e.event_id === result.event.id;
			const prefix = isCurrent ? "→" : " ";
			ctxLines.push(`  ${prefix} ${formatTime(e.timestamp)}  [${e.type}] ${e.summary}`);
		}
		ctxLines.push("");
		sections.push({ key: "context", content: ctxLines.join("\n"), priority: 60 });
	}

	// Screenshot reference (low priority)
	if (result.screenshot) {
		sections.push({
			key: "screenshot",
			content: `Screenshot: ${result.screenshot}\n`,
			priority: 20,
		});
	}

	const included = fitToBudget(sections, tokenBudget);
	return included.map((s) => s.content).join("\n");
}

// --- Helpers ---

function formatTime(ts: number): string {
	return new Date(ts).toISOString().slice(11, 23); // HH:mm:ss.SSS
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}
```

**Token budget strategy:**

Each renderer accepts a `tokenBudget` parameter. Sections are assigned priorities:
- **100:** Event detail / header (always included)
- **90:** Network bodies, markers (key evidence)
- **80:** Errors
- **60:** Timeline, surrounding events (context)
- **40:** Network summary
- **20:** Screenshot references

`fitToBudget` from `core/token-budget.ts` includes highest-priority sections first, dropping lower-priority ones when the budget is exceeded. Sections are returned in their original display order for readable output.

**Tests:** Unit tests for each renderer with various data sizes and token budgets. Verify truncation, priority ordering, edge cases (empty results, single event, etc.).

---

### Unit 3: MCP Tool Registration

**File**: `src/mcp/tools/browser.ts`

Register 4 browser investigation tools with the MCP server.

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { QueryEngine } from "../../browser/investigation/query-engine.js";
import {
	renderSessionList,
	renderSessionOverview,
	renderSearchResults,
	renderInspectResult,
} from "../../browser/investigation/renderers.js";

export function registerBrowserTools(server: McpServer, queryEngine: QueryEngine): void {

	// Tool 1: session_list
	server.tool(
		"session_list",
		"List recorded browser sessions. Use this to find sessions to investigate. " +
			"Filter by time, URL, or whether the session has markers/errors.",
		{
			after: z.string().optional().describe("ISO timestamp — only sessions after this time"),
			before: z.string().optional().describe("ISO timestamp — only sessions before this time"),
			url_contains: z.string().optional().describe("Filter by URL pattern"),
			has_markers: z.boolean().optional().describe("Only sessions with user-placed markers"),
			has_errors: z.boolean().optional().describe("Only sessions with captured errors (4xx/5xx, exceptions, console errors)"),
			limit: z.number().optional().describe("Max results. Default: 10"),
		},
		async ({ after, before, url_contains, has_markers, has_errors, limit }) => {
			try {
				const sessions = queryEngine.listSessions({
					after: after ? new Date(after).getTime() : undefined,
					before: before ? new Date(before).getTime() : undefined,
					urlContains: url_contains,
					hasMarkers: has_markers,
					hasErrors: has_errors,
					limit: limit ?? 10,
				});
				return { content: [{ type: "text" as const, text: renderSessionList(sessions) }] };
			} catch (err) {
				return errorResponse(err);
			}
		},
	);

	// Tool 2: session_overview
	server.tool(
		"session_overview",
		"Get a structured overview of a recorded browser session — navigation timeline, markers, " +
			"errors, and network summary. Use this to understand what happened before diving into details. " +
			"Focus on a specific marker with around_marker.",
		{
			session_id: z.string().describe("Session ID from session_list"),
			include: z.array(z.enum(["timeline", "markers", "errors", "network_summary"]))
				.optional()
				.describe("What to include. Default: all"),
			around_marker: z.string().optional().describe("Center overview on this marker ID"),
			time_range: z.object({
				start: z.string().describe("ISO timestamp"),
				end: z.string().describe("ISO timestamp"),
			}).optional().describe("Focus on a specific time window"),
			token_budget: z.number().optional().describe("Max tokens for the response. Default: 3000"),
		},
		async ({ session_id, include, around_marker, time_range, token_budget }) => {
			try {
				const overview = queryEngine.getOverview(session_id, {
					include: include as OverviewOptions["include"],
					aroundMarker: around_marker,
					timeRange: time_range
						? { start: new Date(time_range.start).getTime(), end: new Date(time_range.end).getTime() }
						: undefined,
				});
				return {
					content: [{ type: "text" as const, text: renderSessionOverview(overview, token_budget ?? 3000) }],
				};
			} catch (err) {
				return errorResponse(err);
			}
		},
	);

	// Tool 3: session_search
	server.tool(
		"session_search",
		"Search recorded browser session events. Supports natural language search (uses FTS5) " +
			"and structured filters (event type, status code, time range). " +
			"Use natural language for exploratory search, structured filters for precise queries.",
		{
			session_id: z.string().describe("Session ID"),
			query: z.string().optional().describe("Natural language search query, e.g. 'validation error' or 'phone format'"),
			event_types: z.array(z.enum([
				"navigation", "network_request", "network_response", "console",
				"page_error", "user_input", "websocket", "performance", "marker",
			])).optional().describe("Filter by event type"),
			status_codes: z.array(z.number()).optional().describe("Filter network responses by HTTP status code, e.g. [400, 422, 500]"),
			time_range: z.object({
				start: z.string().describe("ISO timestamp"),
				end: z.string().describe("ISO timestamp"),
			}).optional().describe("Filter by time window"),
			max_results: z.number().optional().describe("Max results. Default: 10"),
			token_budget: z.number().optional().describe("Max tokens for the response. Default: 2000"),
		},
		async ({ session_id, query, event_types, status_codes, time_range, max_results, token_budget }) => {
			try {
				const results = queryEngine.search(session_id, {
					query,
					filters: {
						eventTypes: event_types,
						statusCodes: status_codes,
						timeRange: time_range
							? { start: new Date(time_range.start).getTime(), end: new Date(time_range.end).getTime() }
							: undefined,
					},
					maxResults: max_results ?? 10,
				});
				return {
					content: [{ type: "text" as const, text: renderSearchResults(results, token_budget ?? 2000) }],
				};
			} catch (err) {
				return errorResponse(err);
			}
		},
	);

	// Tool 4: session_inspect
	server.tool(
		"session_inspect",
		"Deep-dive into a specific event or moment in a recorded browser session. " +
			"Returns full event detail, network request/response bodies, surrounding events, " +
			"and nearest screenshot. This is the primary evidence-gathering tool.",
		{
			session_id: z.string().describe("Session ID"),
			event_id: z.string().optional().describe("Specific event ID (from session_search results)"),
			marker_id: z.string().optional().describe("Jump to a marker"),
			timestamp: z.string().optional().describe("ISO timestamp — inspect the moment closest to this time"),
			include: z.array(z.enum([
				"surrounding_events", "network_body", "screenshot",
				"form_state", "console_context",
			])).optional().describe("What to include alongside the event detail. Default: all"),
			context_window: z.number().optional().describe("Seconds of surrounding events to include. Default: 5"),
			token_budget: z.number().optional().describe("Max tokens for the response. Default: 3000"),
		},
		async ({ session_id, event_id, marker_id, timestamp, include, context_window, token_budget }) => {
			try {
				const result = queryEngine.inspect(session_id, {
					eventId: event_id,
					markerId: marker_id,
					timestamp: timestamp ? new Date(timestamp).getTime() : undefined,
					include: include as InspectParams["include"],
					contextWindow: context_window ?? 5,
				});
				return {
					content: [{ type: "text" as const, text: renderInspectResult(result, token_budget ?? 3000) }],
				};
			} catch (err) {
				return errorResponse(err);
			}
		},
	);
}

function errorResponse(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
	const message = err instanceof Error ? err.message : String(err);
	return { content: [{ type: "text" as const, text: message }], isError: true };
}
```

**MCP server integration:**

In `src/mcp/index.ts`, register browser tools alongside debug tools:

```typescript
import { registerTools } from "./tools/debug.js";
import { registerBrowserTools } from "./tools/browser.js";

// ... server setup ...
registerTools(server, sessionManager);

// Browser tools (only if browser data directory exists)
if (browserQueryEngine) {
	registerBrowserTools(server, browserQueryEngine);
}
```

The `QueryEngine` is instantiated when the MCP server starts, pointing at `~/.krometrail/browser/index.db`. If the database doesn't exist (user hasn't used Browser Lens yet), the tools are still registered but return "No recordings found."

**Tests:** E2E tests via MCP client. Pre-populate a test database with fixture data, call each tool, verify response format.

---

### Unit 4: CLI Investigation Commands

**File**: `src/cli/commands/browser.ts` (extend)

Add investigation subcommands to the existing browser CLI.

```typescript
// krometrail browser sessions [--has-markers] [--has-errors] [--after <date>]
// krometrail browser overview <session_id> [--around-marker <id>] [--budget <tokens>]
// krometrail browser search <session_id> --query "validation error"
// krometrail browser search <session_id> --status-codes 422,500
// krometrail browser inspect <session_id> --marker <id> --include network_body,console_context
// krometrail browser inspect <session_id> --event <id>
// krometrail browser inspect <session_id> --timestamp "14:35:22"
```

Each CLI command:
1. Instantiates `QueryEngine` with the database path
2. Calls the appropriate query method
3. Renders with the same renderer functions used by MCP tools
4. Outputs to stdout (or `--json` for structured output)

```typescript
const sessionsCommand = defineCommand({
	meta: { name: "sessions", description: "List recorded browser sessions" },
	args: {
		"has-markers": { type: "boolean", description: "Only sessions with markers" },
		"has-errors": { type: "boolean", description: "Only sessions with errors" },
		after: { type: "string", description: "Only sessions after this date" },
		before: { type: "string", description: "Only sessions before this date" },
		limit: { type: "string", description: "Max results (default: 10)" },
		json: { type: "boolean", description: "JSON output" },
	},
	async run({ args }) {
		const engine = createQueryEngine();
		const sessions = engine.listSessions({
			hasMarkers: args["has-markers"],
			hasErrors: args["has-errors"],
			after: args.after ? new Date(args.after).getTime() : undefined,
			before: args.before ? new Date(args.before).getTime() : undefined,
			limit: args.limit ? parseInt(args.limit, 10) : 10,
		});

		if (args.json) {
			console.log(JSON.stringify(sessions, null, 2));
		} else {
			console.log(renderSessionList(sessions));
		}
	},
});

const overviewCommand = defineCommand({
	meta: { name: "overview", description: "Get session overview" },
	args: {
		id: { type: "positional", description: "Session ID", required: true },
		"around-marker": { type: "string", description: "Center on marker ID" },
		budget: { type: "string", description: "Token budget (default: 3000)" },
		json: { type: "boolean", description: "JSON output" },
	},
	async run({ args }) {
		const engine = createQueryEngine();
		const overview = engine.getOverview(args.id, {
			aroundMarker: args["around-marker"],
		});

		if (args.json) {
			console.log(JSON.stringify(overview, null, 2));
		} else {
			console.log(renderSessionOverview(overview, parseInt(args.budget ?? "3000", 10)));
		}
	},
});

// Similar for searchCommand, inspectCommand
```

**Tests:** CLI output tests. Pre-populate database, run CLI commands, verify stdout format.

---

### Unit 5: Daemon RPC Methods

Add daemon RPC methods for browser investigation (alongside the Phase 9 recording RPCs).

```typescript
// In daemon protocol:
"browser.sessions": { params: SessionListFilter; result: SessionSummary[] };
"browser.overview": { params: { sessionId: string; options?: OverviewOptions }; result: string };
"browser.search": { params: { sessionId: string; params: SearchParams }; result: string };
"browser.inspect": { params: { sessionId: string; params: InspectParams }; result: string };
```

The daemon hosts both the `QueryEngine` and the `BrowserRecorder`. Investigation queries go through the daemon to access the shared database. The CLI commands call these RPC methods rather than opening the database directly — this avoids SQLite locking issues between the recorder (writing) and the CLI (reading).

**Tests:** RPC round-trip tests via daemon client.

---

## Testing

### Unit Tests

#### `tests/unit/browser/query-engine.test.ts`

Pre-populate a test database with fixture data:

- 2 sessions (one with markers, one without)
- 50+ events across types (network, console, navigation, user_input)
- 3 markers (2 auto-detected, 1 user-placed)
- Network bodies for 5 network events

Test each query method:
- `listSessions` with each filter combination
- `getOverview` with and without marker focus
- `search` with FTS query
- `search` with structured filters (type, status code, time range)
- `inspect` by event_id, marker_id, timestamp
- `inspect` with network body loading
- `inspect` with surrounding events

#### `tests/unit/browser/renderers.test.ts`

- `renderSessionList` formats correctly, handles empty list
- `renderSessionOverview` respects token budget, drops low-priority sections
- `renderSearchResults` truncates at token budget with "more results" message
- `renderInspectResult` includes event detail, network body, context
- `renderInspectResult` drops screenshot reference when budget is tight
- All renderers produce clean, readable output

### Integration Tests

#### `tests/integration/browser/investigation.test.ts`

```typescript
describe.skipIf(!isChromeAvailable())("Browser investigation", () => {
	// Setup: record a session with the test fixture, place a marker
	beforeAll(async () => {
		// Launch Chrome, load test page, click around, trigger a 422
		// Place a marker, wait for persistence
	});

	it("session_list returns the recorded session");
	it("session_overview shows navigation timeline and markers");
	it("session_overview respects around_marker focus");
	it("session_search finds events by FTS query");
	it("session_search filters by status code");
	it("session_inspect returns full network request/response bodies");
	it("session_inspect includes surrounding events");
	it("session_inspect returns nearest screenshot path");
});
```

### E2E Tests

#### `tests/e2e/mcp/browser-investigation.test.ts`

Full MCP tool flow using the SDK client:

1. Pre-populate test database
2. `session_list` — verify session returned
3. `session_overview` — verify markers and errors present
4. `session_search` with `status_codes: [422]` — verify failed request found
5. `session_inspect` with the found event ID — verify response body included
6. Verify all responses are within token budgets

---

## Verification Checklist

```bash
# Lint
bun run lint

# Unit tests
bun run test tests/unit/browser/query-engine.test.ts
bun run test tests/unit/browser/renderers.test.ts

# Integration tests (needs Chrome + recorded session)
bun run test tests/integration/browser/investigation.test.ts

# E2E tests
bun run test tests/e2e/mcp/browser-investigation.test.ts

# Manual verification
# (Assumes Phase 9+10 are complete with a recorded session)
krometrail browser sessions --has-markers
krometrail browser overview <session_id> --around-marker M1
krometrail browser search <session_id> --query "validation error"
krometrail browser inspect <session_id> --marker M1 --include network_body,console_context
```

**Done when:** All 4 MCP tools are registered, produce token-budgeted output, and the CLI mirrors the tool surface. An agent can list sessions, get an overview, search for errors, and inspect specific moments with full network body evidence.
