import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session-manager.js";
import { ResourceLimitsSchema } from "../../../src/core/types.js";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";

const SIMPLE_LOOP = resolve(import.meta.dirname, "../../fixtures/python/simple-loop.py");
const EXCEPTION_RAISING = resolve(import.meta.dirname, "../../fixtures/python/exception-raising.py");

const limits = ResourceLimitsSchema.parse({ stepTimeoutMs: 15_000 });

describe.skipIf(SKIP_NO_DEBUGPY)("Python advanced debugging", () => {
	let manager: SessionManager;

	beforeAll(() => {
		manager = new SessionManager(limits);
	});

	afterAll(async () => {
		await manager.disposeAll();
	});

	describe("conditional breakpoints", () => {
		let sessionId: string;

		afterEach(async () => {
			if (sessionId) {
				try {
					await manager.stop(sessionId);
				} catch {
					// ignore
				}
				sessionId = "";
			}
		});

		it("conditional breakpoint stops only when condition is true", async () => {
			const result = await manager.launch({
				command: `python3 ${SIMPLE_LOOP}`,
				breakpoints: [
					{
						file: SIMPLE_LOOP,
						// line 7: total += i (inside loop, i is available)
						breakpoints: [{ line: 7, condition: "i == 3" }],
					},
				],
			});
			sessionId = result.sessionId;
			expect(result.status).toBe("running");

			const viewport = await manager.continue(sessionId);
			expect(viewport).toContain("STOPPED");
			// The loop variable i should be 3
			expect(viewport).toMatch(/i\s*=\s*3/);
		});

		it("hit count breakpoint stops after N iterations", async () => {
			const result = await manager.launch({
				command: `python3 ${SIMPLE_LOOP}`,
				breakpoints: [
					{
						file: SIMPLE_LOOP,
						// line 7: total += i
						breakpoints: [{ line: 7, hitCondition: "3" }],
					},
				],
			});
			sessionId = result.sessionId;

			const viewport = await manager.continue(sessionId);
			expect(viewport).toContain("STOPPED");
		});
	});

	describe("exception breakpoints", () => {
		let sessionId: string;

		afterEach(async () => {
			if (sessionId) {
				try {
					await manager.stop(sessionId);
				} catch {
					// ignore
				}
				sessionId = "";
			}
		});

		it("exception breakpoint stops on raised exception with exception info", async () => {
			const result = await manager.launch({
				command: `python3 ${EXCEPTION_RAISING}`,
			});
			sessionId = result.sessionId;

			await manager.setExceptionBreakpoints(sessionId, ["raised"]);
			const viewport = await manager.continue(sessionId);
			expect(viewport).toContain("Exception:");
			expect(viewport).toContain("STOPPED");
		});
	});

	describe("capability gating", () => {
		let sessionId: string;

		afterEach(async () => {
			if (sessionId) {
				try {
					await manager.stop(sessionId);
				} catch {
					// ignore
				}
				sessionId = "";
			}
		});

		it("getCapabilities returns structured info for Python sessions", async () => {
			const result = await manager.launch({
				command: `python3 ${SIMPLE_LOOP}`,
				stopOnEntry: true,
			});
			sessionId = result.sessionId;

			const caps = manager.getCapabilities(sessionId);
			expect(typeof caps.supportsConditionalBreakpoints).toBe("boolean");
			expect(typeof caps.supportsHitConditionalBreakpoints).toBe("boolean");
			expect(typeof caps.supportsLogPoints).toBe("boolean");
			expect(typeof caps.supportsExceptionInfo).toBe("boolean");
			expect(Array.isArray(caps.exceptionFilters)).toBe(true);
		});

		it("getExceptionBreakpointFilters returns available filters", async () => {
			const result = await manager.launch({
				command: `python3 ${SIMPLE_LOOP}`,
				stopOnEntry: true,
			});
			sessionId = result.sessionId;

			const filters = manager.getExceptionBreakpointFilters(sessionId);
			expect(Array.isArray(filters)).toBe(true);
			// debugpy reports at least some exception filters
			if (filters.length > 0) {
				expect(filters[0]).toHaveProperty("filter");
				expect(filters[0]).toHaveProperty("label");
			}
		});
	});

	describe("breakpoint verification", () => {
		let sessionId: string;

		afterEach(async () => {
			if (sessionId) {
				try {
					await manager.stop(sessionId);
				} catch {
					// ignore
				}
				sessionId = "";
			}
		});

		it("setBreakpoints returns VerifiedBreakpoint[] with requestedLine and verified fields", async () => {
			const result = await manager.launch({
				command: `python3 ${SIMPLE_LOOP}`,
				stopOnEntry: true,
			});
			sessionId = result.sessionId;

			const verified = await manager.setBreakpoints(sessionId, SIMPLE_LOOP, [{ line: 4 }]);
			expect(Array.isArray(verified)).toBe(true);
			expect(verified).toHaveLength(1);
			expect(verified[0]).toHaveProperty("requestedLine", 4);
			expect(typeof verified[0].verified).toBe("boolean");
			expect(verified[0].verifiedLine === null || typeof verified[0].verifiedLine === "number").toBe(true);
		});
	});
});
