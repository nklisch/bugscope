import type { ActionObservation, EnrichedActionLogEntry, ViewportSnapshot } from "./types.js";

/**
 * Extract notable observations from a viewport snapshot.
 * Used to annotate the action log with key findings.
 */
export function extractObservations(snapshot: ViewportSnapshot, previousSnapshot: ViewportSnapshot | null): ActionObservation[] {
	const observations: ActionObservation[] = [];

	// Breakpoint hit
	if (snapshot.reason === "breakpoint") {
		observations.push({ kind: "bp_hit", description: `BP hit at ${snapshot.file}:${snapshot.line}` });
	}

	// Exception stop
	if (snapshot.reason === "exception") {
		observations.push({ kind: "exception", description: `Exception at ${snapshot.file}:${snapshot.line}` });
	}

	// Variable changes vs previous snapshot
	if (previousSnapshot) {
		const prevMap = new Map(previousSnapshot.locals.map((v) => [v.name, v.value]));
		for (const v of snapshot.locals) {
			const prevValue = prevMap.get(v.name);
			if (prevValue !== undefined && prevValue !== v.value) {
				observations.push({ kind: "variable_changed", description: `${v.name}: ${prevValue} → ${v.value}` });
			}
		}

		// New frame entered
		if (previousSnapshot.stack.length > 0 && snapshot.stack.length > 0) {
			const prevTopFn = previousSnapshot.stack[0].function;
			const currTopFn = snapshot.stack[0].function;
			if (prevTopFn !== currTopFn) {
				observations.push({ kind: "new_frame", description: `Entered ${currTopFn}` });
			}
		}
	}

	// Unexpected values: negative numbers for count/total/amount/price variables
	const negativeKeywords = ["count", "total", "amount", "price"];
	for (const v of snapshot.locals) {
		const lowerName = v.name.toLowerCase();
		const isNegativeKeyword = negativeKeywords.some((kw) => lowerName.includes(kw));
		if (isNegativeKeyword) {
			const numVal = Number.parseFloat(v.value);
			if (!Number.isNaN(numVal) && numVal < 0) {
				observations.push({ kind: "unexpected_value", description: `${v.name} = ${v.value} (unexpected negative for "${v.name}")` });
			}
		}
	}

	return observations;
}

/**
 * Format the session log in summary mode.
 * Entries older than the compression window are collapsed into a summary paragraph.
 */
export function formatSessionLogSummary(
	entries: EnrichedActionLogEntry[],
	compressionWindowSize: number,
	sessionElapsedMs: number,
	tokenStats: { viewportTokensConsumed: number; viewportCount: number },
): string {
	if (entries.length === 0) {
		return "No actions logged.";
	}

	const elapsedSec = Math.round(sessionElapsedMs / 1000);
	const lines: string[] = [];
	lines.push(`Session Log (${entries.length} actions, ${elapsedSec}s elapsed, ~${tokenStats.viewportTokensConsumed} viewport tokens):`);
	lines.push("");

	const splitPoint = Math.max(0, entries.length - compressionWindowSize);

	if (splitPoint > 0) {
		const oldEntries = entries.slice(0, splitPoint);
		const summary = compressEntries(oldEntries);
		lines.push(`Summary of actions 1-${splitPoint}:`);
		lines.push(`  ${summary}`);
		lines.push("");
	}

	const recentEntries = entries.slice(splitPoint);
	for (const e of recentEntries) {
		const loc = e.location ? ` — at ${e.location}` : "";
		lines.push(` ${e.actionNumber}. [${e.tool}] ${e.summary}${loc}`);
	}

	return lines.join("\n");
}

/**
 * Format the session log in detailed mode.
 * Includes timestamps and full observation details.
 */
export function formatSessionLogDetailed(entries: EnrichedActionLogEntry[], sessionElapsedMs: number, tokenStats: { viewportTokensConsumed: number; viewportCount: number }): string {
	if (entries.length === 0) {
		return "No actions logged.";
	}

	const elapsedSec = Math.round(sessionElapsedMs / 1000);
	const lines: string[] = [];
	lines.push(`Session Log (${entries.length} actions, ${elapsedSec}s elapsed, ~${tokenStats.viewportTokensConsumed} viewport tokens):`);
	lines.push("");

	for (const e of entries) {
		lines.push(`#${e.actionNumber} ${new Date(e.timestamp).toISOString()} [${e.tool}] ${e.summary}`);
		if (e.observations.length > 0) {
			lines.push("   Observations:");
			for (const obs of e.observations) {
				lines.push(`   - ${obs.description}`);
			}
		}
	}

	return lines.join("\n");
}

/**
 * Generate a compressed summary paragraph from a slice of action log entries.
 * Condenses N entries into 2-3 sentences capturing the key observations.
 */
export function compressEntries(entries: EnrichedActionLogEntry[]): string {
	if (entries.length === 0) {
		return "No actions.";
	}

	// Collect all observations, deduplicating by description
	const seen = new Set<string>();
	const allObservations: ActionObservation[] = [];
	for (const e of entries) {
		for (const obs of e.observations) {
			if (!seen.has(obs.description)) {
				seen.add(obs.description);
				allObservations.push(obs);
			}
		}
	}

	// Build summary from tools used and observations
	const tools = [...new Set(entries.map((e) => e.tool))];
	const toolSummary = tools.join(", ");

	const parts: string[] = [];
	parts.push(`Actions 1-${entries.length} used: ${toolSummary}.`);

	if (allObservations.length > 0) {
		const obsDescs = allObservations
			.slice(0, 5)
			.map((o) => o.description)
			.join(". ");
		parts.push(`${obsDescs}.`);
	}

	return parts.join(" ");
}
