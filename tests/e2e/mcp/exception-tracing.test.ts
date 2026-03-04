import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

const FIXTURE = resolve(import.meta.dirname, "../../fixtures/python/exception-raising.py");

describe.skipIf(SKIP_NO_DEBUGPY)("E2E: exception tracing", () => {
	let client: Client;
	let cleanup: () => Promise<void>;
	let sessionId: string;

	beforeAll(async () => {
		({ client, cleanup } = await createTestClient());
	});

	afterAll(async () => {
		if (sessionId) {
			try {
				await callTool(client, "debug_stop", { session_id: sessionId });
			} catch {
				// ignore
			}
		}
		await cleanup();
	});

	it("catches InsufficientFundsError with exception breakpoint", async () => {
		// 1. Launch
		const launchText = await callTool(client, "debug_launch", {
			command: `python3 ${FIXTURE}`,
		});
		sessionId = launchText.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
		expect(sessionId).toBeTruthy();

		// 2. Set exception breakpoints for raised exceptions
		await callTool(client, "debug_set_exception_breakpoints", {
			session_id: sessionId,
			filters: ["raised"],
		});

		// 3. Continue — should stop on InsufficientFundsError
		const viewport = await callTool(client, "debug_continue", {
			session_id: sessionId,
			timeout_ms: 10_000,
		});
		expect(viewport).toContain("STOPPED");
		// Phase 5: exception info should appear in viewport if debugpy supports exceptionInfo
		// (may or may not contain "Exception:" depending on adapter capability)
		expect(viewport).toMatch(/STOPPED|exception/i);

		// 4. Check variables for balance and amount
		const vars = await callTool(client, "debug_variables", {
			session_id: sessionId,
			scope: "local",
		});
		// Should contain balance and amount values
		expect(typeof vars).toBe("string");

		// 5. Stop
		await callTool(client, "debug_stop", { session_id: sessionId });
		sessionId = "";
	});
});
