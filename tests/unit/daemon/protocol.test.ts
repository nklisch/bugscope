import { afterEach, describe, expect, it } from "vitest";
import {
	ContinueParamsSchema,
	EvaluateParamsSchema,
	getDaemonPidPath,
	getDaemonSocketPath,
	LaunchParamsSchema,
	OutputParamsSchema,
	SessionIdParamsSchema,
	SessionLogParamsSchema,
	SetBreakpointsParamsSchema,
	StepParamsSchema,
	VariablesParamsSchema,
	WatchParamsSchema,
} from "../../../src/daemon/protocol.js";

describe("SessionIdParamsSchema", () => {
	it("parses valid params", () => {
		const result = SessionIdParamsSchema.parse({ sessionId: "abc-123" });
		expect(result.sessionId).toBe("abc-123");
	});

	it("rejects missing sessionId", () => {
		expect(() => SessionIdParamsSchema.parse({})).toThrow();
	});
});

describe("LaunchParamsSchema", () => {
	it("parses minimal launch params", () => {
		const result = LaunchParamsSchema.parse({ command: "python app.py" });
		expect(result.command).toBe("python app.py");
		expect(result.language).toBeUndefined();
		expect(result.breakpoints).toBeUndefined();
	});

	it("parses full launch params", () => {
		const result = LaunchParamsSchema.parse({
			command: "python app.py",
			language: "python",
			breakpoints: [
				{
					file: "app.py",
					breakpoints: [{ line: 10, condition: "x > 5" }],
				},
			],
			cwd: "/tmp",
			env: { MY_VAR: "value" },
			stopOnEntry: true,
			viewportConfig: { sourceContextLines: 10, stackDepth: 3 },
		});
		expect(result.command).toBe("python app.py");
		expect(result.breakpoints?.[0].file).toBe("app.py");
		expect(result.breakpoints?.[0].breakpoints[0].condition).toBe("x > 5");
		expect(result.stopOnEntry).toBe(true);
	});

	it("rejects missing command", () => {
		expect(() => LaunchParamsSchema.parse({})).toThrow();
	});
});

describe("ContinueParamsSchema", () => {
	it("parses with sessionId only", () => {
		const result = ContinueParamsSchema.parse({ sessionId: "s1" });
		expect(result.sessionId).toBe("s1");
		expect(result.timeoutMs).toBeUndefined();
	});

	it("parses with timeoutMs", () => {
		const result = ContinueParamsSchema.parse({ sessionId: "s1", timeoutMs: 5000 });
		expect(result.timeoutMs).toBe(5000);
	});
});

describe("StepParamsSchema", () => {
	it("parses over direction", () => {
		const result = StepParamsSchema.parse({ sessionId: "s1", direction: "over" });
		expect(result.direction).toBe("over");
	});

	it("parses into direction", () => {
		const result = StepParamsSchema.parse({ sessionId: "s1", direction: "into" });
		expect(result.direction).toBe("into");
	});

	it("parses out direction", () => {
		const result = StepParamsSchema.parse({ sessionId: "s1", direction: "out" });
		expect(result.direction).toBe("out");
	});

	it("rejects invalid direction", () => {
		expect(() => StepParamsSchema.parse({ sessionId: "s1", direction: "sideways" })).toThrow();
	});
});

describe("SetBreakpointsParamsSchema", () => {
	it("parses breakpoints", () => {
		const result = SetBreakpointsParamsSchema.parse({
			sessionId: "s1",
			file: "app.py",
			breakpoints: [{ line: 10 }, { line: 20, condition: "x > 0" }],
		});
		expect(result.breakpoints).toHaveLength(2);
		expect(result.breakpoints[1].condition).toBe("x > 0");
	});

	it("parses empty breakpoints array", () => {
		const result = SetBreakpointsParamsSchema.parse({
			sessionId: "s1",
			file: "app.py",
			breakpoints: [],
		});
		expect(result.breakpoints).toHaveLength(0);
	});
});

describe("EvaluateParamsSchema", () => {
	it("parses required fields", () => {
		const result = EvaluateParamsSchema.parse({ sessionId: "s1", expression: "x + 1" });
		expect(result.expression).toBe("x + 1");
		expect(result.frameIndex).toBeUndefined();
	});

	it("parses optional fields", () => {
		const result = EvaluateParamsSchema.parse({ sessionId: "s1", expression: "x", frameIndex: 2, maxDepth: 3 });
		expect(result.frameIndex).toBe(2);
		expect(result.maxDepth).toBe(3);
	});
});

describe("VariablesParamsSchema", () => {
	it("parses scope values", () => {
		for (const scope of ["local", "global", "closure", "all"] as const) {
			const result = VariablesParamsSchema.parse({ sessionId: "s1", scope });
			expect(result.scope).toBe(scope);
		}
	});

	it("rejects invalid scope", () => {
		expect(() => VariablesParamsSchema.parse({ sessionId: "s1", scope: "private" })).toThrow();
	});
});

describe("WatchParamsSchema", () => {
	it("parses expression list", () => {
		const result = WatchParamsSchema.parse({ sessionId: "s1", expressions: ["x", "y + 1"] });
		expect(result.expressions).toEqual(["x", "y + 1"]);
	});
});

describe("SessionLogParamsSchema", () => {
	it("parses summary format", () => {
		const result = SessionLogParamsSchema.parse({ sessionId: "s1", format: "summary" });
		expect(result.format).toBe("summary");
	});

	it("parses detailed format", () => {
		const result = SessionLogParamsSchema.parse({ sessionId: "s1", format: "detailed" });
		expect(result.format).toBe("detailed");
	});

	it("rejects invalid format", () => {
		expect(() => SessionLogParamsSchema.parse({ sessionId: "s1", format: "verbose" })).toThrow();
	});
});

describe("OutputParamsSchema", () => {
	it("parses stream values", () => {
		for (const stream of ["stdout", "stderr", "both"] as const) {
			const result = OutputParamsSchema.parse({ sessionId: "s1", stream });
			expect(result.stream).toBe(stream);
		}
	});
});

describe("getDaemonSocketPath", () => {
	const originalXdg = process.env.XDG_RUNTIME_DIR;

	afterEach(() => {
		if (originalXdg === undefined) {
			delete process.env.XDG_RUNTIME_DIR;
		} else {
			process.env.XDG_RUNTIME_DIR = originalXdg;
		}
	});

	it("uses XDG_RUNTIME_DIR when set", () => {
		process.env.XDG_RUNTIME_DIR = "/run/user/1000";
		const path = getDaemonSocketPath();
		expect(path).toBe("/run/user/1000/krometrail.sock");
	});

	it("falls back to ~/.krometrail/krometrail.sock when XDG not set", () => {
		delete process.env.XDG_RUNTIME_DIR;
		const path = getDaemonSocketPath();
		expect(path).toContain(".krometrail");
		expect(path).toContain("krometrail.sock");
	});
});

describe("getDaemonPidPath", () => {
	it("returns socket path + .pid", () => {
		const socketPath = getDaemonSocketPath();
		const pidPath = getDaemonPidPath();
		expect(pidPath).toBe(`${socketPath}.pid`);
	});
});
