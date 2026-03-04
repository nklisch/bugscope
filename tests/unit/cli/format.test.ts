import { describe, expect, it } from "vitest";
import {
	formatBreakpointsList,
	formatBreakpointsSet,
	formatError,
	formatEvaluate,
	formatLaunch,
	formatStackTrace,
	formatStatus,
	formatStop,
	formatVariables,
	formatViewport,
	resolveOutputMode,
} from "../../../src/cli/format.js";
import type { BreakpointsListPayload, BreakpointsResultPayload, LaunchResultPayload, StatusResultPayload, StopResultPayload } from "../../../src/daemon/protocol.js";

describe("resolveOutputMode", () => {
	it("returns json when json flag is set", () => {
		expect(resolveOutputMode({ json: true, quiet: false })).toBe("json");
	});

	it("returns quiet when quiet flag is set", () => {
		expect(resolveOutputMode({ json: false, quiet: true })).toBe("quiet");
	});

	it("prioritizes json over quiet", () => {
		expect(resolveOutputMode({ json: true, quiet: true })).toBe("json");
	});

	it("returns text when neither flag is set", () => {
		expect(resolveOutputMode({ json: false, quiet: false })).toBe("text");
	});

	it("returns text when no flags provided", () => {
		expect(resolveOutputMode({})).toBe("text");
	});
});

describe("formatLaunch", () => {
	const result: LaunchResultPayload = { sessionId: "sess-abc", status: "running" };

	it("text mode includes session id and status", () => {
		const out = formatLaunch(result, "text");
		expect(out).toContain("sess-abc");
		expect(out).toContain("running");
	});

	it("text mode includes viewport when present", () => {
		const withViewport = { ...result, viewport: "── STOPPED ──" };
		const out = formatLaunch(withViewport, "text");
		expect(out).toContain("── STOPPED ──");
	});

	it("json mode returns valid JSON", () => {
		const out = formatLaunch(result, "json");
		const parsed = JSON.parse(out);
		expect(parsed.sessionId).toBe("sess-abc");
		expect(parsed.status).toBe("running");
	});

	it("quiet mode returns empty string when no viewport", () => {
		const out = formatLaunch(result, "quiet");
		expect(out).toBe("");
	});

	it("quiet mode returns viewport string when present", () => {
		const withViewport = { ...result, viewport: "viewport-content" };
		const out = formatLaunch(withViewport, "quiet");
		expect(out).toBe("viewport-content");
	});
});

describe("formatStop", () => {
	const result: StopResultPayload = { duration: 5000, actionCount: 10 };

	it("text mode includes session id, duration, and action count", () => {
		const out = formatStop(result, "sess-abc", "text");
		expect(out).toContain("sess-abc");
		expect(out).toContain("5.0s");
		expect(out).toContain("10");
	});

	it("json mode returns valid JSON with all fields", () => {
		const out = formatStop(result, "sess-abc", "json");
		const parsed = JSON.parse(out);
		expect(parsed.sessionId).toBe("sess-abc");
		expect(parsed.duration).toBe(5000);
		expect(parsed.actionCount).toBe(10);
	});

	it("quiet mode returns empty string", () => {
		const out = formatStop(result, "sess-abc", "quiet");
		expect(out).toBe("");
	});
});

describe("formatStatus", () => {
	const result: StatusResultPayload = { status: "stopped", viewport: "viewport-text" };

	it("text mode shows status and viewport", () => {
		const out = formatStatus(result, "text");
		expect(out).toContain("stopped");
		expect(out).toContain("viewport-text");
	});

	it("json mode returns valid JSON", () => {
		const out = formatStatus(result, "json");
		const parsed = JSON.parse(out);
		expect(parsed.status).toBe("stopped");
		expect(parsed.viewport).toBe("viewport-text");
	});

	it("quiet mode returns viewport", () => {
		const out = formatStatus(result, "quiet");
		expect(out).toBe("viewport-text");
	});

	it("quiet mode returns status when no viewport", () => {
		const out = formatStatus({ status: "running" }, "quiet");
		expect(out).toBe("running");
	});
});

