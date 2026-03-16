import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { resolve as resolvePath } from "node:path";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_FAST, checkCommand, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";
import { getJsDebugAdapterPath, runJsDebugParentSession } from "./js-debug-adapter.js";

export class BunAdapter implements DebugAdapter {
	id = "bun";
	fileExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
	aliases = ["bun"];
	displayName = "Bun (inspector)";

	private adapterProcess: ChildProcess | null = null;
	private bunProcess: ChildProcess | null = null;
	private socket: Socket | null = null;
	private parentSocket: Socket | null = null;

	checkPrerequisites(): Promise<PrerequisiteResult> {
		return checkCommand({
			cmd: "bun",
			args: ["--version"],
			missing: ["bun"],
			installHint: "Install Bun from https://bun.sh",
		});
	}

	/**
	 * Launch a Bun script for debugging via js-debug.
	 *
	 * Bun exposes the V8 inspector protocol (--inspect) but does NOT expose the
	 * Node.js HTTP /json/list discovery endpoint that js-debug uses for `launch`.
	 * Instead we:
	 *   1. Spawn Bun with --inspect-brk=127.0.0.1:<port> (halts at first line).
	 *   2. Parse the WebSocket URL from Bun's stderr output.
	 *   3. Run a js-debug "parent" session that sends `attach` with `websocketAddress`,
	 *      waits for the `startDebugging` reverse request, and extracts the child
	 *      session config (which contains __pendingTargetId).
	 *   4. Open a fresh "child" socket to js-debug and return it — this is what the
	 *      session manager will use for the actual debug session.
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection> {
		const dapAdapterPath = await getJsDebugAdapterPath();
		const dapPort = await allocatePort();
		const inspectPort = config.port ?? (await allocatePort());
		const { script, args } = parseBunCommand(config.command);
		const cwd = config.cwd ?? process.cwd();
		const absScript = resolvePath(cwd, script);

		// Spawn js-debug DAP adapter server.
		const { process: adapterProc } = await spawnAndWait({
			cmd: "node",
			args: [dapAdapterPath, String(dapPort), "127.0.0.1"],
			cwd,
			env: { ...process.env, ...config.env },
			readyPattern: /listening/i,
			timeoutMs: 10_000,
			label: "js-debug",
		});
		this.adapterProcess = adapterProc;

		// Spawn Bun with --inspect-brk so it pauses before any user code executes.
		// Use explicit 127.0.0.1 — Bun defaults "localhost" to ::1 on many Linux systems.
		const { process: bunProc, stderrBuffer } = await spawnAndWait({
			cmd: "bun",
			args: [`--inspect-brk=127.0.0.1:${inspectPort}`, absScript, ...args],
			cwd,
			env: { ...process.env, ...config.env },
			readyPattern: /ws:\/\//,
			timeoutMs: 10_000,
			label: "bun",
		});
		this.bunProcess = bunProc;

		// Parse the WebSocket URL from Bun's startup banner, e.g.:
		//   ws://127.0.0.1:6499/<uuid>
		const wsMatch = stderrBuffer.match(/ws:\/\/[^\s]+/);
		const websocketAddress = wsMatch ? wsMatch[0] : undefined;

		// Run the js-debug parent session: send `attach` (with websocketAddress so
		// js-debug can connect to Bun's inspector WebSocket directly), wait for the
		// `startDebugging` reverse request, and return the child session config.
		const parentSocket = await connectTCP("127.0.0.1", dapPort, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.parentSocket = parentSocket;

		const childConfig = await runJsDebugParentSession(parentSocket, {
			flow: "attach",
			timeoutMs: 15_000,
			args: {
				type: "pwa-node",
				port: inspectPort,
				host: "127.0.0.1",
				...(websocketAddress ? { websocketAddress } : {}),
			},
		});

		// Connect the child session — this is what the session manager will use.
		const childSocket = await connectTCP("127.0.0.1", dapPort, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
		this.socket = childSocket;

		return {
			reader: childSocket,
			writer: childSocket,
			process: adapterProc,
			launchArgs: {
				...childConfig,
				_dapFlow: "standard-attach",
			},
		};
	}

	/**
	 * Attach to an already-running Bun inspector via the js-debug adapter.
	 * Start Bun externally with: bun --inspect=127.0.0.1:<port> script.ts
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

		const socket = await connectTCP("127.0.0.1", dapPort, CONNECT_FAST.maxRetries, CONNECT_FAST.retryDelayMs);
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

	async dispose(): Promise<void> {
		await gracefulDispose(this.socket, this.adapterProcess);
		if (this.parentSocket) {
			this.parentSocket.destroy();
			this.parentSocket = null;
		}
		if (this.bunProcess) {
			this.bunProcess.kill();
			this.bunProcess = null;
		}
		this.socket = null;
		this.adapterProcess = null;
	}
}

/**
 * Parse a Bun command string, stripping "bun run" or "bun" prefix if present.
 * E.g., "bun run script.ts --verbose" => { script: "script.ts", args: ["--verbose"] }
 */
export function parseBunCommand(command: string): { script: string; args: string[] } {
	const parts = command.trim().split(/\s+/);
	let i = 0;

	if (parts[i] === "bun") i++;
	if (parts[i] === "run") i++;

	// Strip --inspect* flags (handled by the adapter)
	while (parts[i]?.startsWith("--inspect")) i++;

	const script = parts[i] ?? "";
	const args = parts.slice(i + 1);

	return { script, args };
}
