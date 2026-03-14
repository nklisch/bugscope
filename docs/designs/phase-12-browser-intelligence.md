# Design: Phase 12 — Browser Lens: Intelligence

## Overview

Phase 12 adds the advanced investigation tools: diff two moments in a session, generate reproduction contexts and test scaffolds, expanded smart auto-detection rules, and HAR export for interop with existing tools. It also ships the Browser Lens SKILL.md for coding agents.

**Depends on:** Phase 11 (investigation tools, query engine, renderers)

---

## Implementation Units

### Unit 1: session_diff Tool

Compare two moments in a recorded session. "What changed between when the form loaded and when it was submitted?"

**File**: `src/browser/investigation/diff.ts`

```typescript
export interface DiffParams {
	sessionId: string;
	before: string; // timestamp or event_id
	after: string;  // timestamp or event_id
	include?: ("form_state" | "storage" | "url" | "console_new" | "network_new")[];
}

export interface DiffResult {
	beforeTime: number;
	afterTime: number;
	durationMs: number;

	// URL change
	urlChange?: { before: string; after: string };

	// Form state diff (if both moments have form_state events nearby)
	formChanges?: Array<{
		selector: string;
		before: string;
		after: string;
	}>;

	// Storage changes
	storageChanges?: Array<{
		key: string;
		type: "added" | "removed" | "changed";
		before?: string;
		after?: string;
	}>;

	// New console messages between the two moments
	newConsoleMessages?: Array<{
		timestamp: number;
		level: string;
		summary: string;
	}>;

	// Network requests that occurred between the two moments
	newNetworkRequests?: Array<{
		timestamp: number;
		summary: string;
	}>;
}

export class SessionDiffer {
	constructor(private queryEngine: QueryEngine) {}

	diff(params: DiffParams): DiffResult {
		const beforeTs = this.resolveTimestamp(params.sessionId, params.before);
		const afterTs = this.resolveTimestamp(params.sessionId, params.after);

		const result: DiffResult = {
			beforeTime: beforeTs,
			afterTime: afterTs,
			durationMs: afterTs - beforeTs,
		};

		const include = new Set(params.include ?? ["form_state", "storage", "url", "console_new", "network_new"]);

		// URL change — find navigation events at both moments
		if (include.has("url")) {
			const beforeNav = this.findNearestNavigation(params.sessionId, beforeTs);
			const afterNav = this.findNearestNavigation(params.sessionId, afterTs);
			if (beforeNav && afterNav && beforeNav !== afterNav) {
				result.urlChange = { before: beforeNav, after: afterNav };
			}
		}

		// Form state diff — find user_input events of type "change" or "submit"
		if (include.has("form_state")) {
			result.formChanges = this.diffFormState(params.sessionId, beforeTs, afterTs);
		}

		// Storage changes — find storage_change events between the two moments
		if (include.has("storage")) {
			result.storageChanges = this.diffStorage(params.sessionId, beforeTs, afterTs);
		}

		// New console messages
		if (include.has("console_new")) {
			const consoleEvents = this.queryEngine.search(params.sessionId, {
				filters: {
					eventTypes: ["console"],
					timeRange: { start: beforeTs, end: afterTs },
				},
				maxResults: 20,
			});
			result.newConsoleMessages = consoleEvents.map((e) => ({
				timestamp: e.timestamp,
				level: (e.summary.match(/^\[(\w+)\]/) ?? ["", "info"])[1],
				summary: e.summary,
			}));
		}

		// New network requests
		if (include.has("network_new")) {
			const networkEvents = this.queryEngine.search(params.sessionId, {
				filters: {
					eventTypes: ["network_request", "network_response"],
					timeRange: { start: beforeTs, end: afterTs },
				},
				maxResults: 20,
			});
			result.newNetworkRequests = networkEvents.map((e) => ({
				timestamp: e.timestamp,
				summary: e.summary,
			}));
		}

		return result;
	}

	private diffFormState(sessionId: string, before: number, after: number): DiffResult["formChanges"] {
		// Find all user_input "change" events between the two timestamps
		const changes = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["user_input"],
				timeRange: { start: before, end: after },
			},
			maxResults: 50,
		});

		// Build a map of field changes (selector → latest value)
		const fieldsBefore = new Map<string, string>();
		const fieldsAfter = new Map<string, string>();

		// Fields at "before" time — find the most recent change event before the timestamp
		// for each field
		const beforeChanges = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["user_input"],
				timeRange: { start: before - 600_000, end: before }, // Look back 10 min
			},
			maxResults: 100,
		});

		for (const e of beforeChanges) {
			const fullEvent = this.queryEngine.getFullEvent(sessionId, e.event_id);
			if (fullEvent?.data.type === "change" && fullEvent.data.selector) {
				fieldsBefore.set(fullEvent.data.selector as string, fullEvent.data.value as string);
			}
		}

		for (const e of changes) {
			const fullEvent = this.queryEngine.getFullEvent(sessionId, e.event_id);
			if (fullEvent?.data.type === "change" && fullEvent.data.selector) {
				fieldsAfter.set(fullEvent.data.selector as string, fullEvent.data.value as string);
			}
		}

		// Diff
		const result: NonNullable<DiffResult["formChanges"]> = [];
		const allSelectors = new Set([...fieldsBefore.keys(), ...fieldsAfter.keys()]);
		for (const selector of allSelectors) {
			const bv = fieldsBefore.get(selector) ?? "";
			const av = fieldsAfter.get(selector) ?? bv;
			if (bv !== av) {
				result.push({ selector, before: bv, after: av });
			}
		}

		return result.length > 0 ? result : undefined;
	}

	private resolveTimestamp(sessionId: string, ref: string): number {
		// If it looks like an ISO timestamp, parse it
		if (ref.includes("T") || ref.includes("-")) {
			return new Date(ref).getTime();
		}
		// If it looks like a time (HH:MM:SS), resolve relative to session start
		if (ref.match(/^\d{2}:\d{2}/)) {
			const session = this.queryEngine.getSession(sessionId);
			const sessionDate = new Date(session.startedAt).toISOString().slice(0, 10);
			return new Date(`${sessionDate}T${ref}`).getTime();
		}
		// Otherwise treat as event_id
		const event = this.queryEngine.getFullEvent(sessionId, ref);
		if (event) return event.timestamp;
		throw new Error(`Cannot resolve "${ref}" to a timestamp or event`);
	}
}
```

