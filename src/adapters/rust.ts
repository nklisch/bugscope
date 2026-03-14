import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import type { Socket } from "node:net";
import { platform } from "node:os";
import { basename, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage, LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_SLOW, connectTCP, downloadError, downloadToFile, ensureAdapterCacheDir, getAdapterCacheDir, gracefulDispose, spawnAndWait } from "./helpers.js";

const execAsync = promisify(exec);

/**
 * Pinned CodeLLDB version to use.
 */
const CODELLDB_VERSION = "1.12.1";

/**
 * Returns the path to the CodeLLDB adapter cache directory.
 */
export function getCodeLLDBCachePath(): string {
	return getAdapterCacheDir("codelldb");
}

/**
 * Returns the platform-specific adapter binary path.
 */
function getAdapterBinaryPath(): string {
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
function getVsixUrl(): string {
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

/**
 * Parse a cargo/rust command and extract the target binary path.
 * For "cargo run", builds and returns the binary path.
 * For "./target/debug/myapp", returns as-is.
 */
async function resolveRustBinary(command: string, cwd: string): Promise<{ binaryPath: string; buildFirst: boolean }> {
	const parts = command.trim().split(/\s+/);
	const first = parts[0];

	// Pre-built binary path
	if (first && (first.startsWith("./") || first.startsWith("/") || first.startsWith("target/"))) {
		return { binaryPath: resolvePath(cwd, first), buildFirst: false };
	}

	// cargo run / cargo test — need to build first and find binary
	if (first === "cargo") {
		const sub = parts[1];
		if (sub === "run" || sub === "build") {
			// Build first, find binary in target/debug/{package_name}
			try {
				const { stdout } = await execAsync("cargo metadata --format-version 1 --no-deps", { cwd });
				const metadata = JSON.parse(stdout) as { packages: Array<{ targets: Array<{ kind: string[]; name: string }> }> };
				const pkg = metadata.packages[0];
				const binTarget = pkg?.targets.find((t) => t.kind.includes("bin"));
				if (binTarget) {
					return { binaryPath: join(cwd, "target", "debug", binTarget.name), buildFirst: true };
				}
			} catch {
				// Fall back to package dir name
			}
			const pkgName = basename(cwd);
			return { binaryPath: join(cwd, "target", "debug", pkgName), buildFirst: true };
		}
		if (sub === "test") {
			// Use --no-run to get the test binary path
			const { stdout } = await execAsync("cargo test --no-run --message-format=json 2>&1 | tail -1", { cwd });
			try {
				const msg = JSON.parse(stdout) as { executable?: string };
				if (msg.executable) {
					return { binaryPath: msg.executable, buildFirst: false };
				}
			} catch {
				// ignore parse failure
			}
			const pkgName = basename(cwd);
			return { binaryPath: join(cwd, "target", "debug", pkgName), buildFirst: true };
		}
	}

	// Default: treat as a pre-built binary
	return { binaryPath: resolvePath(cwd, first ?? ""), buildFirst: false };
}

export class RustAdapter implements DebugAdapter {
	id = "rust";
	fileExtensions = [".rs"];
	displayName = "Rust (CodeLLDB)";

	private adapterProcess: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for cargo and CodeLLDB availability.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult> {
		// Check cargo
		const cargoOk = await new Promise<boolean>((resolve) => {
			const proc = spawn("cargo", ["--version"], { stdio: "pipe" });
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});

		if (!cargoOk) {
			return {
				satisfied: false,
				missing: ["cargo"],
				installHint: "Install Rust from https://rustup.rs",
			};
		}

		// Check CodeLLDB cache
		const cached = await isCodeLLDBCached();
		if (!cached) {
			return {
				satisfied: false,
				missing: ["codelldb"],
				installHint: `Run: krometrail doctor --install-codelldb, or download from https://github.com/vadimcn/codelldb/releases/v${CODELLDB_VERSION}`,
			};
		}

		return { satisfied: true };
	}

	/**
	 * Launch a Rust program via CodeLLDB DAP server.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const cwd = config.cwd ?? process.cwd();

		// Ensure CodeLLDB is available
		let adapterBinary = getAdapterBinaryPath();
		if (!(await isCodeLLDBCached())) {
			adapterBinary = await downloadAndCacheCodeLLDB();
		}

		const { binaryPath, buildFirst } = await resolveRustBinary(config.command, cwd);

		// Build if needed
		if (buildFirst) {
			try {
				await execAsync("cargo build", { cwd, env: { ...process.env, ...config.env } });
			} catch (err) {
				throw new LaunchError(`cargo build failed: ${getErrorMessage(err)}`);
			}
		}

		const port = config.port ?? (await allocatePort());

		// Spawn CodeLLDB adapter server
		const { process: adapterProc } = await spawnAndWait({
			cmd: adapterBinary,
			args: ["--port", String(port)],
			cwd,
			env: { ...process.env, ...config.env },
			readyPattern: /listening on port/i,
			timeoutMs: 15_000,
			label: "codelldb",
		});

		this.adapterProcess = adapterProc;

		const socket = await connectTCP("127.0.0.1", port, CONNECT_SLOW.maxRetries, CONNECT_SLOW.retryDelayMs).catch((err) => {
			adapterProc.kill();
			throw new LaunchError(`Could not connect to CodeLLDB on port ${port}: ${err.message}`);
		});

		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: adapterProc,
			launchArgs: {
				type: "lldb",
				program: binaryPath,
				cwd,
				env: config.env ?? {},
			},
		};
	}

	/**
	 * Attach to a running process via CodeLLDB.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		let adapterBinary = getAdapterBinaryPath();
		if (!(await isCodeLLDBCached())) {
			adapterBinary = await downloadAndCacheCodeLLDB();
		}

		const port = config.port ?? (await allocatePort());

		const { process: adapterProc } = await spawnAndWait({
			cmd: adapterBinary,
			args: ["--port", String(port)],
			readyPattern: /listening on port/i,
			timeoutMs: 15_000,
			label: "codelldb",
		});

		this.adapterProcess = adapterProc;

		const socket = await connectTCP("127.0.0.1", port, CONNECT_SLOW.maxRetries, CONNECT_SLOW.retryDelayMs).catch((err) => {
			adapterProc.kill();
			throw new LaunchError(`Could not connect to CodeLLDB on port ${port}: ${err.message}`);
		});

		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: adapterProc,
			launchArgs: {
				type: "lldb",
				request: "attach",
				pid: config.pid,
			},
		};
	}

	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.adapterProcess);
		this.socket = null;
		this.adapterProcess = null;
	}
}
