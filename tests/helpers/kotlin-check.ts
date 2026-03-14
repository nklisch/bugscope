import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KDA_MARKER = join(homedir(), ".krometrail", "adapters", "kotlin-debug", "lib", "adapter-0.4.4.jar");

/**
 * Check if kotlinc, JDK 17+, and the kotlin-debug-adapter are all available.
 */
export async function isKotlinDebugAvailable(): Promise<boolean> {
	const kotlinOk = await new Promise<boolean>((resolve) => {
		const proc = spawn("kotlinc", ["-version"], { stdio: "pipe" });
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
	if (!kotlinOk) return false;

	// Check JDK 17+
	const jdkOk = await new Promise<boolean>((resolve) => {
		const proc = spawn("javac", ["-version"], { stdio: "pipe" });
		let output = "";
		proc.stdout?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		proc.on("close", (code) => {
			if (code !== 0) {
				resolve(false);
				return;
			}
			const match = output.match(/javac\s+(\d+)/);
			const major = match ? parseInt(match[1], 10) : 0;
			resolve(major >= 17);
		});
		proc.on("error", () => resolve(false));
	});
	if (!jdkOk) return false;
	return existsSync(KDA_MARKER);
}

/**
 * Whether Kotlin debugging is available for the current test run.
 * Computed once at module load time for use with describe.skipIf.
 */
export const SKIP_NO_KOTLIN: boolean = await isKotlinDebugAvailable().then((ok) => !ok);
