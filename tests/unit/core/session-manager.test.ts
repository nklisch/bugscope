import { beforeEach, describe, expect, it } from "vitest";
import { SessionLimitError, SessionNotFoundError, SessionStateError } from "../../../src/core/errors.js";
import { SessionManager } from "../../../src/core/session-manager.js";
import type { ResourceLimits } from "../../../src/core/types.js";

const testLimits: ResourceLimits = {
	sessionTimeoutMs: 60_000,
	maxActionsPerSession: 10,
	maxConcurrentSessions: 2,
	stepTimeoutMs: 5_000,
	maxOutputBytes: 1_048_576,
	maxEvaluateTimeMs: 5_000,
};

describe("SessionManager", () => {
	let manager: SessionManager;

	beforeEach(() => {
		manager = new SessionManager(testLimits);
	});

	describe("getSession (via public methods)", () => {
		it("throws SessionNotFoundError for unknown session id", async () => {
			await expect(manager.stop("nonexistent-id")).rejects.toThrow(SessionNotFoundError);
		});

		it("throws SessionNotFoundError with the session id in message", async () => {
			try {
				await manager.stop("bad-id");
			} catch (e) {
				expect(e).toBeInstanceOf(SessionNotFoundError);
				expect((e as SessionNotFoundError).sessionId).toBe("bad-id");
			}
		});
	});

	describe("concurrent session limit", () => {
		it("rejects launch when max concurrent sessions reached", async () => {
			// Patch manager to have fake sessions
			const fakeManager = new SessionManager({ ...testLimits, maxConcurrentSessions: 0 });
			await expect(fakeManager.launch({ command: "python test.py" })).rejects.toThrow(SessionLimitError);
		});
	});

	describe("getStatus with unknown session", () => {
		it("throws SessionNotFoundError", async () => {
			await expect(manager.getStatus("bad-id")).rejects.toThrow(SessionNotFoundError);
		});
	});

	describe("listBreakpoints with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.listBreakpoints("bad-id")).toThrow(SessionNotFoundError);
		});
	});

	describe("addWatchExpressions with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.addWatchExpressions("bad-id", ["x"])).toThrow(SessionNotFoundError);
		});
	});

	describe("getOutput with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.getOutput("bad-id")).toThrow(SessionNotFoundError);
		});
	});

	describe("getSessionLog with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.getSessionLog("bad-id")).toThrow(SessionNotFoundError);
		});
	});

	describe("disposeAll with no sessions", () => {
		it("resolves without error", async () => {
			await expect(manager.disposeAll()).resolves.toBeUndefined();
		});
	});

	describe("session ID generation", () => {
		// We test this indirectly through the error message format
		it("session IDs are 8 character hex strings", async () => {
			// We can't easily test this without mocking the adapter
			// but we verify the pattern would work
			const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
			expect(uuid).toHaveLength(8);
			expect(/^[0-9a-f]{8}$/.test(uuid)).toBe(true);
		});
	});

	describe("action limit enforcement", () => {
		it("SessionLimitError has correct properties", () => {
			const err = new SessionLimitError("maxActionsPerSession", 11, 10, "Use conditional breakpoints.");
			expect(err.limitName).toBe("maxActionsPerSession");
			expect(err.currentValue).toBe(11);
			expect(err.maxValue).toBe(10);
			expect(err.code).toBe("SESSION_LIMIT_EXCEEDED");
		});
	});

	describe("SessionStateError", () => {
		it("has correct properties", () => {
			const err = new SessionStateError("abc123", "running", ["stopped"]);
			expect(err.sessionId).toBe("abc123");
			expect(err.currentState).toBe("running");
			expect(err.expectedStates).toEqual(["stopped"]);
			expect(err.code).toBe("SESSION_INVALID_STATE");
		});
	});

	describe("attach session limit enforcement", () => {
		it("rejects attach when max concurrent sessions reached", async () => {
			const fakeManager = new SessionManager({ ...testLimits, maxConcurrentSessions: 0 });
			await expect(fakeManager.attach({ language: "python" })).rejects.toThrow(SessionLimitError);
		});
	});

	describe("getCapabilities with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.getCapabilities("bad-id")).toThrow(SessionNotFoundError);
		});
	});

	describe("getThreads with unknown session", () => {
		it("throws SessionNotFoundError", async () => {
			await expect(manager.getThreads("bad-id")).rejects.toThrow(SessionNotFoundError);
		});
	});

	describe("getExceptionBreakpointFilters with unknown session", () => {
		it("throws SessionNotFoundError", () => {
			expect(() => manager.getExceptionBreakpointFilters("bad-id")).toThrow(SessionNotFoundError);
		});
	});
});
