import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");
const INSTALL_SCRIPT = resolve(PROJECT_ROOT, "scripts/install.sh");

function runShell(cmd: string, args: string[], opts?: { env?: Record<string, string>; cwd?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: opts?.env ? { ...process.env, ...opts.env } : undefined,
			cwd: opts?.cwd,
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const timer = setTimeout(() => {
			proc.kill();
			reject(new Error("timeout"));
		}, opts?.timeoutMs ?? 30_000);
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code ?? 1, stdout, stderr });
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

describe("E2E: install.sh", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "krometrail-install-test-"));

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("install script is valid shell syntax", async () => {
		const result = await runShell("sh", ["-n", INSTALL_SCRIPT]);
		expect(result.exitCode).toBe(0);
	});

	it("install script --help exits 0 and shows usage", async () => {
		const result = await runShell("sh", [INSTALL_SCRIPT, "--help"]);
		expect(result.exitCode).toBe(0);
		expect((result.stdout + result.stderr).toLowerCase()).toMatch(/usage|install/);
	});

	it("install script installs binary to custom dir", async () => {
		const binDir = join(tempDir, "bin");
		const result = await runShell("sh", [INSTALL_SCRIPT, "--install-dir", binDir], {
			timeoutMs: 60_000,
		});

		// If this fails due to network (CI without internet), skip gracefully
		if (result.stderr.includes("rate limit") || result.stderr.includes("Could not download")) {
			console.warn("Skipping install test: network issue");
			return;
		}

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(binDir, "krometrail"))).toBe(true);
	}, 90_000);

	it("installed binary runs --version successfully", async () => {
		const binDir = join(tempDir, "bin");
		const binaryPath = join(binDir, "krometrail");
		if (!existsSync(binaryPath)) {
			console.warn("Skipping: binary not installed (previous test may have been skipped)");
			return;
		}

		const result = await runShell(binaryPath, ["--version"]);
		expect(result.exitCode).toBe(0);
		expect((result.stdout + result.stderr).trim()).toMatch(/\d+\.\d+\.\d+/);
	});

	it("installed binary runs doctor successfully", async () => {
		const binDir = join(tempDir, "bin");
		const binaryPath = join(binDir, "krometrail");
		if (!existsSync(binaryPath)) {
			console.warn("Skipping: binary not installed");
			return;
		}

		const result = await runShell(binaryPath, ["doctor"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Platform:");
		expect(result.stdout).toContain("Adapters:");
	});

	it("install script with bogus version fails gracefully", async () => {
		const binDir = join(tempDir, "bin-bogus");
		const result = await runShell("sh", [INSTALL_SCRIPT, "--version", "v99.99.99", "--install-dir", binDir], {
			timeoutMs: 30_000,
		});
		expect(result.exitCode).not.toBe(0);
		// Should show an error, not crash with a shell syntax error
		expect(result.stderr + result.stdout).not.toContain("syntax error");
	});
});
