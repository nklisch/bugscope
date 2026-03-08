import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InspectParams, OverviewOptions, QueryEngine } from "../../browser/investigation/query-engine.js";
import { renderInspectResult, renderSearchResults, renderSessionList, renderSessionOverview } from "../../browser/investigation/renderers.js";

export function registerBrowserTools(server: McpServer, queryEngine: QueryEngine): void {
	// Tool 1: session_list
	server.tool(
		"session_list",
		"List recorded browser sessions. Use this to find sessions to investigate. " + "Filter by time, URL, or whether the session has markers/errors.",
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
			include: z
				.array(z.enum(["timeline", "markers", "errors", "network_summary"]))
				.optional()
				.describe("What to include. Default: all"),
			around_marker: z.string().optional().describe("Center overview on this marker ID"),
			time_range: z
				.object({
					start: z.string().describe("ISO timestamp"),
					end: z.string().describe("ISO timestamp"),
				})
				.optional()
				.describe("Focus on a specific time window"),
			token_budget: z.number().optional().describe("Max tokens for the response. Default: 3000"),
		},
		async ({ session_id, include, around_marker, time_range, token_budget }) => {
			try {
				const overview = queryEngine.getOverview(session_id, {
					include: include as OverviewOptions["include"],
					aroundMarker: around_marker,
					timeRange: time_range ? { start: new Date(time_range.start).getTime(), end: new Date(time_range.end).getTime() } : undefined,
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
			event_types: z
				.array(z.enum(["navigation", "network_request", "network_response", "console", "page_error", "user_input", "websocket", "performance", "marker"]))
				.optional()
				.describe("Filter by event type"),
			status_codes: z.array(z.number()).optional().describe("Filter network responses by HTTP status code, e.g. [400, 422, 500]"),
			time_range: z
				.object({
					start: z.string().describe("ISO timestamp"),
					end: z.string().describe("ISO timestamp"),
				})
				.optional()
				.describe("Filter by time window"),
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
						timeRange: time_range ? { start: new Date(time_range.start).getTime(), end: new Date(time_range.end).getTime() } : undefined,
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
			include: z
				.array(z.enum(["surrounding_events", "network_body", "screenshot", "form_state", "console_context"]))
				.optional()
				.describe("What to include alongside the event detail. Default: all"),
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
