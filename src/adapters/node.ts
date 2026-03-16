import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { resolve as resolvePath } from "node:path";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_FAST, checkCommandVersioned, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";
import { getJsDebugAdapterPath, runJsDebugParentSession } from "./js-debug-adapter.js";

export class NodeAdapter implements DebugAdapter {
	id = "node";
	fileExtensions = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx"];
	aliases = ["javascript", "typescript", "js", "ts"];
	displayName = "Node.js (inspector)";

	private adapterProcess: ChildProcess | null = null;
	private socket: Socket | null = null;
	/** Parent socket for the js-debug "launcher" session (kept alive during debugging). */
	private parentSocket: Socket | null = null;

	/**
	 * Check for Node.js 18+ availability.
	 */
	checkPrerequisites(): Promise<PrerequisiteResult> {
		return checkCommandVersioned({
			cmd: "node",
			args: ["--version"],
			versionRegex: /^v(\d+)/,
			minVersion: 18,
			missing: ["node"],
			installHint: (v) => (v === 0 ? "Install Node.js 18+ from https://nodejs.org" : `Node.js ${v} is too old. Install Node.js 18+ from https://nodejs.org`),
		});
	}

	/**
	 * Launch a Node.js script via the js-debug DAP adapter.
	 *
	 * js-debug uses a two-session model: a "parent" session that handles the launch
	 * and sends a `startDebugging` reverse request, and a "child" session (new TCP
	 * connection) that is the actual debug session where breakpoints are hit.
	 * We run the parent session internally here, then return the child socket.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const dapAdapterPath = await getJsDebugAdapterPath();
		const port = config.port ?? (await allocatePort());
		const { script, args } = parseNodeCommand(config.command);
		const cwd = config.cwd ?? process.cwd();
		const absScript = resolvePath(cwd, script);

		// Spawn the js-debug DAP adapter server and wait for it to start listening
		const { process: adapterProc } = await spawnAndWait({
			cmd: "node",
			args: [dapAdapterPath, String(port), "127.0.0.1"],
			cwd,
			env: { ...process.env, ...config.env },
			readyPattern: /listening/i,
			timeoutMs: 10_000,
			label: "js-debug",
		});

		this.adapterProcess = adapterProc;

		// Run the parent DAP session to get the child configuration from `startDebugging`.
		const parentSocket = await connectTCP("127.0.0.1", port, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.parentSocket = parentSocket;

		const childConfig = await runJsDebugParentSession(parentSocket, {
			flow: "launch",
			args: {
				type: "pwa-node",
				program: absScript,
				args,
				cwd,
				sourceMaps: true,
				noDebug: false,
				stopOnEntry: false,
				env: config.env ?? {},
			},
		});

		// Connect the child session — this is what the session manager will use.
		const childSocket = await connectTCP("127.0.0.1", port, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.socket = childSocket;

		return {
			reader: childSocket,
			writer: childSocket,
			process: adapterProc,
			launchArgs: {
				// Child config includes __pendingTargetId that js-debug uses to bind the session.
				...childConfig,
				// Tell session-manager to use "attach" (not "launch") with standard initialization flow.
				_dapFlow: "standard-attach",
			},
		};
	}

	/**
	 * Attach to an already-running Node.js inspector via the js-debug adapter.
	 */
	async attach(config: AttachConfig): Promise<DAPConnection> {
		const dapAdapterPath = await getJsDebugAdapterPath();
		const dapPort = await allocatePort();

		const { process: adapterProc } = await spawnAndWait({
			cmd: "node",
			args: [dapAdapterPath, String(dapPort), "127.0.0.1"],
			readyPattern: /listening/i,
			timeoutMs: 10_000,
			label: "js-debug",
		});

		this.adapterProcess = adapterProc;

		const socket = await connectTCP("127.0.0.1", dapPort, 5, 300);
		this.socket = socket;

		return {
			reader: socket,
			writer: socket,
			process: adapterProc,
			launchArgs: {
				type: "pwa-node",
				request: "attach",
				port: config.port ?? 9229,
				host: config.host ?? "127.0.0.1",
				...(config.pid ? { processId: config.pid } : {}),
			},
		};
	}

	/**
	 * Kill the js-debug adapter process and close the sockets.
	 */
	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.adapterProcess);
		if (this.parentSocket) {
			this.parentSocket.destroy();
			this.parentSocket = null;
		}
		this.socket = null;
		this.adapterProcess = null;
	}
}

/**
 * Run the js-debug "parent" DAP session and wait for the `startDebugging` reverse request.
 *
 * js-debug's launch flow sends a `startDebugging` reverse request to the client, which
 * specifies the configuration for the "child" session (the actual debug session). We run
 * the parent session here internally and return the child configuration.
 *
 * @param socket  An already-connected socket to js-debug's DAP server.
 * @param launchArgs  The DAP launch arguments to send to the parent session.
 * @returns  The child session configuration from `startDebugging.arguments.configuration`.
 */
/**
 * Parse a Node.js command string, stripping "node" prefix if present.
 * E.g., "node app.js --verbose" => { script: "app.js", args: ["--verbose"] }
 * Handles "node" and "node --" prefixes.
 */
export function parseNodeCommand(command: string): { script: string; args: string[] } {
	const parts = command.trim().split(/\s+/);
	let i = 0;

	// Strip "node" prefix
	if (parts[i] === "node") {
		i++;
	}

	// Strip "--" separator if present
	if (parts[i] === "--") {
		i++;
	}

	// Strip --inspect* flags (these are handled by the adapter)
	while (parts[i]?.startsWith("--inspect")) {
		i++;
	}

	const script = parts[i] ?? "";
	const args = parts.slice(i + 1);

	return { script, args };
}
