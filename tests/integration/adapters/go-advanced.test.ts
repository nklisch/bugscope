import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session-manager.js";
import { ResourceLimitsSchema } from "../../../src/core/types.js";
import { SKIP_NO_DLV } from "../../helpers/dlv-check.js";

const SIMPLE_LOOP = resolve(import.meta.dirname, "../../fixtures/go/simple-loop.go");

const limits = ResourceLimitsSchema.parse({ stepTimeoutMs: 15_000 });

describe.skipIf(SKIP_NO_DLV)("Go advanced debugging", () => {
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

		it("conditional breakpoint works", async () => {
			const result = await manager.launch({
				command: `go run ${SIMPLE_LOOP}`,
				language: "go",
				breakpoints: [
					{
						file: SIMPLE_LOOP,
						breakpoints: [{ line: 9, condition: "i == 3" }],
					},
				],
			});
			sessionId = result.sessionId;

			const viewport = await manager.continue(sessionId);
			expect(viewport).toContain("STOPPED");
		});
	});

	describe("getThreads (goroutines)", () => {
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

		it("goroutine listing returns threads", async () => {
			const result = await manager.launch({
				command: `go run ${SIMPLE_LOOP}`,
				language: "go",
				breakpoints: [
					{
						file: SIMPLE_LOOP,
						breakpoints: [{ line: 9 }],
					},
				],
			});
			sessionId = result.sessionId;

			await manager.continue(sessionId);
			const threads = await manager.getThreads(sessionId);
			expect(Array.isArray(threads)).toBe(true);
			expect(threads.length).toBeGreaterThan(0);
			const stopped = threads.find((t) => t.stopped);
			expect(stopped).toBeDefined();
		});
	});
});