**Renderer:**

**File**: `src/browser/investigation/renderers.ts` (extend)

```typescript
export function renderDiff(diff: DiffResult, tokenBudget = 2000): string {
	const sections: RenderSection[] = [];

	// Header
	sections.push({
		key: "header",
		content: `Diff: ${formatTime(diff.beforeTime)} → ${formatTime(diff.afterTime)} (${formatDuration(diff.durationMs)})\n`,
		priority: 100,
	});

	// URL change
	if (diff.urlChange) {
		sections.push({
			key: "url",
			content: `URL: ${diff.urlChange.before} → ${diff.urlChange.after}\n`,
			priority: 90,
		});
	}

	// Form changes
	if (diff.formChanges && diff.formChanges.length > 0) {
		const lines = ["Form State Changes:"];
		for (const f of diff.formChanges) {
			lines.push(`  ${f.selector}  "${f.before}" → "${f.after}"`);
		}
		lines.push("");
		sections.push({ key: "form", content: lines.join("\n"), priority: 85 });
	}

	// Storage changes
	if (diff.storageChanges && diff.storageChanges.length > 0) {
		const lines = ["Storage Changes:"];
		for (const s of diff.storageChanges) {
			if (s.type === "added") lines.push(`  + ${s.key} = ${s.after}`);
			else if (s.type === "removed") lines.push(`  - ${s.key} (was: ${s.before})`);
			else lines.push(`  ~ ${s.key}: "${s.before}" → "${s.after}"`);
		}
		lines.push("");
		sections.push({ key: "storage", content: lines.join("\n"), priority: 70 });
	}

	// Console messages
	if (diff.newConsoleMessages && diff.newConsoleMessages.length > 0) {
		const lines = ["New Console Messages:"];
		for (const m of diff.newConsoleMessages) {
			lines.push(`  ${formatTime(m.timestamp)}  ${m.summary}`);
		}
		lines.push("");
		sections.push({ key: "console", content: lines.join("\n"), priority: 60 });
	}

	// Network activity
	if (diff.newNetworkRequests && diff.newNetworkRequests.length > 0) {
		const lines = [`Network Activity (${diff.newNetworkRequests.length} requests):`];
		for (const n of diff.newNetworkRequests) {
			lines.push(`  ${formatTime(n.timestamp)}  ${n.summary}`);
		}
		lines.push("");
		sections.push({ key: "network", content: lines.join("\n"), priority: 50 });
	}

	const included = fitToBudget(sections, tokenBudget);
	return included.map((s) => s.content).join("\n");
}
```

