import type { ChildProcess } from "node:child_process";
import { exec, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve as resolvePath } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage, LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { detectEarlySpawnFailure, gracefulDispose } from "./helpers.js";

const execAsync = promisify(exec);

const MIN_GDB_VERSION = 14;

/**
 * Parse GDB version string like "GNU gdb (Ubuntu 14.1-0ubuntu1) 14.1" and
 * extract the major version number.
 */
function parseGdbVersion(output: string): number {
	const match = output.match(/GNU gdb[^\d]*(\d+)\./);
	return match ? parseInt(match[1], 10) : 0;
}

/**
 * Check GDB version and return major version, or 0 if not found.
 */
async function checkGdbVersion(): Promise<number> {
	return new Promise((resolve) => {
		const proc = spawn("gdb", ["--version"], { stdio: "pipe" });
		let output = "";
		proc.stdout?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		proc.stderr?.on("data", (d: Buffer) => {
			output += d.toString();
		});
		proc.on("close", (code) => {
			if (code !== 0) {
				resolve(0);
				return;
			}
			resolve(parseGdbVersion(output));
		});
		proc.on("error", () => resolve(0));
	});
}

/**
 * Check if lldb-dap is available as an alternative to GDB DAP.
 */
async function checkLldbDap(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("lldb-dap", ["--version"], { stdio: "pipe" });
		proc.on("close", (code) => resolve(code === 0));
		proc.on("error", () => resolve(false));
	});
}

/**
 * Determine whether a command string is a source file to compile or a pre-built binary.
 */
function parseCommand(command: string): { type: "source" | "binary" | "build"; path: string; compiler: "gcc" | "g++" | null } {
	const parts = command.trim().split(/\s+/);
	const first = parts[0] ?? "";

	// Build system commands
	if (first === "make" || first === "cmake") {
		return { type: "build", path: first, compiler: null };
	}

	// Source files to compile
	const ext = extname(first).toLowerCase();
	if (ext === ".c") {
		return { type: "source", path: first, compiler: "gcc" };
	}
	if (ext === ".cpp" || ext === ".cc" || ext === ".cxx") {
		return { type: "source", path: first, compiler: "g++" };
	}

	// Pre-built binary
	return { type: "binary", path: first, compiler: null };
}

export class CppAdapter implements DebugAdapter {
	id = "cpp";
	fileExtensions = [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp"];
	displayName = "C/C++ (GDB)";

	private gdbProcess: ChildProcess | null = null;

	/**
	 * Check for GDB 14+ or lldb-dap availability.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult> {
		const gdbVersion = await checkGdbVersion();
		if (gdbVersion >= MIN_GDB_VERSION) {
			return { satisfied: true };
		}

		// Try lldb-dap as fallback
		const hasLldb = await checkLldbDap();
		if (hasLldb) {
			return { satisfied: true };
		}

		if (gdbVersion > 0) {
			return {
				satisfied: false,
				missing: [`gdb ${MIN_GDB_VERSION}+`],
				installHint: `GDB ${gdbVersion} is too old. Install GDB 14+ or lldb-dap. On Ubuntu: apt-get install gdb`,
			};
		}

		return {
			satisfied: false,
			missing: ["gdb", "lldb-dap"],
			installHint: "Install GDB 14+ or LLDB DAP. On Ubuntu: apt-get install gdb. On macOS: xcode-select --install",
		};
	}

	/**
	 * Launch a C/C++ program via GDB's DAP mode (stdin/stdout transport).
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const cwd = config.cwd ?? process.cwd();
		const parsed = parseCommand(config.command);
		let binaryPath: string;

		if (parsed.type === "source" && parsed.compiler) {
			// Compile the source file
			const src = resolvePath(cwd, parsed.path);
			const outName = `krometrail-${Date.now()}`;
			const outPath = join(tmpdir(), outName);

			try {
				await execAsync(`${parsed.compiler} -g -o "${outPath}" "${src}"`, {
					cwd,
					env: { ...process.env, ...config.env },
				});
			} catch (err) {
				throw new LaunchError(`Compilation failed: ${getErrorMessage(err)}`);
			}

			binaryPath = outPath;
		} else if (parsed.type === "build") {
			// Run the build system, then look for binary in common locations
			try {
				await execAsync(config.command, { cwd, env: { ...process.env, ...config.env } });
			} catch (err) {
				throw new LaunchError(`Build failed: ${getErrorMessage(err)}`);
			}
			// Default to looking for binary in cwd — user should specify path explicitly for builds
			binaryPath = resolvePath(cwd, "a.out");
		} else {
			binaryPath = resolvePath(cwd, parsed.path);
		}

		// Determine which debugger to use
		const gdbVersion = await checkGdbVersion();
		const useGdb = gdbVersion >= MIN_GDB_VERSION;
		let debuggerCmd: string;
		let debuggerArgs: string[];

		if (useGdb) {
			debuggerCmd = "gdb";
			debuggerArgs = ["--interpreter=dap"];
		} else {
			debuggerCmd = "lldb-dap";
			debuggerArgs = [];
		}

		// Spawn GDB/LLDB with DAP mode (stdin/stdout transport)
		const child = spawn(debuggerCmd, debuggerArgs, {
			cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.gdbProcess = child;

		const stderrBuffer: string[] = [];
		child.stderr?.on("data", (data: Buffer) => {
			stderrBuffer.push(data.toString());
		});

		// Wait briefly for early spawn failure
		await detectEarlySpawnFailure(child, debuggerCmd, stderrBuffer, 500);
		if (!child.stdout || !child.stdin) throw new LaunchError(`${debuggerCmd} stdio not available`);

		return {
			reader: child.stdout,
			writer: child.stdin,
			process: child,
			launchArgs: {
				// GDB sends `initialized` immediately after `initialize`, so `launch`
				// must be sent before `configurationDone` (use launch-first flow).
				_dapFlow: "launch-first",
				program: binaryPath,
				cwd,
				env: config.env ?? {},
			},
		};
	}

	/**
	 * Attach GDB/LLDB to a running process by PID.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		const gdbVersion = await checkGdbVersion();
		const useGdb = gdbVersion >= MIN_GDB_VERSION;

		const debuggerCmd = useGdb ? "gdb" : "lldb-dap";
		const debuggerArgs = useGdb ? ["--interpreter=dap"] : [];

		const child = spawn(debuggerCmd, debuggerArgs, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.gdbProcess = child;

		const stderrBuffer: string[] = [];
		child.stderr?.on("data", (data: Buffer) => {
			stderrBuffer.push(data.toString());
		});

		await detectEarlySpawnFailure(child, debuggerCmd, stderrBuffer, 500);
		if (!child.stdout || !child.stdin) throw new LaunchError(`${debuggerCmd} stdio not available`);

		return {
			reader: child.stdout,
			writer: child.stdin,
			process: child,
			launchArgs: {
				request: "attach",
				pid: config.pid,
			},
		};
	}

	async dispose(): Promise<void> {
		// GDB DAP uses stdin/stdout, no socket to close
		await gracefulDispose(null, this.gdbProcess);
		this.gdbProcess = null;
	}
}
