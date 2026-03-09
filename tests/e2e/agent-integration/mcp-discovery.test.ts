import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

describe.skipIf(SKIP_NO_DEBUGPY)("Agent integration: MCP discovery", () => {
	let client: Client;
	let cleanup: () => Promise<void>;

	beforeAll(async () => {
		({ client, cleanup } = await createTestClient());
	}, 30_000);

	afterAll(async () => {
		await cleanup();
	});

	it("lists all expected tools with descriptions", async () => {
		const result = await client.listTools();
		const toolNames = result.tools.map((t) => t.name);

		// Core tools must be present
		expect(toolNames).toContain("debug_launch");
		expect(toolNames).toContain("debug_stop");
		expect(toolNames).toContain("debug_continue");
		expect(toolNames).toContain("debug_step");
		expect(toolNames).toContain("debug_evaluate");
		expect(toolNames).toContain("debug_variables");
		expect(toolNames).toContain("debug_set_breakpoints");
		expect(toolNames).toContain("debug_action_log");

		// Each tool has a non-empty description
		for (const tool of result.tools) {
			expect(tool.description, `Tool ${tool.name} should have a description`).toBeTruthy();
			expect(tool.description!.length, `Tool ${tool.name} description too short`).toBeGreaterThan(20);
		}
	});

	it("tool descriptions contain agent guidance", async () => {
		const result = await client.listTools();
		const tools = Object.fromEntries(result.tools.map((t) => [t.name, t]));

		// debug_launch should mention breakpoints
		expect(tools.debug_launch?.description).toMatch(/breakpoint/i);

		// debug_set_breakpoints should warn about non-executable lines
		expect(tools.debug_set_breakpoints?.description).toMatch(/non-executable|structural|declarative/i);

		// debug_step should explain over/into/out
		expect(tools.debug_step?.description).toMatch(/over.*into.*out|step over|step into/i);
	});

	it("full debug session works via tool calls alone", async () => {
		const fixture = resolve(import.meta.dirname, "../../fixtures/python/discount-bug.py");

		// Launch
		const launchResult = await callTool(client, "debug_launch", {
			command: `python3 ${fixture}`,
			breakpoints: [{ file: fixture, breakpoints: [{ line: 13 }] }],
		});
		const sessionIdMatch = launchResult.match(/Session:\s+([a-f0-9-]+)/i);
		expect(sessionIdMatch, "Launch should return session ID").toBeTruthy();
		const sessionId = sessionIdMatch![1];

		try {
			// Continue to breakpoint
			const viewport = await callTool(client, "debug_continue", {
				session_id: sessionId,
				timeout_ms: 15_000,
			});
			expect(viewport).toContain("STOPPED");
			expect(viewport).toContain("Locals:");

			// Evaluate
			const evalResult = await callTool(client, "debug_evaluate", {
				session_id: sessionId,
				expression: "tier_multipliers",
			});
			expect(evalResult).toContain("gold");

			// Session log
			const log = await callTool(client, "debug_action_log", {
				session_id: sessionId,
			});
			expect(log).toContain("action");

			// Status
			const status = await callTool(client, "debug_status", {
				session_id: sessionId,
			});
			expect(status).toMatch(/stopped/i);
		} finally {
			try {
				await callTool(client, "debug_stop", { session_id: sessionId });
			} catch {}
		}
	}, 60_000);
});
