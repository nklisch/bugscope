import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../../fixtures/python/pytest-target");
const FIXTURE_TEST = resolve(FIXTURE_DIR, "test_module.py");

describe.skipIf(SKIP_NO_DEBUGPY)("E2E: framework detection", () => {
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

	it("auto-detects pytest and reports framework in response", async () => {
		const result = await callTool(client, "debug_launch", {
			command: `python3 -m pytest ${FIXTURE_TEST} -x`,
			cwd: FIXTURE_DIR,
		});
		sessionId = result.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
		expect(sessionId).toBeTruthy();
		expect(result).toContain("Framework: pytest");
	});

	it("framework: 'none' disables auto-detection", async () => {
		let sid = "";
		try {
			const result = await callTool(client, "debug_launch", {
				command: `python3 -m pytest ${FIXTURE_TEST} -x`,
				cwd: FIXTURE_DIR,
				framework: "none",
				stop_on_entry: true,
			});
			sid = result.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
			expect(result).not.toContain("Framework:");
		} finally {
			if (sid) {
				await callTool(client, "debug_stop", { session_id: sid }).catch(() => {});
			}
		}
	});
});