**MCP tool:**

```typescript
server.tool(
	"session_diff",
	"Compare two moments in a recorded browser session. Shows what changed between two " +
		"timestamps or events: URL, form state, storage, new console messages, and network activity. " +
		"Useful for understanding what happened between page load and an error.",
	{
		session_id: z.string().describe("Session ID"),
		before: z.string().describe("First moment — timestamp (ISO or HH:MM:SS) or event ID"),
		after: z.string().describe("Second moment — timestamp (ISO or HH:MM:SS) or event ID"),
		include: z.array(z.enum(["form_state", "storage", "url", "console_new", "network_new"]))
			.optional().describe("What to diff. Default: all"),
		token_budget: z.number().optional().describe("Max tokens. Default: 2000"),
	},
	async ({ session_id, before, after, include, token_budget }) => {
		// ...
	},
);
```

**Tests:** Unit tests for timestamp resolution, form state diffing, storage diffing. Integration test with a recorded session comparing form load vs submission.

---

### Unit 2: session_replay_context Tool

Generate reproduction contexts — everything an agent or developer needs to reproduce the issue.

**File**: `src/browser/investigation/replay-context.ts`

```typescript
export type ReplayFormat = "summary" | "reproduction_steps" | "test_scaffold" | "har";
export type TestFramework = "playwright" | "cypress";

export interface ReplayContextParams {
	sessionId: string;
	aroundMarker?: string;
	timeRange?: { start: number; end: number };
	format: ReplayFormat;
	testFramework?: TestFramework;
}

export class ReplayContextGenerator {
	constructor(private queryEngine: QueryEngine) {}

	generate(params: ReplayContextParams): string {
		switch (params.format) {
			case "summary":
				return this.generateSummary(params);
			case "reproduction_steps":
				return this.generateReproSteps(params);
			case "test_scaffold":
				return this.generateTestScaffold(params);
			case "har":
				throw new Error("HAR export uses a separate code path (Unit 5)");
		}
	}

	private generateSummary(params: ReplayContextParams): string {
		const { events, markers } = this.getRelevantEvents(params);

		const lines = ["## Session Summary\n"];

		// Navigation path
		const navEvents = events.filter((e) => e.type === "navigation");
		if (navEvents.length > 0) {
			lines.push("### Navigation Path");
			for (const e of navEvents) {
				lines.push(`- ${formatTime(e.timestamp)}: ${e.summary}`);
			}
			lines.push("");
		}

		// Errors
		const errors = events.filter((e) =>
			e.type === "page_error" ||
			(e.type === "console" && e.summary.startsWith("[error]")) ||
			(e.type === "network_response" && parseInt(e.summary, 10) >= 400),
		);
		if (errors.length > 0) {
			lines.push("### Errors");
			for (const e of errors) {
				lines.push(`- ${formatTime(e.timestamp)}: ${e.summary}`);
			}
			lines.push("");
		}

		// User actions
		const inputs = events.filter((e) => e.type === "user_input");
		if (inputs.length > 0) {
			lines.push("### User Actions");
			for (const e of inputs) {
				lines.push(`- ${formatTime(e.timestamp)}: ${e.summary}`);
			}
			lines.push("");
		}

		return lines.join("\n");
	}

	private generateReproSteps(params: ReplayContextParams): string {
		const { events, markers } = this.getRelevantEvents(params);

		const lines = ["## Reproduction Steps\n"];
		let stepNum = 1;

		// Build steps from navigation + user input events
		for (const e of events) {
			if (e.type === "navigation" && e.summary.startsWith("Navigated to")) {
				const url = e.summary.replace("Navigated to ", "");
				lines.push(`${stepNum++}. Navigate to ${url}`);
			} else if (e.type === "user_input") {
				const full = this.queryEngine.getFullEvent(params.sessionId, e.event_id);
				if (full) {
					if (full.data.type === "click") {
						lines.push(`${stepNum++}. Click ${full.data.selector} ("${full.data.text}")`);
					} else if (full.data.type === "change") {
						lines.push(`${stepNum++}. Set ${full.data.selector} to "${full.data.value}"`);
					} else if (full.data.type === "submit") {
						lines.push(`${stepNum++}. Submit form ${full.data.selector}`);
						// List field values
						const fields = full.data.fields as Record<string, string> | undefined;
						if (fields) {
							for (const [name, value] of Object.entries(fields)) {
								lines.push(`   - ${name}: "${value}"`);
							}
						}
					}
				}
			}
		}

		// Expected vs actual
		lines.push("");
		const errorEvents = events.filter((e) =>
			e.type === "page_error" ||
			(e.type === "network_response" && parseInt(e.summary, 10) >= 400),
		);
		if (errorEvents.length > 0) {
			lines.push(`${stepNum}. **Expected:** Operation succeeds`);
			lines.push(`${stepNum}. **Actual:** ${errorEvents[0].summary}`);
		}

		// Evidence
		if (errorEvents.length > 0) {
			lines.push("\n## Evidence\n");
			for (const e of errorEvents) {
				lines.push(`- ${e.summary} (event_id: ${e.event_id})`);
			}
		}

		return lines.join("\n");
	}

	private generateTestScaffold(params: ReplayContextParams): string {
		const { events } = this.getRelevantEvents(params);
		const framework = params.testFramework ?? "playwright";

		if (framework === "playwright") {
			return this.generatePlaywrightTest(events, params.sessionId);
		} else if (framework === "cypress") {
			return this.generateCypressTest(events, params.sessionId);
		}
		throw new Error(`Unsupported test framework: ${framework}`);
	}

	private generatePlaywrightTest(events: EventRow[], sessionId: string): string {
		const lines = [
			"import { test, expect } from '@playwright/test';",
			"",
			"test('reproduce issue from browser session', async ({ page }) => {",
		];

		for (const e of events) {
			if (e.type === "navigation" && e.summary.startsWith("Navigated to")) {
				const url = e.summary.replace("Navigated to ", "");
				lines.push(`\tawait page.goto('${url}');`);
			} else if (e.type === "user_input") {
				const full = this.queryEngine.getFullEvent(sessionId, e.event_id);
				if (full) {
					if (full.data.type === "click") {
						lines.push(`\tawait page.click('${full.data.selector}');`);
					} else if (full.data.type === "change") {
						lines.push(`\tawait page.fill('${full.data.selector}', '${full.data.value}');`);
					} else if (full.data.type === "submit") {
						const fields = full.data.fields as Record<string, string> | undefined;
						if (fields) {
							for (const [name, value] of Object.entries(fields)) {
								if (value !== "[MASKED]") {
									lines.push(`\tawait page.fill('[name="${name}"]', '${value}');`);
								}
							}
						}
						lines.push(`\tawait page.click('${full.data.selector} [type="submit"], ${full.data.selector} button');`);
					}
				}
			}
		}

		// Add assertion for the error
		const errorEvent = events.find((e) =>
			e.type === "network_response" && parseInt(e.summary, 10) >= 400,
		);
		if (errorEvent) {
			lines.push("");
			lines.push("\t// Verify the issue is fixed");
			lines.push("\t// TODO: Add appropriate assertion based on expected behavior");
		}

		lines.push("});");
		return lines.join("\n");
	}

	private generateCypressTest(events: EventRow[], sessionId: string): string {
		const lines = [
			"describe('reproduce issue from browser session', () => {",
			"\tit('should not reproduce the bug', () => {",
		];

		for (const e of events) {
			if (e.type === "navigation" && e.summary.startsWith("Navigated to")) {
				const url = e.summary.replace("Navigated to ", "");
				lines.push(`\t\tcy.visit('${url}');`);
			} else if (e.type === "user_input") {
				const full = this.queryEngine.getFullEvent(sessionId, e.event_id);
				if (full) {
					if (full.data.type === "click") {
						lines.push(`\t\tcy.get('${full.data.selector}').click();`);
					} else if (full.data.type === "change") {
						lines.push(`\t\tcy.get('${full.data.selector}').clear().type('${full.data.value}');`);
					} else if (full.data.type === "submit") {
						const fields = full.data.fields as Record<string, string> | undefined;
						if (fields) {
							for (const [name, value] of Object.entries(fields)) {
								if (value !== "[MASKED]") {
									lines.push(`\t\tcy.get('[name="${name}"]').clear().type('${value}');`);
								}
							}
						}
						lines.push(`\t\tcy.get('${full.data.selector}').submit();`);
					}
				}
			}
		}

		lines.push("\t});");
		lines.push("});");
		return lines.join("\n");
	}

	private getRelevantEvents(params: ReplayContextParams): { events: EventRow[]; markers: MarkerRow[] } {
		const markers = this.queryEngine.getMarkers(params.sessionId);
		let timeRange: { start: number; end: number };

		if (params.aroundMarker) {
			const marker = markers.find((m) => m.id === params.aroundMarker);
			if (!marker) throw new Error(`Marker ${params.aroundMarker} not found`);
			timeRange = {
				start: marker.timestamp - 120_000, // 2 minutes before
				end: marker.timestamp + 30_000,     // 30 seconds after
			};
		} else if (params.timeRange) {
			timeRange = params.timeRange;
		} else {
			// Default: entire session
			const session = this.queryEngine.getSession(params.sessionId);
			timeRange = {
				start: session.startedAt,
				end: session.endedAt ?? Date.now(),
			};
		}

		const events = this.queryEngine.search(params.sessionId, {
			filters: { timeRange },
			maxResults: 200,
		});

		return { events, markers };
	}
}
```

