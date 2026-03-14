import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import { resolve as resolvePath } from "node:path";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, CONNECT_FAST, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";
import { getJsDebugAdapterPath } from "./js-debug-adapter.js";

export class BunAdapter implements DebugAdapter {
	id = "bun";
	fileExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs"];
	aliases = ["bun"];
	displayName = "Bun (inspector)";

	private adapterProcess: ChildProcess | null = null;
	private bunProcess: ChildProcess | null = null;
	private socket: Socket | null = null;
	private parentSocket: Socket | null = null;

	async checkPrerequisites(): Promise<PrerequisiteResult> {
		return new Promise((resolve) => {
			const proc = spawn("bun", ["--version"], { stdio: "pipe" });
			proc.on("close", (code) => {
				if (code !== 0) {
					resolve({ satisfied: false, missing: ["bun"], installHint: "Install Bun from https://bun.sh" });
				} else {
					resolve({ satisfied: true });
				}
			});
			proc.on("error", () => {
				resolve({ satisfied: false, missing: ["bun"], installHint: "Install Bun from https://bun.sh" });
			});
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

		const childConfig = await runJsDebugBunParentSession(parentSocket, {
			type: "pwa-node",
			port: inspectPort,
			host: "127.0.0.1",
			...(websocketAddress ? { websocketAddress } : {}),
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
 * Run the js-debug "parent" DAP session for Bun, sending `attach` (with websocketAddress)
 * instead of `launch`. Waits for the `startDebugging` reverse request and returns the
 * child session configuration that contains __pendingTargetId.
 *
 * This mirrors runJsDebugParentSession in node.ts but uses the attach path so that
 * js-debug connects to Bun's V8 inspector WebSocket directly rather than trying to
 * discover it via the Node.js /json/list HTTP endpoint (which Bun does not expose).
 */
async function runJsDebugBunParentSession(socket: Socket, attachArgs: Record<string, unknown>): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let buf = Buffer.alloc(0);
		let seq = 1;
		let settled = false;

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				socket.removeListener("data", onData);
				reject(new Error("js-debug/bun: startDebugging not received within 15s"));
			}
		}, 15_000);

		function sendRequest(cmd: string, args?: Record<string, unknown>): void {
			const json = JSON.stringify({ seq: seq++, type: "request", command: cmd, arguments: args });
			socket.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
		}

		function sendResponse(requestSeq: number, cmd: string): void {
			const json = JSON.stringify({ seq: seq++, type: "response", request_seq: requestSeq, success: true, command: cmd, body: {} });
			socket.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
		}

		function handleMessage(msg: Record<string, unknown>): void {
			const type = msg.type as string;
			const cmd = (msg.command ?? msg.event) as string;

			if (type === "event" && cmd === "initialized") {
				// Bun's attach flow: initialized arrives as an event (not tied to initialize response).
				// Send configurationDone then attach.
				sendRequest("configurationDone");
				sendRequest("attach", attachArgs);
			} else if (type === "request") {
				if (cmd === "startDebugging" && !settled) {
					settled = true;
					clearTimeout(timer);
					socket.removeListener("data", onData);
					sendResponse(msg.seq as number, "startDebugging");
					const config = (msg.arguments as Record<string, unknown>).configuration as Record<string, unknown>;
					resolve(config);
				} else {
					sendResponse(msg.seq as number, cmd);
				}
			}
		}

		function onData(chunk: Buffer): void {
			buf = Buffer.concat([buf, chunk]);
			while (true) {
				const headerEnd = buf.indexOf("\r\n\r\n");
				if (headerEnd === -1) break;
				const header = buf.subarray(0, headerEnd).toString();
				const match = header.match(/Content-Length:\s*(\d+)/i);
				if (!match) {
					buf = buf.subarray(headerEnd + 4);
					continue;
				}
				const len = Number.parseInt(match[1], 10);
				const start = headerEnd + 4;
				if (buf.length < start + len) break;
				const bodyStr = buf.subarray(start, start + len).toString();
				buf = buf.subarray(start + len);
				try {
					handleMessage(JSON.parse(bodyStr) as Record<string, unknown>);
				} catch {
					// ignore malformed JSON
				}
			}
		}

		socket.on("data", onData);
		socket.once("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(err);
			}
		});

		// Kick off the parent session.
		sendRequest("initialize", {
			clientID: "krometrail",
			adapterID: "krometrail",
			supportsVariableType: true,
			linesStartAt1: true,
			columnsStartAt1: true,
			supportsStartDebuggingRequest: true,
		});
	});
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
