import type { SourceLine, ViewportConfig, ViewportDiff, ViewportSnapshot } from "./types.js";

/**
 * Renders a ViewportSnapshot into the compact text format returned to agents.
 * See docs/UX.md for the viewport format specification.
 */
export function renderViewport(snapshot: ViewportSnapshot, config: ViewportConfig): string {
	const lines: string[] = [];

	// Header
	lines.push(`── STOPPED at ${snapshot.file}:${snapshot.line} (${snapshot.function}) ──`);
	lines.push(`Reason: ${snapshot.reason}`);
	lines.push("");

	// Call stack
	const frameCount = snapshot.stack.length;
	lines.push(`Call Stack (${frameCount} of ${snapshot.totalFrames} frames):`);
	for (let i = 0; i < frameCount; i++) {
		const f = snapshot.stack[i];
		const marker = i === 0 ? "→" : " ";
		lines.push(`  ${marker} ${f.shortFile}:${f.line}  ${f.function}(${f.arguments})`);
	}
	lines.push("");

	// Source
	if (snapshot.source.length > 0) {
		const start = snapshot.source[0].line;
		const end = snapshot.source[snapshot.source.length - 1].line;
		lines.push(`Source (${start}–${end}):`);
		for (const sl of snapshot.source) {
			const marker = sl.line === snapshot.line ? "→" : " ";
			lines.push(`${marker}${String(sl.line).padStart(4)}│ ${sl.text}`);
		}
		lines.push("");
	}

	// Locals
	if (snapshot.locals.length > 0) {
		const maxName = Math.max(...snapshot.locals.map((v) => v.name.length), 8);
		lines.push("Locals:");
		for (const v of snapshot.locals.slice(0, config.localsMaxItems)) {
			lines.push(`  ${v.name.padEnd(maxName)}  = ${v.value}`);
		}
		const remaining = snapshot.locals.length - config.localsMaxItems;
		if (remaining > 0) {
			lines.push(`  (${remaining} more...)`);
		}
	}

	// Watch expressions
	if (snapshot.watches && snapshot.watches.length > 0) {
		lines.push("");
		const maxExpr = Math.max(...snapshot.watches.map((w) => w.name.length), 8);
		lines.push("Watch:");
		for (const w of snapshot.watches) {
			lines.push(`  ${w.name.padEnd(maxExpr)}  = ${w.value}`);
		}
	}

	// Compression note
	if (snapshot.compressionNote) {
		lines.push("");
		lines.push(snapshot.compressionNote);
	}

	return lines.join("\n");
}

/**
 * Determine if two ViewportSnapshots are eligible for diff mode.
 * Criteria: same file, same function, same stack depth.
 */
export function isDiffEligible(current: ViewportSnapshot, previous: ViewportSnapshot): boolean {
	return current.file === previous.file && current.function === previous.function && current.stack.length === previous.stack.length;
}

/**
 * Compute a ViewportDiff from two consecutive ViewportSnapshots.
 */
export function computeViewportDiff(current: ViewportSnapshot, previous: ViewportSnapshot, note?: string): ViewportDiff {
	// Identify changed variables
	const prevMap = new Map(previous.locals.map((v) => [v.name, v.value]));
	const changedVariables = [];
	let unchangedCount = 0;

	for (const v of current.locals) {
		const prevValue = prevMap.get(v.name);
		if (prevValue === undefined) {
			// New variable — treat as changed (added)
			changedVariables.push({ name: v.name, oldValue: "<undefined>", newValue: v.value });
		} else if (prevValue !== v.value) {
			changedVariables.push({ name: v.name, oldValue: prevValue, newValue: v.value });
		} else {
			unchangedCount++;
		}
	}

	// Determine if source should be included
	// Include source if current line moved outside the previous source window
	let source: SourceLine[] | undefined;
	if (previous.source.length > 0) {
		const prevStart = previous.source[0].line;
		const prevEnd = previous.source[previous.source.length - 1].line;
		if (current.line < prevStart || current.line > prevEnd) {
			source = current.source;
		}
	} else {
		source = current.source.length > 0 ? current.source : undefined;
	}

	return {
		isDiff: true,
		file: current.file,
		line: current.line,
		function: current.function,
		reason: current.reason,
		changedVariables,
		unchangedCount,
		source,
		watches: current.watches,
		compressionNote: note,
	};
}

/**
 * Render a compact diff viewport showing only changes from the previous stop.
 * Used when consecutive stops are in the same function.
 */
export function renderViewportDiff(diff: ViewportDiff, _config: ViewportConfig): string {
	const lines: string[] = [];

	// Header — (same frame) instead of full stack
	lines.push(`── ${diff.reason.toUpperCase()} at ${diff.file}:${diff.line} (same frame) ──`);
	lines.push(`Reason: ${diff.reason}`);
	lines.push("");

	// Source — only if line moved outside previous window
	if (diff.source && diff.source.length > 0) {
		const start = diff.source[0].line;
		const end = diff.source[diff.source.length - 1].line;
		lines.push(`Source (${start}–${end}):`);
		for (const sl of diff.source) {
			const marker = sl.line === diff.line ? "→" : " ";
			lines.push(`${marker}${String(sl.line).padStart(4)}│ ${sl.text}`);
		}
		lines.push("");
	}

	// Changed variables
	lines.push("Changed:");
	if (diff.changedVariables.length === 0) {
		lines.push("  (no changes)");
	} else {
		const maxName = Math.max(...diff.changedVariables.map((v) => v.name.length), 4);
		for (const v of diff.changedVariables) {
			lines.push(`  ${v.name.padEnd(maxName)}  = ${v.newValue}`);
		}
	}
	if (diff.unchangedCount > 0) {
		lines.push(`  (${diff.unchangedCount} locals unchanged)`);
	}

	// Watch expressions — always included in full
	if (diff.watches && diff.watches.length > 0) {
		lines.push("");
		const maxExpr = Math.max(...diff.watches.map((w) => w.name.length), 8);
		lines.push("Watch:");
		for (const w of diff.watches) {
			lines.push(`  ${w.name.padEnd(maxExpr)}  = ${w.value}`);
		}
	}

	// Compression note
	if (diff.compressionNote) {
		lines.push("");
		lines.push(diff.compressionNote);
	}

	return lines.join("\n");
}
