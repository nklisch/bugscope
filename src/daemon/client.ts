import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { AgentLensError } from "../core/errors.js";
import type { JsonRpcResponse } from "./protocol.js";

export interface DaemonClientOptions {
	/** Path to the Unix domain socket. */
	socketPath: string;
	/** Request timeout in ms. Default: 60000. */
	requestTimeoutMs: number;
}

/**
 * Client for communicating with the daemon over a Unix domain socket.
 * Each CLI command creates a short-lived client, sends one request, and exits.
 */
export class DaemonClient {
	private options: DaemonClientOptions;
	private requestId = 0;

	constructor(options: DaemonClientOptions) {
		this.options = options;
	}

	/**
	 * Send a JSON-RPC request and wait for the response.
	 */
	async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
		const id = ++this.requestId;
		const request = {
			jsonrpc: "2.0",
			id,
			method,
			...(params !== undefined && { params }),
		};

		return new Promise<T>((resolve, reject) => {
			const socket = connect(this.options.socketPath, () => {
				socket.write(`${JSON.stringify(request)}\n`);
			});

			let buffer = "";
			let timedOut = false;

			const timer = setTimeout(() => {
				timedOut = true;
				socket.destroy();
				reject(new Error(`Request "${method}" timed out after ${this.options.requestTimeoutMs}ms`));
			}, this.options.requestTimeoutMs);

			socket.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				const newlineIdx = buffer.indexOf("\n");
				if (newlineIdx !== -1) {
					clearTimeout(timer);
					const line = buffer.slice(0, newlineIdx);
					socket.destroy();

					try {
						const response = JSON.parse(line) as JsonRpcResponse;
						if (response.error) {
							const err = new AgentLensError(response.error.message, String(response.error.code));
							reject(err);
						} else {
							resolve(response.result as T);
						}
					} catch (parseErr) {
						reject(new Error(`Failed to parse daemon response: ${(parseErr as Error).message}`));
					}
				}
			});

			socket.on("error", (err: NodeJS.ErrnoException) => {
				if (timedOut) return;
				clearTimeout(timer);
				if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
					reject(new Error(`Daemon is not running. Start it with the first agent-lens command.`));
				} else {
					reject(err);
				}
			});

			socket.on("close", () => {
				if (timedOut) return;
				// If closed without receiving a response, that's an error
				if (buffer && !buffer.includes("\n")) {
					clearTimeout(timer);
					reject(new Error("Connection closed before response received"));
				}
			});
		});
	}

	/**
	 * Check if the daemon is alive by sending a ping.
	 */
	async ping(): Promise<boolean> {
		try {
			await this.call("daemon.ping");
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Dispose: no-op for this implementation (connections are per-call).
	 */
	dispose(): void {
		// Each call creates its own socket; nothing to clean up here
	}
}

/**
 * Ensure a daemon is running. If not, spawn one and wait for it to be ready.
 */
export async function ensureDaemon(socketPath: string): Promise<void> {
	const client = new DaemonClient({ socketPath, requestTimeoutMs: 2_000 });

	// Try to ping existing daemon
	if (await client.ping()) {
		return;
	}

	// Check PID file for stale daemon
	const { getDaemonPidPath } = await import("./protocol.js");
	const pidPath = getDaemonPidPath();

	if (existsSync(pidPath)) {
		try {
			const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
			if (!Number.isNaN(pid)) {
				// Check if process is alive
				try {
					process.kill(pid, 0); // Signal 0 = just check existence
					// Process is alive but not responding — wait briefly and retry
					await new Promise((resolve) => setTimeout(resolve, 500));
					if (await client.ping()) {
						return;
					}
				} catch {
					// Process is dead (ESRCH) — stale PID file, proceed to spawn
				}
			}
		} catch {
			// PID file unreadable — proceed to spawn
		}
	}

	// Spawn new daemon
	await spawnDaemon(socketPath);
}

async function spawnDaemon(socketPath: string): Promise<void> {
	const { spawn } = await import("node:child_process");

	// Determine how to spawn the daemon
	let command: string;
	let args: string[];

	// In compiled bun binaries, import.meta.url is "file:///$bunfs/..." (virtual FS).
	// process.argv[0] is "bun" in both cases, so we must use import.meta.url to detect.
	const isCompiledBinary = import.meta.url.includes("/$bunfs/");

	if (isCompiledBinary) {
		// Running as compiled binary — spawn self (process.execPath) with _daemon subcommand
		command = process.execPath;
		args = ["_daemon"];
	} else {
		// Running via bun — spawn the entry file
		const entryPath = new URL("./entry.js", import.meta.url).pathname;
		command = "bun";
		args = ["run", entryPath];
	}

	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();

	// Poll until daemon responds
	const maxAttempts = 10;
	const delayMs = 200;
	const client = new DaemonClient({ socketPath, requestTimeoutMs: 1_000 });

	for (let i = 0; i < maxAttempts; i++) {
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		if (await client.ping()) {
			return;
		}
	}

	throw new Error(`Daemon failed to start within ${maxAttempts * delayMs}ms. ` + `Check that '${command}' is available and the socket path is writable: ${socketPath}`);
}
