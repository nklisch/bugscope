import { describe, expect, it } from "vitest";
import { runCli } from "../../helpers/cli-runner.js";

describe("E2E: error exit codes", () => {
	it("unknown extension → exit 3 (NOT_FOUND)", async () => {
		const result = await runCli(["debug", "launch", "app.xyz"]);
		expect(result.exitCode).toBe(3);
	});

	it("missing prerequisites → exit 6 (PREREQUISITES)", async () => {
		// Use restricted PATH to ensure adapters fail prerequisite checks
		const result = await runCli(["debug", "launch", "python3 test.py"], { env: { PATH: "/usr/bin:/bin" } });
		expect(result.exitCode).toBe(6);
	});

	it("no active sessions → exit 1 (ERROR)", async () => {
		const result = await runCli(["debug", "continue"]);
		// No daemon or sessions running — should be a generic error
		expect(result.exitCode).toBe(1);
	});
});