**MCP tool:**

```typescript
server.tool(
	"session_replay_context",
	"Generate a reproduction context from a recorded browser session. " +
		"Outputs reproduction steps, test scaffolds (Playwright or Cypress), or a summary. " +
		"Use this to create actionable artifacts from investigation findings.",
	{
		session_id: z.string().describe("Session ID"),
		around_marker: z.string().optional().describe("Focus on events around this marker"),
		time_range: z.object({
			start: z.string(),
			end: z.string(),
		}).optional().describe("Focus on a specific time window"),
		format: z.enum(["summary", "reproduction_steps", "test_scaffold"])
			.describe("Output format: 'summary' for overview, 'reproduction_steps' for step-by-step, 'test_scaffold' for automated test code"),
		test_framework: z.enum(["playwright", "cypress"]).optional()
			.describe("Test framework for scaffold generation. Default: playwright"),
	},
	// ...
);
```

**Tests:** Unit tests for each format output. Verify reproduction steps match the event sequence. Verify generated Playwright/Cypress code is syntactically valid.

---

### Unit 3: Expanded Auto-Detection Rules

**File**: `src/browser/recorder/auto-detect.ts` (extend)

Add more sophisticated detection rules beyond the basic ones from Phase 9.

```typescript
const PHASE_12_DETECTION_RULES: DetectionRule[] = [
	// Failed form submission heuristic:
	// submit event followed by 4xx response within 3 seconds
	{
		eventTypes: ["user_input"],
		condition: (event, recent) => {
			if (event.data.type !== "submit") return false;
			return recent.some((e) =>
				e.type === "network_response" &&
				parseInt(e.summary, 10) >= 400 &&
				e.timestamp - event.timestamp < 3000 &&
				e.timestamp >= event.timestamp,
			);
		},
		label: (event) => `Form submission failed: ${event.data.selector}`,
		severity: "high",
		cooldownMs: 5000,
	},

	// Rapid repeated requests (possible retry loop)
	{
		eventTypes: ["network_request"],
		condition: (event, recent) => {
			const sameUrl = recent.filter((e) =>
				e.type === "network_request" &&
				e.data.url === event.data.url &&
				event.timestamp - e.timestamp < 5000,
			);
			return sameUrl.length >= 3;
		},
		label: (event) => `Rapid retries: ${event.data.url} (${3}+ requests in 5s)`,
		severity: "medium",
		cooldownMs: 10000,
	},

	// Large layout shift (potential rendering bug)
	{
		eventTypes: ["performance"],
		condition: (event) =>
			event.data.metric === "CLS" && (event.data.value as number) > 0.25,
		label: (event) => `Large layout shift (CLS: ${event.data.value})`,
		severity: "low",
		cooldownMs: 30000,
	},

	// WebSocket connection error
	{
		eventTypes: ["websocket"],
		condition: (event) => event.data.type === "error" || event.data.type === "close",
		label: (event) => `WebSocket ${event.data.type}: ${event.data.url}`,
		severity: "medium",
		cooldownMs: 5000,
	},

	// Navigation to error page (common SPA patterns)
	{
		eventTypes: ["navigation"],
		condition: (event) => {
			const url = (event.data.url as string) ?? "";
			return /\/(error|404|500|oops|not-found)/i.test(url);
		},
		label: (event) => `Navigated to error page: ${event.data.url}`,
		severity: "high",
		cooldownMs: 5000,
	},
];
```

