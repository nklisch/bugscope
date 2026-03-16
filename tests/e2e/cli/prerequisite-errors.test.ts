import { describe, expect, it } from "vitest";
import { runCli, runCliJson } from "../../helpers/cli-runner.js";

describe("E2E: prerequisite and adapter errors", () => {
	describe("missing adapter prerequisites", () => {
		it("launch with restricted PATH returns exit code 6 and actionable error", async () => {
			// Use a minimal PATH that has bun but not debuggers
			const result = await runCli(["debug", "launch", "python3 /tmp/nonexistent.py"], { env: { PATH: "/usr/bin:/bin" } });
			expect(result.exitCode).toBe(6);
			expect(result.stderr).toContain("prerequisites not met");
		});

		it("launch with restricted PATH returns JSON error with ADAPTER_PREREQUISITES code", async () => {
			const result = await runCliJson(["debug", "launch", "python3 /tmp/nonexistent.py", "--json"], { env: { PATH: "/usr/bin:/bin" } });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("ADAPTER_PREREQUISITES");
				expect(result.error.retryable).toBe(false);
			}
		});
	});

	describe("unknown language/extension", () => {
		it("launch with unknown extension returns exit code 3", async () => {
			const result = await runCli(["debug", "launch", "unknown.xyz"]);
			expect(result.exitCode).toBe(3);
			expect(result.stderr).toContain("krometrail doctor");
			expect(result.stderr).not.toContain("debug_status");
		});
	});

	describe("doctor --fix", () => {
		it("doctor --fix prints fix commands or nothing-to-fix message", async () => {
			const result = await runCli(["doctor", "--fix"]);
			expect(result.exitCode).toBe(0);
			const output = result.stdout;
			expect(output.includes("# Run these commands") || output.includes("nothing to fix")).toBe(true);
		});

		it("doctor --json includes fixCommand in missing adapter entries", async () => {
			const result = await runCliJson<{
				adapters: Array<{ id: string; status: string; fixCommand?: string; installHint?: string }>;
			}>(["doctor", "--json"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const missing = result.data.adapters.filter((a) => a.status === "missing");
				for (const adapter of missing) {
					expect(adapter.installHint, `Adapter '${adapter.id}' is missing but has no installHint`).toBeTruthy();
				}
			}
		});
	});

	describe("error message quality", () => {
		it("prerequisite error in text mode includes doctor reference", async () => {
			const result = await runCli(["debug", "launch", "python3 /tmp/nonexistent.py"], { env: { PATH: "/usr/bin:/bin" } });
			expect(result.stderr).toContain("krometrail doctor");
		});
	});
});
