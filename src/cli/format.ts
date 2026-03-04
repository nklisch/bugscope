import type { BreakpointsListPayload, BreakpointsResultPayload, LaunchResultPayload, StatusResultPayload, StopResultPayload } from "../daemon/protocol.js";

/**
 * Output mode determined by CLI flags.
 */
export type OutputMode = "text" | "json" | "quiet";

/**
 * Resolve output mode from CLI flags.
 */
export function resolveOutputMode(flags: { json?: boolean; quiet?: boolean }): OutputMode {
	if (flags.json) return "json";
	if (flags.quiet) return "quiet";
	return "text";
}

/**
 * Format a launch result for CLI output.
 */
export function formatLaunch(result: LaunchResultPayload, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify(result, null, 2);
	}
	if (mode === "quiet") {
		return result.viewport ?? "";
	}
	// text mode
	const lines: string[] = [`Session started: ${result.sessionId}`];
	if (result.framework) lines.push(`Framework: ${result.framework}`);
	if (result.frameworkWarnings?.length) for (const w of result.frameworkWarnings) lines.push(`Warning: ${w}`);
	if (result.viewport) {
		lines.push(result.viewport);
	} else {
		lines.push(`Status: ${result.status}`);
	}
	return lines.join("\n");
}

/**
 * Format a stop result for CLI output.
 */
export function formatStop(result: StopResultPayload, sessionId: string, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ sessionId, ...result }, null, 2);
	}
	if (mode === "quiet") {
		return "";
	}
	const durationSec = (result.duration / 1000).toFixed(1);
	return `Session ${sessionId} ended. Duration: ${durationSec}s, Actions: ${result.actionCount}`;
}

/**
 * Format a status result for CLI output.
 */
export function formatStatus(result: StatusResultPayload, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify(result, null, 2);
	}
	if (mode === "quiet") {
		return result.viewport ?? result.status;
	}
	const lines: string[] = [`Status: ${result.status}`];
	if (result.viewport) {
		lines.push(result.viewport);
	}
	return lines.join("\n");
}

/**
 * Format a viewport string for CLI output.
 * In text mode: print as-is.
 * In quiet mode: print as-is (viewport already is the minimal form).
 * In JSON mode: wrap in a JSON object with viewport field.
 */
export function formatViewport(viewport: string, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ viewport }, null, 2);
	}
	return viewport;
}

/**
 * Format an evaluate result.
 */
export function formatEvaluate(expression: string, result: string, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ expression, result }, null, 2);
	}
	if (mode === "quiet") {
		return result;
	}
	return `${expression} = ${result}`;
}

/**
 * Format a variables result.
 */
export function formatVariables(result: string, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ variables: result }, null, 2);
	}
	return result;
}

/**
 * Format a stack trace result.
 */
export function formatStackTrace(result: string, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ stackTrace: result }, null, 2);
	}
	return result;
}

/**
 * Format a breakpoint set result.
 */
export function formatBreakpointsSet(file: string, result: BreakpointsResultPayload, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ file, ...result }, null, 2);
	}
	if (mode === "quiet") {
		return result.breakpoints.map((bp) => `${file}:${bp.requestedLine} ${bp.verified ? "✓" : "✗"}`).join("\n");
	}
	const lines: string[] = [`Breakpoints set in ${file}:`];
	for (const bp of result.breakpoints) {
		const adjustedNote = bp.verifiedLine !== null && bp.verifiedLine !== bp.requestedLine ? ` → adjusted to line ${bp.verifiedLine}` : "";
		const status = bp.verified ? `verified${adjustedNote}` : `unverified${bp.message ? ` (${bp.message})` : ""}`;
		lines.push(`  Line ${bp.requestedLine}: ${status}`);
	}
	return lines.join("\n");
}

/**
 * Format a breakpoint list result.
 */
export function formatBreakpointsList(result: BreakpointsListPayload, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify(result, null, 2);
	}
	const files = Object.entries(result.files);
	if (files.length === 0) {
		return "No breakpoints set.";
	}
	const lines: string[] = [];
	for (const [file, bps] of files) {
		lines.push(`${file}:`);
		for (const bp of bps) {
			let desc = `  Line ${bp.line}`;
			if (bp.condition) desc += ` when ${bp.condition}`;
			if (bp.hitCondition) desc += ` hit ${bp.hitCondition}`;
			if (bp.logMessage) desc += ` log '${bp.logMessage}'`;
			lines.push(desc);
		}
	}
	return lines.join("\n");
}

/**
 * Format watch expressions for CLI output.
 */
export function formatWatchExpressions(expressions: string[], mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify({ watchExpressions: expressions }, null, 2);
	}
	const lines: string[] = [`Watch expressions (${expressions.length} total):`];
	for (const expr of expressions) lines.push(`  ${expr}`);
	return lines.join("\n");
}

/**
 * Format an error for CLI output.
 * In text mode: "Error: <message>"
 * In JSON mode: { "error": "<message>", "code": "<code>" }
 */
export function formatError(error: Error, mode: OutputMode): string {
	const message = error.message ?? String(error);
	const code = (error as { code?: string }).code;

	if (mode === "json") {
		const payload: Record<string, string> = { error: message };
		if (code) payload.code = code;
		return JSON.stringify(payload, null, 2);
	}

	return `Error: ${message}`;
}
