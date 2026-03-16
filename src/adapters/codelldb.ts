import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage } from "../core/errors.js";
import { downloadError, downloadToFile, ensureAdapterCacheDir, getAdapterCacheDir } from "./helpers.js";

const execAsync = promisify(exec);

/**
 * Pinned CodeLLDB version to use.
 */
export const CODELLDB_VERSION = "1.12.1";

/**
 * Returns the path to the CodeLLDB adapter cache directory.
 */
export function getCodeLLDBCachePath(): string {
	return getAdapterCacheDir("codelldb");
}

/**
 * Returns the platform-specific adapter binary path.
 */
export function getAdapterBinaryPath(): string {
	const base = getCodeLLDBCachePath();
	const ext = platform() === "win32" ? ".exe" : "";
	return join(base, "adapter", `codelldb${ext}`);
}

/**
 * Check if CodeLLDB is already cached.
 */
export async function isCodeLLDBCached(): Promise<boolean> {
	try {
		await access(getAdapterBinaryPath());
		return true;
	} catch {
		return false;
	}
}

/**
 * Returns the VSIX download URL for the current platform.
 */
export function getVsixUrl(): string {
	const os = platform();
	let platformStr: string;
	if (os === "darwin") {
		platformStr = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	} else if (os === "win32") {
		platformStr = "win32-x64";
	} else {
		platformStr = process.arch === "arm64" ? "linux-arm64" : "linux-x64";
	}
	return `https://github.com/vadimcn/codelldb/releases/download/v${CODELLDB_VERSION}/codelldb-${platformStr}.vsix`;
}

/**
 * Download and cache the CodeLLDB DAP adapter binary.
 * Downloads the VSIX from GitHub releases and extracts the adapter binary.
 * Returns the path to the adapter binary.
 */
export async function downloadAndCacheCodeLLDB(): Promise<string> {
	const cacheDir = ensureAdapterCacheDir("codelldb");

	const vsixUrl = getVsixUrl();
	const vsixPath = join(cacheDir, "codelldb.vsix");

	try {
		await downloadToFile(vsixUrl, vsixPath, "CodeLLDB");
	} catch (err) {
		throw downloadError("CodeLLDB", CODELLDB_VERSION, vsixUrl, cacheDir, err, `To install manually, download the VSIX and extract the adapter/ directory to: ${cacheDir}`);
	}

	// Extract the VSIX (it's a zip file) and pull out the adapter binary
	try {
		await execAsync(`unzip -o "${vsixPath}" "extension/adapter/*" -d "${cacheDir}"`);
		// Rename extension/adapter/ to adapter/
		await execAsync(`mv -f "${join(cacheDir, "extension", "adapter")}" "${join(cacheDir, "adapter")}" 2>/dev/null || true`);
	} catch (err) {
		throw new Error(`Failed to extract CodeLLDB VSIX.\nError: ${getErrorMessage(err)}\nEnsure 'unzip' is installed on your system.`);
	}

	const binaryPath = getAdapterBinaryPath();
	if (!existsSync(binaryPath)) {
		throw new Error(`CodeLLDB extracted but binary not found at: ${binaryPath}\nThe VSIX structure may have changed.`);
	}

	// Make binary executable on Unix
	if (platform() !== "win32") {
		await execAsync(`chmod +x "${binaryPath}"`);
	}

	return binaryPath;
}
