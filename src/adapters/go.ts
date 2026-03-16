import type { ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import type { Socket } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_FAST, checkCommand, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";

/**
 * Build an augmented PATH that includes common Go binary install locations
 * ($GOPATH/bin, ~/go/bin) so dlv is found even when not in the shell PATH.
 */
function goEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
	const goBin = process.env.GOPATH ? join(process.env.GOPATH, "bin") : join(homedir(), "go", "bin");
	const currentPath = process.env.PATH ?? "";
	const augmentedPath = currentPath.includes(goBin) ? currentPath : `${goBin}:${currentPath}`;
	return { ...process.env, PATH: augmentedPath, ...extra };
}

export class GoAdapter implements DebugAdapter {
	id = "go";
	fileExtensions = [".go"];
	displayName = "Go (Delve)";

	private dlvProcess: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for Delve (dlv) availability.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult> {
		const result = await checkCommand({
			cmd: "dlv",
			args: ["version"],
			env: goEnv(),
			missing: ["dlv"],
			installHint: "go install github.com/go-delve/delve/cmd/dlv@latest",
		});
		if (!result.satisfied) return { ...result, fixCommand: "go install github.com/go-delve/delve/cmd/dlv@latest" };
		return result;
	}

	/**
	 * Launch a Go program via Delve's DAP server.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const port = config.port ?? (await allocatePort());
		const cwd = config.cwd ?? process.cwd();
		const parsed = parseGoCommand(config.command);
		const absProgram = isAbsolute(parsed.program) ? parsed.program : resolvePath(cwd, parsed.program);

		// Validate the program path exists for exec mode (binary) and absolute file paths
		if (parsed.mode === "exec" || (parsed.mode === "debug" && isAbsolute(parsed.program))) {
			await access(absProgram).catch(() => {
				throw new LaunchError(`Program not found: ${absProgram}`, "");
			});
		}

		// Spawn Delve as a DAP server
		const { process: dlvProc } = await spawnAndWait({
			cmd: "dlv",
			args: ["dap", "--listen", `127.0.0.1:${port}`],
			cwd,
			env: goEnv(config.env),
			readyPattern: /DAP server listening at/i,
			timeoutMs: 15_000,
			label: "dlv",
		});

		this.dlvProcess = dlvProc;

		// Connect TCP with retries — Delve can take a moment to accept connections
		const socket = await connectTCP("127.0.0.1", port, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: dlvProc,
			launchArgs: {
				// Delve sends `initialized` immediately after `initialize`, so `launch`
				// must be sent before `configurationDone` (use launch-first flow).
				_dapFlow: "launch-first",
				mode: parsed.mode,
				program: absProgram,
				args: parsed.args,
				cwd,
				buildFlags: parsed.buildFlags,
			},
		};
	}

	/**
	 * Attach to an already-running Go process via Delve.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		const port = config.port ?? (await allocatePort());

		const { process: dlvProc } = await spawnAndWait({
			cmd: "dlv",
			args: ["dap", "--listen", `127.0.0.1:${port}`],
			env: goEnv(config.env),
			readyPattern: /DAP server listening at/i,
			timeoutMs: 10_000,
			label: "dlv",
		});

		this.dlvProcess = dlvProc;

		const socket = await connectTCP("127.0.0.1", port, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: dlvProc,
			launchArgs: {
				mode: "local",
				processId: config.pid,
			},
		};
	}

	/**
	 * Kill the Delve process and close the socket.
	 */
	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.dlvProcess);
		this.socket = null;
		this.dlvProcess = null;
	}
}

/**
 * Parse a Go command string.
 * E.g., "go run main.go" => { mode: "debug", program: "main.go", args: [] }
 *       "./mybinary --flag" => { mode: "exec", program: "./mybinary", args: ["--flag"] }
 *       "go test ./..." => { mode: "test", program: "./...", args: [] }
 */
export function parseGoCommand(command: string): {
	mode: "debug" | "exec" | "test";
	program: string;
	buildFlags?: string[];
	args: string[];
} {
	const parts = command.trim().split(/\s+/);
	let i = 0;

	// "go run ..." or "go test ..."
	if (parts[i] === "go") {
		i++;
		if (parts[i] === "run") {
			i++;
			// Collect build flags (start with -)
			const buildFlags: string[] = [];
			while (parts[i]?.startsWith("-")) {
				buildFlags.push(parts[i]);
				i++;
			}
			const program = parts[i] ?? "";
			const args = parts.slice(i + 1);
			return { mode: "debug", program, buildFlags: buildFlags.length > 0 ? buildFlags : undefined, args };
		}
		if (parts[i] === "test") {
			i++;
			const program = parts[i] ?? "./...";
			const args = parts.slice(i + 1);
			return { mode: "test", program, args };
		}
	}

	// Bare binary: "./mybinary --flag" or "/abs/path/to/binary"
	const program = parts[i] ?? "";
	const args = parts.slice(i + 1);
	return { mode: "exec", program, args };
}