describe("formatViewport", () => {
	const viewport = "── STOPPED at file.py:10 ──";

	it("text mode returns viewport as-is", () => {
		expect(formatViewport(viewport, "text")).toBe(viewport);
	});

	it("quiet mode returns viewport as-is", () => {
		expect(formatViewport(viewport, "quiet")).toBe(viewport);
	});

	it("json mode wraps in object", () => {
		const out = formatViewport(viewport, "json");
		const parsed = JSON.parse(out);
		expect(parsed.viewport).toBe(viewport);
	});
});

describe("formatEvaluate", () => {
	it("text mode shows expression = result", () => {
		const out = formatEvaluate("x + 1", "42", "text");
		expect(out).toBe("x + 1 = 42");
	});

	it("quiet mode returns just the value", () => {
		const out = formatEvaluate("x + 1", "42", "quiet");
		expect(out).toBe("42");
	});

	it("json mode returns structured JSON", () => {
		const out = formatEvaluate("x + 1", "42", "json");
		const parsed = JSON.parse(out);
		expect(parsed.expression).toBe("x + 1");
		expect(parsed.result).toBe("42");
	});
});

describe("formatVariables", () => {
	const vars = "  x  = 5\n  y  = 10";

	it("text mode returns variables as-is", () => {
		expect(formatVariables(vars, "text")).toBe(vars);
	});

	it("json mode wraps in object", () => {
		const out = formatVariables(vars, "json");
		const parsed = JSON.parse(out);
		expect(parsed.variables).toBe(vars);
	});
});

describe("formatStackTrace", () => {
	const trace = "→ #0 file.py:10  func()";

	it("text mode returns trace as-is", () => {
		expect(formatStackTrace(trace, "text")).toBe(trace);
	});

	it("json mode wraps in object", () => {
		const out = formatStackTrace(trace, "json");
		const parsed = JSON.parse(out);
		expect(parsed.stackTrace).toBe(trace);
	});
});

describe("formatBreakpointsSet", () => {
	const result: BreakpointsResultPayload = {
		breakpoints: [
			{ requestedLine: 10, verifiedLine: 10, verified: true },
			{ requestedLine: 20, verifiedLine: null, verified: false, message: "file not found" },
		],
	};

	it("text mode shows file and verification status", () => {
		const out = formatBreakpointsSet("app.py", result, "text");
		expect(out).toContain("app.py");
		expect(out).toContain("Line 10");
		expect(out).toContain("verified");
		expect(out).toContain("Line 20");
		expect(out).toContain("file not found");
	});

	it("json mode returns valid JSON with file", () => {
		const out = formatBreakpointsSet("app.py", result, "json");
		const parsed = JSON.parse(out);
		expect(parsed.file).toBe("app.py");
		expect(parsed.breakpoints).toHaveLength(2);
	});
});

describe("formatBreakpointsList", () => {
	const result: BreakpointsListPayload = {
		files: {
			"app.py": [{ line: 10 }, { line: 20, condition: "x > 0" }],
		},
	};

	it("text mode lists breakpoints by file", () => {
		const out = formatBreakpointsList(result, "text");
		expect(out).toContain("app.py");
		expect(out).toContain("Line 10");
		expect(out).toContain("Line 20");
		expect(out).toContain("when x > 0");
	});

	it("shows 'No breakpoints' when empty", () => {
		const out = formatBreakpointsList({ files: {} }, "text");
		expect(out).toContain("No breakpoints");
	});

	it("json mode returns valid JSON", () => {
		const out = formatBreakpointsList(result, "json");
		const parsed = JSON.parse(out);
		expect(parsed.files["app.py"]).toHaveLength(2);
	});
});

describe("formatError", () => {
	const err = Object.assign(new Error("Something went wrong"), { code: "SESSION_NOT_FOUND" });

	it("text mode shows Error: message", () => {
		const out = formatError(err, "text");
		expect(out).toBe("Error: Something went wrong");
	});

	it("json mode returns structured JSON with code", () => {
		const out = formatError(err, "json");
		const parsed = JSON.parse(out);
		expect(parsed.error).toBe("Something went wrong");
		expect(parsed.code).toBe("SESSION_NOT_FOUND");
	});

	it("json mode works without code", () => {
		const simpleErr = new Error("Simple error");
		const out = formatError(simpleErr, "json");
		const parsed = JSON.parse(out);
		expect(parsed.error).toBe("Simple error");
		expect(parsed.code).toBeUndefined();
	});
});
