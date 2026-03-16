import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import type { Socket } from "node:net";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_SLOW, checkCommand, connectTCP, detectEarlySpawnFailure, gracefulDispose } from "./helpers.js";

export class RubyAdapter implements DebugAdapter {
	id = "ruby";
	fileExtensions = [".rb"];
	displayName = "Ruby (rdbg)";

	private process: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for Ruby 3.1+ and rdbg (debug gem) availability.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult> {
		const rdbg = await checkCommand({
			cmd: "rdbg",
			args: ["--version"],
			missing: ["rdbg"],
			installHint: "gem install debug (requires Ruby 3.1+)",
		});
		if (rdbg.satisfied) return rdbg;

		// rdbg not found — check if ruby itself is present for a better hint
		const ruby = await checkCommand({
			cmd: "ruby",
			args: ["--version"],
			missing: ["ruby", "rdbg"],
			installHint: "Install Ruby 3.1+ from https://www.ruby-lang.org, then: gem install debug",
		});
		const base = ruby.satisfied ? rdbg : ruby;
		return { ...base, fixCommand: "gem install debug" };
	}

	/**
	 * Launch a Ruby script via rdbg in DAP TCP server mode.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const port = config.port ?? (await allocatePort());
		const { script, args } = parseRubyCommand(config.command);
		const cwd = config.cwd ?? process.cwd();

		// Validate script path exists
		const absScript = isAbsolute(script) ? script : resolvePath(cwd, script);
		await access(absScript).catch(() => {
			throw new LaunchError(`Script not found: ${absScript}`, "");
		});

		// rdbg --open listens on TCP; the greeting handler auto-detects DAP
		// when the client sends Content-Length framing (standard DAP transport).
		// Do NOT pass a frontend name (=dap/=vscode) — those are for IDE launchers.
		const child = spawn("rdbg", ["--open", `--port=${port}`, "--host=127.0.0.1", absScript, ...args], {
			cwd,
			env: { ...process.env, ...config.env },
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process = child;

		const stderrBuffer: string[] = [];
		child.stderr?.on("data", (data: Buffer) => {
			stderrBuffer.push(data.toString());
		});
		child.stdout?.on("data", (data: Buffer) => {
			stderrBuffer.push(data.toString());
		});

		// Wait briefly for early spawn failure
		await detectEarlySpawnFailure(child, "rdbg", stderrBuffer, 500);

		// Poll TCP until rdbg is ready
		const socket = await connectTCP("127.0.0.1", port, CONNECT_SLOW.maxRetries, CONNECT_SLOW.retryDelayMs).catch((err) => {
			child.kill();
			throw new LaunchError(`Could not connect to rdbg on port ${port}: ${err.message}. output: ${stderrBuffer.join("")}`, stderrBuffer.join(""));
		});

		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: child,
			launchArgs: {
				// rdbg --open requires launch before setBreakpoints to initialize
				// local_fs_map (local_to_remote_path returns nil otherwise → "not available").
				// launch-first sends launch, then awaits initialized, then setBreakpoints.
				_dapFlow: "launch-first",
				type: "rdbg",
				cwd,
				env: config.env ?? {},
				script: absScript,
				command: "ruby",
				args,
			},
		};
	}

	/**
	 * Attach to an already-running rdbg DAP server.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		const host = config.host ?? "127.0.0.1";
		const port = config.port ?? 12345;

		const socket = await connectTCP(host, port);
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
		};
	}

	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.process);
		this.socket = null;
		this.process = null;
	}
}

/**
 * Parse a Ruby command string, stripping "ruby" prefix if present.
 * E.g., "ruby app.rb --verbose" => { script: "app.rb", args: ["--verbose"] }
 */
export function parseRubyCommand(command: string): { script: string; args: string[] } {
	const parts = command.trim().split(/\s+/);
	let i = 0;

	// Strip "ruby" prefix
	if (parts[i] === "ruby") {
		i++;
	}

	const script = parts[i] ?? "";
	const args = parts.slice(i + 1);

	return { script, args };
}
