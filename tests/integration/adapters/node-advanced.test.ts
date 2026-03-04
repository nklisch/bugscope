import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session-manager.js";
import { ResourceLimitsSchema } from "../../../src/core/types.js";
import { SKIP_NO_NODE_DEBUG } from "../../helpers/node-check.js";

const SIMPLE_LOOP = resolve(import.meta.dirname, "../../fixtures/node/simple-loop.js");

const limits = ResourceLimitsSchema.parse({ stepTimeoutMs: 15_000 });

describe.skipIf(SKIP_NO_NODE_DEBUG)("Node.js advanced debugging", () => {
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
				command: `node ${SIMPLE_LOOP}`,
				language: "javascript",
				breakpoints: [
					{
						file: SIMPLE_LOOP,
						breakpoints: [{ line: 3, condition: "i === 3" }],
					},
				],
			});
			sessionId = result.sessionId;

			const viewport = await manager.continue(sessionId);
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

		it("getCapabilities returns structured info for Node.js sessions", async () => {
			const result = await manager.launch({
				command: `node ${SIMPLE_LOOP}`,
				language: "javascript",
				stopOnEntry: true,
			});
			sessionId = result.sessionId;

			const caps = manager.getCapabilities(sessionId);
			expect(typeof caps.supportsConditionalBreakpoints).toBe("boolean");
			expect(typeof caps.supportsLogPoints).toBe("boolean");
		});
	});
});
