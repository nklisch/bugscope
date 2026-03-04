import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

const FIXTURE = resolve(import.meta.dirname, "../../fixtures/python/simple-loop.py");

describe.skipIf(SKIP_NO_DEBUGPY)("E2E: conditional breakpoints", () => {
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

	it("conditional breakpoint stops only when i == 3", async () => {
		// 1. Launch with conditional breakpoint on line 7 (total += i)
		const launchText = await callTool(client, "debug_launch", {
			command: `python3 ${FIXTURE}`,
			breakpoints: [
				{
					file: FIXTURE,
					breakpoints: [{ line: 7, condition: "i == 3" }],
				},
			],
		});
		sessionId = launchText.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
		expect(sessionId).toBeTruthy();

		// 2. Continue — should stop when i == 3
		const viewport = await callTool(client, "debug_continue", {
			session_id: sessionId,
			timeout_ms: 10_000,
		});
		expect(viewport).toContain("STOPPED");
		expect(viewport).toMatch(/i\s*=\s*3/);

		// 3. Stop
		await callTool(client, "debug_stop", { session_id: sessionId });
		sessionId = "";
	});

	it("debug_status includes capabilities summary", async () => {
		const launchText = await callTool(client, "debug_launch", {
			command: `python3 ${FIXTURE}`,
			stop_on_entry: true,
		});
		sessionId = launchText.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
		expect(sessionId).toBeTruthy();

		const status = await callTool(client, "debug_status", {
			session_id: sessionId,
		});
		expect(status).toContain("Capabilities:");
		expect(status).toContain("Conditional breakpoints:");
		expect(status).toContain("Logpoints:");

		await callTool(client, "debug_stop", { session_id: sessionId });
		sessionId = "";
	});

	it("debug_set_breakpoints returns verified breakpoint info", async () => {
		const launchText = await callTool(client, "debug_launch", {
			command: `python3 ${FIXTURE}`,
			stop_on_entry: true,
		});
		sessionId = launchText.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
		expect(sessionId).toBeTruthy();

		const result = await callTool(client, "debug_set_breakpoints", {
			session_id: sessionId,
			file: FIXTURE,
			breakpoints: [{ line: 7 }],
		});
		expect(result).toContain("Line 7");
		expect(result).toMatch(/verified|UNVERIFIED/i);

		await callTool(client, "debug_stop", { session_id: sessionId });
		sessionId = "";
	});
});
