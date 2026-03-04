import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

const ATTACH_TARGET = resolve(import.meta.dirname, "../../fixtures/python/attach-target.py");

/**
 * Find an available TCP port.
 */
async function getFreePort(): Promise<number> {
	const { createServer } = await import("node:net");
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : 0;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

describe.skipIf(SKIP_NO_DEBUGPY)("E2E: attach mode", () => {
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

	it("attaches to a debugpy --listen process", async () => {
		const port = await getFreePort();

		// Start a debugpy process listening on the free port
		const proc = spawn("python3", ["-m", "debugpy", "--listen", `127.0.0.1:${port}`, "--wait-for-client", ATTACH_TARGET], { stdio: "pipe" });

		// Give debugpy a moment to start listening
		await new Promise((resolve) => setTimeout(resolve, 1500));

		try {
			// Attach using debug_attach tool
			const attachText = await callTool(client, "debug_attach", {
				language: "python",
				port,
				host: "127.0.0.1",
			});
			sessionId = attachText.match(/Session: ([a-f0-9]{8})/)?.[1] ?? "";
			expect(sessionId).toBeTruthy();
			expect(attachText).toContain("Attached to python process");

			// Set a breakpoint
			await callTool(client, "debug_set_breakpoints", {
				session_id: sessionId,
				file: ATTACH_TARGET,
				breakpoints: [{ line: 7 }],
			});

			// Continue to breakpoint
			const viewport = await callTool(client, "debug_continue", {
				session_id: sessionId,
				timeout_ms: 10_000,
			});
			expect(viewport).toContain("STOPPED");

			// Stop — should NOT kill the attached process
			await callTool(client, "debug_stop", { session_id: sessionId });
			sessionId = "";

			// The process should still be alive (or completed normally)
			// We just verify stop didn't throw
		} finally {
			proc.kill("SIGTERM");
		}
	});
});
