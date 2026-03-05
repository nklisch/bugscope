import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Trace output directory. Override with TRACE_DIR env var. */
export function getTracesDir(): string {
	return process.env.TRACE_DIR ? resolve(process.env.TRACE_DIR) : resolve(import.meta.dirname, "../.traces");
}

/**
 * Create a suite-level trace directory for this test run.
 */
export async function initSuiteDir(): Promise<string> {
	const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "T").slice(0, 23);
	const suiteDir = join(getTracesDir(), ts);
	await mkdir(suiteDir, { recursive: true });
	return suiteDir;
}

/**
 * Write suite-level metadata file.
 */
export async function writeSuiteMeta(suiteDir: string, meta: Record<string, unknown>): Promise<void> {
	await writeFile(join(suiteDir, "meta.json"), JSON.stringify(meta, null, 2));
}