**Integration:**

Merge with the Phase 9 default rules:

```typescript
export const ALL_DETECTION_RULES = [
	...DEFAULT_DETECTION_RULES,
	...PHASE_12_DETECTION_RULES,
];
```

**Tests:** Unit tests for each new rule. Test the form submission heuristic with various timing scenarios.

---

### Unit 4: CLI Commands for Phase 12 Tools

**File**: `src/cli/commands/browser.ts` (extend)

```bash
# Diff two moments
krometrail browser diff <session_id> --before "14:31:45" --after "14:35:22" --include form_state

# Generate reproduction context
krometrail browser replay-context <session_id> --around-marker M1 --format reproduction_steps
krometrail browser replay-context <session_id> --around-marker M1 --format test_scaffold --framework playwright

# Export as HAR
krometrail browser export <session_id> --format har --output session.har
```

Implementation follows the same pattern as Phase 11 CLI commands: instantiate query engine, call the appropriate method, render output.

---

### Unit 5: HAR Export

**File**: `src/browser/export/har.ts`

Export a session as a standard HAR (HTTP Archive) file for compatibility with Chrome DevTools, Charles Proxy, and other network analysis tools.

```typescript
export interface HARExportOptions {
	sessionId: string;
	timeRange?: { start: number; end: number };
	includeResponseBodies?: boolean; // Default: true
}

export class HARExporter {
	constructor(private queryEngine: QueryEngine) {}

	export(options: HARExportOptions): HARFile {
		const session = this.queryEngine.getSession(options.sessionId);
		const networkRequests = this.queryEngine.search(options.sessionId, {
			filters: {
				eventTypes: ["network_request"],
				timeRange: options.timeRange,
			},
			maxResults: 10000,
		});

		const entries: HAREntry[] = [];

		for (const req of networkRequests) {
			const fullReq = this.queryEngine.getFullEvent(options.sessionId, req.event_id);
			if (!fullReq) continue;

			// Find matching response
			const responses = this.queryEngine.search(options.sessionId, {
				filters: {
					eventTypes: ["network_response"],
					timeRange: {
						start: fullReq.timestamp,
						end: fullReq.timestamp + 60_000,
					},
				},
				maxResults: 1,
			});

			const fullRes = responses[0]
				? this.queryEngine.getFullEvent(options.sessionId, responses[0].event_id)
				: null;

			// Load response body if requested
			let responseBody: string | undefined;
			if (options.includeResponseBodies !== false && fullRes) {
				const bodyRef = this.queryEngine.getNetworkBody(fullRes.id);
				if (bodyRef?.responseBodyPath) {
					responseBody = this.queryEngine.readNetworkBody(options.sessionId, bodyRef.responseBodyPath);
				}
			}

			entries.push(this.buildHAREntry(fullReq, fullRes, responseBody));
		}

		return {
			log: {
				version: "1.2",
				creator: { name: "Krometrail Browser", version: "1.0" },
				pages: [{
					startedDateTime: new Date(session.startedAt).toISOString(),
					id: session.id,
					title: session.tabTitle ?? session.tabUrl ?? "Unknown",
				}],
				entries,
			},
		};
	}

	private buildHAREntry(req: RecordedEvent, res: RecordedEvent | null, responseBody?: string): HAREntry {
		return {
			startedDateTime: new Date(req.timestamp).toISOString(),
			time: res ? (res.timestamp - req.timestamp) : 0,
			request: {
				method: req.data.method as string,
				url: req.data.url as string,
				httpVersion: "HTTP/1.1",
				headers: (req.data.headers as Array<{ name: string; value: string }>) ?? [],
				queryString: [],
				bodySize: req.data.postData ? (req.data.postData as string).length : 0,
				postData: req.data.postData ? {
					mimeType: "application/json",
					text: req.data.postData as string,
				} : undefined,
			},
			response: res ? {
				status: res.data.status as number,
				statusText: res.data.statusText as string ?? "",
				httpVersion: "HTTP/1.1",
				headers: (res.data.headers as Array<{ name: string; value: string }>) ?? [],
				content: {
					size: responseBody?.length ?? 0,
					mimeType: res.data.contentType as string ?? "text/plain",
					text: responseBody,
				},
				bodySize: responseBody?.length ?? 0,
			} : {
				status: 0,
				statusText: "No response",
				httpVersion: "HTTP/1.1",
				headers: [],
				content: { size: 0, mimeType: "text/plain" },
				bodySize: 0,
			},
			cache: {},
			timings: {
				send: 0,
				wait: res ? (res.timestamp - req.timestamp) : 0,
				receive: 0,
			},
		};
	}
}
```

