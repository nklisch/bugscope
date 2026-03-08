import { estimateTokens, fitToBudget, type RenderSection, truncateToTokens } from "../../core/token-budget.js";
import type { EventRow } from "../storage/database.js";
import type { DiffResult } from "./diff.js";
import type { InspectResult, SessionOverview, SessionSummary } from "./query-engine.js";

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
	const header = [`Session: ${overview.session.id}`, `URL: ${overview.session.url}`, `Started: ${formatTime(overview.session.startedAt)}`, ""].join("\n");
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
		const netLines = [`Network: ${ns.total} requests | ${ns.succeeded} succeeded | ${ns.failed} failed`];
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
	const eventLines = [`Event: ${event.summary}`, `Type: ${event.type}`, `Time: ${formatTime(event.timestamp)}`, `ID: ${event.id}`];

	// Add type-specific detail
	if (event.type === "network_request" || event.type === "network_response") {
		const d = event.data as Record<string, unknown>;
		if (d.method) eventLines.push(`Method: ${d.method}`);
		if (d.url) eventLines.push(`URL: ${d.url}`);
		if (d.status) eventLines.push(`Status: ${d.status}`);
		if (d.durationMs) eventLines.push(`Duration: ${d.durationMs}ms`);
	}
	if (event.type === "console" || event.type === "page_error") {
		const d = event.data as Record<string, unknown>;
		if (d.stackTrace) eventLines.push(`Stack: ${d.stackTrace}`);
	}
	eventLines.push("");
	sections.push({ key: "event", content: eventLines.join("\n"), priority: 100 });

	// Network body (high priority — often the key evidence)
	if (result.networkBody) {
		const bodyLines: string[] = [];
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

/**
 * Render a session diff result with token budgeting.
 */
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
