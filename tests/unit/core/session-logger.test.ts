import { describe, expect, it } from "vitest";
import { compressEntries, extractObservations, formatSessionLogDetailed, formatSessionLogSummary } from "../../../src/core/session-logger.js";
import type { EnrichedActionLogEntry, ViewportSnapshot } from "../../../src/core/types.js";

const makeSnapshot = (overrides: Partial<ViewportSnapshot> = {}): ViewportSnapshot => ({
	file: "order.py",
	line: 147,
	function: "process_order",
	reason: "step",
	totalFrames: 1,
	stack: [{ file: "order.py", shortFile: "order.py", line: 147, function: "process_order", arguments: "" }],
	source: [{ line: 147, text: "  x = 1" }],
	locals: [],
	...overrides,
});

const makeEntry = (overrides: Partial<EnrichedActionLogEntry> = {}): EnrichedActionLogEntry => ({
	actionNumber: 1,
	tool: "debug_step",
	summary: "Stepped over",
	timestamp: Date.now(),
	keyParams: {},
	observations: [],
	...overrides,
});

describe("extractObservations", () => {
	it("detects breakpoint hits", () => {
		const snapshot = makeSnapshot({ reason: "breakpoint" });
		const obs = extractObservations(snapshot, null);
		expect(obs.some((o) => o.kind === "bp_hit")).toBe(true);
	});

	it("detects exception stops", () => {
		const snapshot = makeSnapshot({ reason: "exception" });
		const obs = extractObservations(snapshot, null);
		expect(obs.some((o) => o.kind === "exception")).toBe(true);
	});

	it("detects variable changes between snapshots", () => {
		const prev = makeSnapshot({ locals: [{ name: "x", value: "1" }] });
		const curr = makeSnapshot({ locals: [{ name: "x", value: "99" }] });
		const obs = extractObservations(curr, prev);
		expect(obs.some((o) => o.kind === "variable_changed" && o.description.includes("x"))).toBe(true);
	});

	it("detects unexpected negative values for amount/total/count/price variables", () => {
		const snapshot = makeSnapshot({ locals: [{ name: "total", value: "-50" }] });
		const obs = extractObservations(snapshot, null);
		expect(obs.some((o) => o.kind === "unexpected_value")).toBe(true);
	});

	it("detects new function entry", () => {
		const prev = makeSnapshot({ stack: [{ file: "a.py", shortFile: "a.py", line: 1, function: "foo", arguments: "" }] });
		const curr = makeSnapshot({ stack: [{ file: "a.py", shortFile: "a.py", line: 5, function: "bar", arguments: "" }] });
		const obs = extractObservations(curr, prev);
		expect(obs.some((o) => o.kind === "new_frame" && o.description.includes("bar"))).toBe(true);
	});

	it("returns empty array when no notable observations", () => {
		const snapshot = makeSnapshot({ locals: [{ name: "x", value: "42" }] });
		const prev = makeSnapshot({ locals: [{ name: "x", value: "42" }] });
		const obs = extractObservations(snapshot, prev);
		expect(obs).toHaveLength(0);
	});
});

describe("formatSessionLogSummary", () => {
	it("shows recent entries individually", () => {
		const entries = Array.from({ length: 3 }, (_, i) => makeEntry({ actionNumber: i + 1, tool: `tool_${i}`, summary: `Action ${i + 1}` }));
		const output = formatSessionLogSummary(entries, 10, 5000, { viewportTokensConsumed: 100, viewportCount: 3 });
		expect(output).toContain("Action 1");
		expect(output).toContain("Action 2");
	});

	it("compresses older entries into summary paragraph", () => {
		const entries = Array.from({ length: 15 }, (_, i) => makeEntry({ actionNumber: i + 1, summary: `Step ${i + 1}` }));
		const output = formatSessionLogSummary(entries, 10, 30000, { viewportTokensConsumed: 500, viewportCount: 15 });
		expect(output).toContain("Summary of actions 1-5");
	});

	it("includes token stats header", () => {
		const entries = [makeEntry()];
		const output = formatSessionLogSummary(entries, 10, 10000, { viewportTokensConsumed: 2400, viewportCount: 5 });
		expect(output).toContain("2400");
	});

	it("handles empty log", () => {
		const output = formatSessionLogSummary([], 10, 0, { viewportTokensConsumed: 0, viewportCount: 0 });
		expect(output).toBe("No actions logged.");
	});
});

describe("formatSessionLogDetailed", () => {
	it("shows all entries with timestamps", () => {
		const entries = [makeEntry({ actionNumber: 1, timestamp: new Date("2024-01-15T10:30:00.000Z").getTime(), tool: "debug_launch", summary: "Launched app" })];
		const output = formatSessionLogDetailed(entries, 5000, { viewportTokensConsumed: 100, viewportCount: 1 });
		expect(output).toContain("2024-01-15");
		expect(output).toContain("debug_launch");
	});

	it("includes observation details", () => {
		const entries = [
			makeEntry({
				actionNumber: 1,
				observations: [{ kind: "bp_hit", description: "BP hit at order.py:147" }],
			}),
		];
		const output = formatSessionLogDetailed(entries, 5000, { viewportTokensConsumed: 100, viewportCount: 1 });
		expect(output).toContain("BP hit at order.py:147");
	});

	it("includes token stats header", () => {
		const output = formatSessionLogDetailed([makeEntry()], 5000, { viewportTokensConsumed: 1234, viewportCount: 2 });
		expect(output).toContain("1234");
	});
});

describe("compressEntries", () => {
	it("produces 1-3 sentence summary from entries", () => {
		const entries = Array.from({ length: 5 }, (_, i) => makeEntry({ actionNumber: i + 1, tool: "debug_step", observations: [{ kind: "bp_hit", description: `BP ${i}` }] }));
		const summary = compressEntries(entries);
		expect(summary.length).toBeGreaterThan(0);
		expect(summary).toContain("debug_step");
	});

	it("deduplicates repeated observations", () => {
		const entries = [makeEntry({ observations: [{ kind: "bp_hit", description: "BP hit at x:1" }] }), makeEntry({ observations: [{ kind: "bp_hit", description: "BP hit at x:1" }] })];
		const summary = compressEntries(entries);
		// "BP hit at x:1" should appear only once
		const count = (summary.match(/BP hit at x:1/g) ?? []).length;
		expect(count).toBe(1);
	});

	it("preserves key location and value information", () => {
		const entries = [makeEntry({ observations: [{ kind: "variable_changed", description: "discount: 10 → -149.97" }] })];
		const summary = compressEntries(entries);
		expect(summary).toContain("discount");
	});
});