**CLI:**

```bash
krometrail browser export <session_id> --format har --output session.har
krometrail browser export <session_id> --format har  # outputs to stdout
```

**Tests:** Generate a HAR file from fixture data, validate against the HAR 1.2 spec. Verify it opens in Chrome DevTools.

---

### Unit 6: Browser Lens SKILL.md

**File**: `src/browser/SKILL.md`

Shipped alongside the existing debug SKILL.md. Agents with filesystem access use this to guide their browser investigation workflow.

```markdown
## Browser Lens Investigation Workflow

When the user mentions a browser issue, bug, or unexpected behavior:

1. **Find the session:**
   `krometrail browser sessions --has-markers`
   Look for sessions with markers near the reported time.

2. **Get the overview:**
   `krometrail browser overview <session_id> --around-marker M1`
   Understand the navigation path, errors, and markers.

3. **Search for errors:**
   `krometrail browser search <session_id> --status-codes 400,422,500`
   Find network failures. Also try:
   `krometrail browser search <session_id> --query "validation error"`

4. **Inspect the problem moment:**
   `krometrail browser inspect <session_id> --marker M1 --include network_body,console_context`
   Get full request/response bodies, console output, and surrounding events.

5. **Compare before and after:**
   `krometrail browser diff <session_id> --before <load_time> --after <error_time> --include form_state`
   See what changed between page load and the error.

6. **Generate reproduction artifacts:**
   `krometrail browser replay-context <session_id> --around-marker M1 --format reproduction_steps`
   Or generate a test:
   `krometrail browser replay-context <session_id> --around-marker M1 --format test_scaffold --framework playwright`

### Tips
- Markers placed by the user are labeled [user]. Auto-detected markers are [auto].
- Use `--token-budget` to control response size (default: 3000 tokens for overview, 2000 for search).
- Event IDs from search results can be used with `--event <id>` in inspect.
- HAR export: `krometrail browser export <session_id> --format har --output debug.har`
```

