import type { ChildProcess } from "node:child_process";
import { exec } from "node:child_process";
import type { Socket } from "node:net";
import { basename, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage, LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { CODELLDB_VERSION, downloadAndCacheCodeLLDB, getAdapterBinaryPath, isCodeLLDBCached } from "./codelldb.js";
import { allocatePort, CONNECT_SLOW, checkCommand, connectOrKill, gracefulDispose, spawnAndWait } from "./helpers.js";

const execAsync = promisify(exec);

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

/**
 * Resolve the CodeLLDB adapter binary, downloading it if necessary.
 */
async function resolveCodeLLDB(): Promise<string> {
	if (await isCodeLLDBCached()) {
		return getAdapterBinaryPath();
	}
	return downloadAndCacheCodeLLDB();
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
		const cargo = await checkCommand({
			cmd: "cargo",
			args: ["--version"],
			missing: ["cargo"],
			installHint: "Install Rust from https://rustup.rs",
		});
		if (!cargo.satisfied) return cargo;

		// Check CodeLLDB cache
		const cached = await isCodeLLDBCached();
		if (!cached) {
			return {
				satisfied: false,
				missing: ["codelldb"],
				installHint: `Run: krometrail doctor --install-codelldb, or download from https://github.com/vadimcn/codelldb/releases/v${CODELLDB_VERSION}`,
				fixCommand: "cargo install --locked codelldb",
			};
		}

		return { satisfied: true };
	}

	/**
	 * Launch a Rust program via CodeLLDB DAP server.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const cwd = config.cwd ?? process.cwd();

		const adapterBinary = await resolveCodeLLDB();

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

		const socket = await connectOrKill(adapterProc, "127.0.0.1", port, CONNECT_SLOW, "CodeLLDB");
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
		const adapterBinary = await resolveCodeLLDB();

		const port = config.port ?? (await allocatePort());

		const { process: adapterProc } = await spawnAndWait({
			cmd: adapterBinary,
			args: ["--port", String(port)],
			readyPattern: /listening on port/i,
			timeoutMs: 15_000,
			label: "codelldb",
		});

		this.adapterProcess = adapterProc;

		const socket = await connectOrKill(adapterProc, "127.0.0.1", port, CONNECT_SLOW, "CodeLLDB");
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