---

## Testing

### Unit Tests

#### `tests/unit/browser/diff.test.ts`

- Diff with form state changes shows before/after values
- Diff with URL change shows navigation
- Diff with new console errors lists them
- Diff with no changes returns empty sections
- Timestamp resolution: ISO, HH:MM:SS, event_id all work

#### `tests/unit/browser/replay-context.test.ts`

- Summary format includes navigation, errors, user actions
- Reproduction steps format generates numbered steps from events
- Playwright scaffold generates syntactically valid test
- Cypress scaffold generates syntactically valid test
- Password fields are excluded from test scaffolds

#### `tests/unit/browser/har-export.test.ts`

- HAR output matches HAR 1.2 spec structure
- Request/response correlation is correct
- Response bodies are included when requested
- Missing responses produce valid "no response" entries

#### `tests/unit/browser/auto-detect-advanced.test.ts`

- Failed form submission heuristic fires correctly
- Rapid retry detection fires after 3+ requests
- Error page navigation detection works
- Cooldown prevents re-firing

### Integration Tests

#### `tests/integration/browser/intelligence.test.ts`

```typescript
describe.skipIf(!isChromeAvailable())("Browser intelligence", () => {
	// Setup: record a session with form submission + 422 error
	it("session_diff shows form state changes between load and submit");
	it("session_replay_context generates reproduction steps");
	it("session_replay_context generates Playwright test scaffold");
	it("HAR export produces valid HAR file");
	it("auto-detection catches failed form submission");
});
```

---

## Verification Checklist

```bash
# Lint
bun run lint

# Unit tests
bun run test tests/unit/browser/diff.test.ts
bun run test tests/unit/browser/replay-context.test.ts
bun run test tests/unit/browser/har-export.test.ts
bun run test tests/unit/browser/auto-detect-advanced.test.ts

# Integration tests (needs Chrome)
bun run test tests/integration/browser/intelligence.test.ts

# Manual verification
krometrail browser diff <session_id> --before "14:31:45" --after "14:35:22"
krometrail browser replay-context <session_id> --around-marker M1 --format reproduction_steps
krometrail browser replay-context <session_id> --around-marker M1 --format test_scaffold --framework playwright
krometrail browser export <session_id> --format har --output test.har
# Open test.har in Chrome DevTools → Network → Import
```

**Done when:** All 6 units are complete — `session_diff` and `session_replay_context` MCP tools work, auto-detection rules catch form submission failures, HAR export produces valid files, and the SKILL.md guides agents through the investigation workflow.
