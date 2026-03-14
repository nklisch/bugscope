# Design: Phase 2 — CLI & Distribution

## Overview

Phase 2 makes the CLI a first-class interface with full command parity to MCP. An agent with bash access and the skill file can debug as effectively as one using MCP. The design covers: a session daemon that persists debug sessions across sequential CLI commands, all CLI commands wired through the daemon, output formatting (text/JSON/quiet), the agent skill file, binary distribution via `bun build --compile`, and the `doctor` utility command.

Phase 2 builds on the complete Phase 1 foundation: `SessionManager` (840 lines), `DAPClient`, `PythonAdapter`, 16 MCP tools, viewport renderer, value renderer, and the existing CLI stub (`src/cli/index.ts` with a single `launch` subcommand).

**Key architectural decision:** The CLI commands do NOT embed `SessionManager` directly. Instead, they communicate with a lightweight background daemon over a Unix domain socket using JSON-RPC. The daemon hosts the same `SessionManager` instance that the MCP server uses. This allows sequential CLI commands (`krometrail launch`, `krometrail step`, `krometrail eval`) to share a persistent debug session.

---

## Implementation Units

### Unit 1: Daemon Protocol Types & JSON-RPC Layer

**File**: `src/daemon/protocol.ts`

Defines the JSON-RPC message types and method signatures for CLI-to-daemon communication. Every `SessionManager` public method gets a corresponding RPC method.

```typescript
import { z } from "zod";

// --- JSON-RPC 2.0 Base Types ---

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// Standard JSON-RPC error codes
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

// Application error codes (krometrail specific)
export const RPC_SESSION_NOT_FOUND = -32000;
export const RPC_SESSION_STATE_ERROR = -32001;
export const RPC_SESSION_LIMIT_ERROR = -32002;
export const RPC_ADAPTER_ERROR = -32003;
export const RPC_LAUNCH_ERROR = -32004;

// --- RPC Method Definitions ---

/**
 * Maps each RPC method name to its params and result types.
 * The daemon dispatches based on method name and validates params with Zod.
 */
export type RpcMethods = {
	// Lifecycle
	"session.launch": { params: LaunchParams; result: LaunchResultPayload };
	"session.stop": { params: SessionIdParams; result: StopResultPayload };
	"session.status": { params: SessionIdParams; result: StatusResultPayload };

	// Execution control
	"session.continue": { params: ContinueParams; result: ViewportPayload };
	"session.step": { params: StepParams; result: ViewportPayload };
	"session.runTo": { params: RunToParams; result: ViewportPayload };

	// Breakpoints
	"session.setBreakpoints": { params: SetBreakpointsParams; result: BreakpointsResultPayload };
	"session.setExceptionBreakpoints": { params: SetExceptionBreakpointsParams; result: void };
	"session.listBreakpoints": { params: SessionIdParams; result: BreakpointsListPayload };

	// State inspection
	"session.evaluate": { params: EvaluateParams; result: string };
	"session.variables": { params: VariablesParams; result: string };
	"session.stackTrace": { params: StackTraceParams; result: string };
	"session.source": { params: SourceParams; result: string };

	// Session intelligence
	"session.watch": { params: WatchParams; result: string[] };
	"session.sessionLog": { params: SessionLogParams; result: string };
	"session.output": { params: OutputParams; result: string };

	// Daemon control
	"daemon.ping": { params: undefined; result: { uptime: number; sessions: number } };
	"daemon.shutdown": { params: undefined; result: void };
};

// --- Param Schemas (Zod) ---

export const SessionIdParamsSchema = z.object({
	sessionId: z.string(),
});
export type SessionIdParams = z.infer<typeof SessionIdParamsSchema>;

export const LaunchParamsSchema = z.object({
	command: z.string(),
	language: z.string().optional(),
	breakpoints: z
		.array(
			z.object({
				file: z.string(),
				breakpoints: z.array(
					z.object({
						line: z.number(),
						condition: z.string().optional(),
						hitCondition: z.string().optional(),
						logMessage: z.string().optional(),
					}),
				),
			}),
		)
		.optional(),
	cwd: z.string().optional(),
	env: z.record(z.string(), z.string()).optional(),
	viewportConfig: z
		.object({
			sourceContextLines: z.number().optional(),
			stackDepth: z.number().optional(),
			localsMaxDepth: z.number().optional(),
			localsMaxItems: z.number().optional(),
			stringTruncateLength: z.number().optional(),
			collectionPreviewItems: z.number().optional(),
		})
		.optional(),
	stopOnEntry: z.boolean().optional(),
});
export type LaunchParams = z.infer<typeof LaunchParamsSchema>;

export const ContinueParamsSchema = z.object({
	sessionId: z.string(),
	timeoutMs: z.number().optional(),
});
export type ContinueParams = z.infer<typeof ContinueParamsSchema>;

export const StepParamsSchema = z.object({
	sessionId: z.string(),
	direction: z.enum(["over", "into", "out"]),
	count: z.number().optional(),
});
export type StepParams = z.infer<typeof StepParamsSchema>;

export const RunToParamsSchema = z.object({
	sessionId: z.string(),
	file: z.string(),
	line: z.number(),
	timeoutMs: z.number().optional(),
});
export type RunToParams = z.infer<typeof RunToParamsSchema>;

export const SetBreakpointsParamsSchema = z.object({
	sessionId: z.string(),
	file: z.string(),
	breakpoints: z.array(
		z.object({
			line: z.number(),
			condition: z.string().optional(),
			hitCondition: z.string().optional(),
			logMessage: z.string().optional(),
		}),
	),
});
export type SetBreakpointsParams = z.infer<typeof SetBreakpointsParamsSchema>;

export const SetExceptionBreakpointsParamsSchema = z.object({
	sessionId: z.string(),
	filters: z.array(z.string()),
});
export type SetExceptionBreakpointsParams = z.infer<typeof SetExceptionBreakpointsParamsSchema>;

export const EvaluateParamsSchema = z.object({
	sessionId: z.string(),
	expression: z.string(),
	frameIndex: z.number().optional(),
	maxDepth: z.number().optional(),
});
export type EvaluateParams = z.infer<typeof EvaluateParamsSchema>;

export const VariablesParamsSchema = z.object({
	sessionId: z.string(),
	scope: z.enum(["local", "global", "closure", "all"]).optional(),
	frameIndex: z.number().optional(),
	filter: z.string().optional(),
	maxDepth: z.number().optional(),
});
export type VariablesParams = z.infer<typeof VariablesParamsSchema>;

export const StackTraceParamsSchema = z.object({
	sessionId: z.string(),
	maxFrames: z.number().optional(),
	includeSource: z.boolean().optional(),
});
export type StackTraceParams = z.infer<typeof StackTraceParamsSchema>;

export const SourceParamsSchema = z.object({
	sessionId: z.string(),
	file: z.string(),
	startLine: z.number().optional(),
	endLine: z.number().optional(),
});
export type SourceParams = z.infer<typeof SourceParamsSchema>;

export const WatchParamsSchema = z.object({
	sessionId: z.string(),
	expressions: z.array(z.string()),
});
export type WatchParams = z.infer<typeof WatchParamsSchema>;

export const SessionLogParamsSchema = z.object({
	sessionId: z.string(),
	format: z.enum(["summary", "detailed"]).optional(),
});
export type SessionLogParams = z.infer<typeof SessionLogParamsSchema>;

export const OutputParamsSchema = z.object({
	sessionId: z.string(),
	stream: z.enum(["stdout", "stderr", "both"]).optional(),
	sinceAction: z.number().optional(),
});
export type OutputParams = z.infer<typeof OutputParamsSchema>;

// --- Result Payloads ---

export interface LaunchResultPayload {
	sessionId: string;
	viewport?: string;
	status: string;
}

export interface StopResultPayload {
	duration: number;
	actionCount: number;
}

export interface StatusResultPayload {
	status: string;
	viewport?: string;
}

export interface ViewportPayload {
	viewport: string;
}

export interface BreakpointsResultPayload {
	breakpoints: Array<{ line?: number; verified: boolean; message?: string }>;
}

export interface BreakpointsListPayload {
	files: Record<string, Array<{ line: number; condition?: string; hitCondition?: string; logMessage?: string }>>;
}

// --- Socket Path Resolution ---

/**
 * Resolve the daemon socket path.
 * Uses $XDG_RUNTIME_DIR/krometrail.sock if available,
 * falls back to ~/.krometrail/krometrail.sock.
 */
export function getDaemonSocketPath(): string;

/**
 * Resolve the daemon PID file path (socket path + ".pid").
 */
export function getDaemonPidPath(): string;
```

**Implementation Notes**:
- `getDaemonSocketPath()` checks `process.env.XDG_RUNTIME_DIR` first, then falls back to `path.join(os.homedir(), ".krometrail")`. Creates the directory if it doesn't exist (`mkdirSync(..., { recursive: true })`). Returns the full path to `krometrail.sock`.
- `getDaemonPidPath()` returns `getDaemonSocketPath() + ".pid"`.
- All RPC param schemas use Zod for validation. The daemon validates incoming params before dispatching.
- The `RpcMethods` type map is used by both client and server for type safety but not at runtime — it's a compile-time contract.

**Acceptance Criteria**:
- [ ] All Zod schemas parse valid inputs and reject invalid ones
- [ ] `getDaemonSocketPath()` returns `$XDG_RUNTIME_DIR/krometrail.sock` when env is set
- [ ] `getDaemonSocketPath()` returns `~/.krometrail/krometrail.sock` as fallback
- [ ] `getDaemonPidPath()` returns socket path + `.pid`
- [ ] Type exports compile without errors

---

### Unit 2: Daemon Server

**File**: `src/daemon/server.ts`

The daemon is a background process that hosts `SessionManager` and listens on a Unix domain socket. It receives JSON-RPC requests from CLI commands, dispatches them to the session manager, and returns results.

```typescript
import type { Server } from "node:net";
import type { SessionManager } from "../core/session-manager.js";

export interface DaemonOptions {
	/** Path to the Unix domain socket. */
	socketPath: string;
	/** Path to the PID file. */
	pidPath: string;
	/** Idle timeout in ms before auto-shutdown. Default: 60000. */
	idleTimeoutMs: number;
}

export const DEFAULT_DAEMON_OPTIONS: DaemonOptions = {
	socketPath: "", // resolved at startup
	pidPath: "",
	idleTimeoutMs: 60_000,
};

/**
 * The daemon process manages a SessionManager and listens for
 * JSON-RPC requests over a Unix domain socket.
 */
export class DaemonServer {
	private server: Server | null;
	private sessionManager: SessionManager;
	private options: DaemonOptions;
	private idleTimer: ReturnType<typeof setTimeout> | null;
	private startedAt: number;
	private activeConnections: Set<import("node:net").Socket>;

	constructor(sessionManager: SessionManager, options: DaemonOptions);

	/**
	 * Start the daemon: bind the Unix socket, write PID file, begin listening.
	 * Removes stale socket file if it exists.
	 */
	start(): Promise<void>;

	/**
	 * Shut down: close all connections, clean up sessions,
	 * remove socket file, remove PID file.
	 */
	shutdown(): Promise<void>;

	/**
	 * Handle a single JSON-RPC request by dispatching to the session manager.
	 * Validates params with the corresponding Zod schema.
	 * Returns a JSON-RPC response.
	 */
	private handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;

	/**
	 * Dispatch a validated RPC method call to SessionManager.
	 */
	private dispatch(method: string, params: Record<string, unknown>): Promise<unknown>;

	/**
	 * Reset the idle timer. Called on every incoming request.
	 * When the timer fires and no active sessions exist, auto-shutdown.
	 */
	private resetIdleTimer(): void;

	/**
	 * Handle a new socket connection: buffer incoming data,
	 * parse newline-delimited JSON-RPC messages, send responses.
	 */
	private handleConnection(socket: import("node:net").Socket): void;
}

/**
 * Entry point for spawning the daemon as a background process.
 * Called by the CLI when no daemon is running.
 *
 * 1. Creates SessionManager with default limits
 * 2. Registers adapters
 * 3. Creates DaemonServer
 * 4. Calls start()
 * 5. Handles SIGINT/SIGTERM for graceful shutdown
 */
export async function startDaemon(): Promise<void>;
```

**Implementation Notes**:
- **Socket protocol:** Newline-delimited JSON (`\n` as message separator). Each line is one JSON-RPC request or response. This is simpler than length-prefixed framing and works well for the expected message sizes.
- **`start()`:** Uses `net.createServer()`. Before binding, checks if the socket file exists. If it does, try to connect to it — if the connection succeeds, another daemon is running (throw error). If connection fails (ECONNREFUSED), the socket is stale — `unlinkSync` it. Then bind, listen, and write PID file (`writeFileSync(pidPath, String(process.pid))`).
- **`handleConnection()`:** Each incoming socket buffers data. On each `data` event, split by `\n`, parse each complete line as a JSON-RPC request, call `handleRequest()`, write the response as a JSON line + `\n` back to the socket. Use a per-connection buffer to handle partial reads.
- **`dispatch()`:** A switch on `method` string that maps to `SessionManager` methods:
  - `"session.launch"` → `sessionManager.launch(params)` returning `LaunchResultPayload`
  - `"session.stop"` → `sessionManager.stop(params.sessionId)` returning `StopResultPayload`
  - `"session.continue"` → `sessionManager.continue(...)` returning `{ viewport }`
  - `"session.step"` → `sessionManager.step(...)` returning `{ viewport }`
  - (etc. for all methods)
  - `"daemon.ping"` → `{ uptime: Date.now() - this.startedAt, sessions: ... }`
  - `"daemon.shutdown"` → `this.shutdown()`
- **Error mapping:** Catch `KrometrailError` subclasses and map to appropriate `JsonRpcError` codes using the constants from `protocol.ts`. Unknown errors map to `RPC_INTERNAL_ERROR`.
- **Idle timeout:** After every request or session stop, check if there are zero active sessions. If so, start the idle timer. If a new request arrives, clear the timer. When the timer fires with zero active sessions, call `shutdown()`.
- **`startDaemon()`:** This is the entry point for the daemon subprocess. It's invoked by `src/daemon/entry.ts` (see Unit 3). It registers adapters, creates SessionManager with default ResourceLimits, creates DaemonServer, and calls `start()`.
- **SIGINT/SIGTERM handlers:** Call `shutdown()` then `process.exit(0)`.
- **Process cleanup on shutdown:** `sessionManager.disposeAll()` terminates all active debug sessions and their debugee processes.

**Acceptance Criteria**:
- [ ] Daemon binds to Unix domain socket and accepts connections
- [ ] JSON-RPC requests are dispatched to the correct SessionManager methods
- [ ] Malformed JSON-RPC returns parse error response (not crash)
- [ ] Unknown method returns method-not-found error
- [ ] Invalid params return invalid-params error with Zod details
- [ ] `KrometrailError` subclasses map to correct RPC error codes
- [ ] Stale socket file is cleaned up on start
- [ ] PID file is written on start and removed on shutdown
- [ ] Idle timer shuts down daemon after `idleTimeoutMs` with no active sessions
- [ ] SIGINT/SIGTERM trigger graceful shutdown (sessions disposed, files cleaned)
- [ ] Multiple concurrent connections handled correctly

---

### Unit 3: Daemon Entry Point & Spawning

**File**: `src/daemon/entry.ts`

Standalone entry point that the CLI spawns as a detached background process.

```typescript
/**
 * Daemon entry point — spawned as a detached background process by the CLI.
 * This file is the target of `bun run src/daemon/entry.ts`.
 *
 * Registers adapters, creates SessionManager, starts DaemonServer.
 * Detaches stdio so the parent CLI process can exit.
 */

import { PythonAdapter } from "../adapters/python.js";
import { registerAdapter } from "../adapters/registry.js";
import { SessionManager } from "../core/session-manager.js";
import { ResourceLimitsSchema } from "../core/types.js";
import { DaemonServer } from "./server.js";
import { getDaemonPidPath, getDaemonSocketPath } from "./protocol.js";

// Register adapters (same as mcp/index.ts)
registerAdapter(new PythonAdapter());

const limits = ResourceLimitsSchema.parse({});
const sessionManager = new SessionManager(limits);

const server = new DaemonServer(sessionManager, {
	socketPath: getDaemonSocketPath(),
	pidPath: getDaemonPidPath(),
	idleTimeoutMs: 60_000,
});

await server.start();
```

**Implementation Notes**:
- This file is intentionally side-effect-only (no exports). It's the spawn target.
- Future adapters (Node.js, Go) will be registered here as they're implemented.
- The file mirrors `src/mcp/index.ts` in structure — same adapter registration, same SessionManager creation, different transport.

**Acceptance Criteria**:
- [ ] `bun run src/daemon/entry.ts` starts a daemon that listens on the socket
- [ ] Process can be spawned detached (`child_process.spawn` with `detached: true, stdio: "ignore"`)

---

### Unit 4: Daemon Client

**File**: `src/daemon/client.ts`

The CLI-side client that connects to the daemon over the Unix socket and sends JSON-RPC requests.

```typescript
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

	constructor(options: DaemonClientOptions);

	/**
	 * Send a JSON-RPC request and wait for the response.
	 * Opens a connection, sends the request, reads the response, closes.
	 *
	 * Throws if:
	 * - Connection fails (ECONNREFUSED → daemon not running)
	 * - Timeout exceeded
	 * - Response contains a JSON-RPC error
	 */
	call<T>(method: string, params?: Record<string, unknown>): Promise<T>;

	/**
	 * Check if the daemon is alive by sending a ping.
	 * Returns false if connection fails.
	 */
	ping(): Promise<boolean>;

	/**
	 * Dispose: close the underlying socket if still open.
	 */
	dispose(): void;
}

/**
 * Ensure a daemon is running. If not, spawn one and wait for it to be ready.
 *
 * 1. Try to ping the daemon at the socket path.
 * 2. If ping succeeds, return (daemon already running).
 * 3. If ping fails, check PID file:
 *    a. If PID file exists and process is alive, wait briefly and retry ping.
 *    b. If PID file is stale or doesn't exist, spawn a new daemon.
 * 4. Spawn: `child_process.spawn("bun", ["run", daemonEntryPath], { detached: true, stdio: "ignore" })`.
 *    Unref the child so the CLI process can exit.
 * 5. Poll ping() up to 10 times with 200ms delay until daemon responds.
 * 6. If daemon doesn't start within timeout, throw with diagnostic message.
 */
export async function ensureDaemon(socketPath: string): Promise<void>;
```

**Implementation Notes**:
- **`call()` flow:** Create a `net.Socket()`, connect to `socketPath`. Write the JSON-RPC request as a JSON line + `\n`. Read the response (buffer until `\n`), parse as `JsonRpcResponse`. If `response.error`, throw an `KrometrailError` with the error message and code. Close socket. Use a timeout via `setTimeout` that destroys the socket on expiry.
- **`ping()`:** Calls `this.call("daemon.ping")` wrapped in try/catch. Returns `true` on success, `false` on any error.
- **`ensureDaemon()` spawn details:**
  - The daemon entry path is resolved relative to the package: use `import.meta.resolve("./entry.ts")` to get the absolute path, then strip the `file://` prefix.
  - For compiled binaries, the entry point will be different — the daemon will be a subcommand of the compiled binary itself (`krometrail _daemon`). Handle both cases: if running from source, spawn `bun run <entry.ts>`; if running as compiled binary, spawn `<binary> _daemon`.
  - Detect compiled mode: check if `process.argv[0]` does NOT end in `bun` and the binary exists.
  - Spawning: `spawn(command, args, { detached: true, stdio: "ignore", env: process.env })`. Call `child.unref()` to let the parent exit.
- **Request ID tracking:** Use a simple incrementing counter. Since each CLI invocation creates a fresh client, starting at 1 is fine.
- **Timeout:** The `requestTimeoutMs` default of 60000 is generous because `session.launch` can take several seconds (debugpy startup) and `session.continue` blocks until a breakpoint is hit (up to `stepTimeoutMs`).

**Acceptance Criteria**:
- [ ] `call()` sends valid JSON-RPC and parses the response
- [ ] `call()` throws descriptive error when daemon is not running (ECONNREFUSED)
- [ ] `call()` throws on timeout with descriptive message
- [ ] `call()` throws `KrometrailError` when response contains JSON-RPC error
- [ ] `ping()` returns `true` for a running daemon, `false` when down
- [ ] `ensureDaemon()` spawns a daemon when none is running
- [ ] `ensureDaemon()` detects an already-running daemon and returns immediately
- [ ] `ensureDaemon()` handles stale PID files (dead process)
- [ ] Spawned daemon process is detached (CLI process can exit immediately)

---

### Unit 5: Breakpoint String Parser

**File**: `src/cli/parsers.ts`

Parses the compact CLI breakpoint syntax into structured `Breakpoint` types.

```typescript
import type { Breakpoint } from "../core/types.js";

/**
 * A file-grouped breakpoint set, ready for the session manager.
 */
export interface FileBreakpoints {
	file: string;
	breakpoints: Breakpoint[];
}

/**
 * Parse a CLI breakpoint string into structured breakpoint(s).
 *
 * Supported formats:
 *   "file:line"                           → simple breakpoint
 *   "file:line,line,line"                 → multiple lines in same file
 *   "file:line when <condition>"          → conditional breakpoint
 *   "file:line hit >=N"                   → hit count condition
 *   "file:line log '<message>'"           → logpoint
 *   "file:line when <cond> log '<msg>'"   → conditional logpoint
 *
 * Examples:
 *   "order.py:147"
 *   "order.py:147,150,155"
 *   "order.py:147 when discount < 0"
 *   "order.py:147 hit >=100"
 *   "order.py:147 log 'discount={discount}'"
 *
 * @throws Error if the string cannot be parsed
 */
export function parseBreakpointString(input: string): FileBreakpoints;

/**
 * Parse a "file:line" or "file:start-end" source range string.
 *
 * Examples:
 *   "discount.py"          → { file: "discount.py" }
 *   "discount.py:15"       → { file: "discount.py", startLine: 15 }
 *   "discount.py:15-30"    → { file: "discount.py", startLine: 15, endLine: 30 }
 */
export function parseSourceRange(input: string): {
	file: string;
	startLine?: number;
	endLine?: number;
};

/**
 * Parse a "file:line" location string for run-to.
 *
 * Example: "order.py:150" → { file: "order.py", line: 150 }
 *
 * @throws Error if the string cannot be parsed
 */
export function parseLocation(input: string): { file: string; line: number };
```

**Implementation Notes**:
- **`parseBreakpointString()` algorithm:**
  1. Split on the first `:` to get `file` and `rest`.
  2. From `rest`, extract line number(s) — split on `,` for multi-line, each must be a valid integer.
  3. Check for `when `, `hit `, `log ` keywords in the remainder:
     - `when <expr>` → sets `condition` on all breakpoints for this file
     - `hit <expr>` → sets `hitCondition` (e.g., `>=100`, `==5`)
     - `log '<message>'` or `log "<message>"` → sets `logMessage`
  4. Keywords can appear in any order after the line numbers.
  5. Regex approach: After extracting `file:lines`, match against `/\bwhen\s+(.+?)(?=\s+(?:hit|log)\b|$)/`, `/\bhit\s+(\S+)/`, `/\blog\s+(['"])(.*?)\1/`.
- **`parseSourceRange()`:** Split on `:`. If second part contains `-`, split on `-` for start and end. Otherwise it's a single line (startLine only).
- **`parseLocation()`:** Split on `:`. Both parts required. Validate line is a positive integer.

**Acceptance Criteria**:
- [ ] `parseBreakpointString("order.py:147")` → `{ file: "order.py", breakpoints: [{ line: 147 }] }`
- [ ] `parseBreakpointString("order.py:147,150,155")` → 3 breakpoints
- [ ] `parseBreakpointString("order.py:147 when discount < 0")` → condition set
- [ ] `parseBreakpointString("order.py:147 hit >=100")` → hitCondition set
- [ ] `parseBreakpointString("order.py:147 log 'discount={discount}'")` → logMessage set
- [ ] `parseBreakpointString("order.py:147 when discount < 0 log 'bad'")` → both condition and logMessage
- [ ] `parseSourceRange("discount.py:15-30")` → startLine: 15, endLine: 30
- [ ] `parseLocation("order.py:150")` → { file: "order.py", line: 150 }
- [ ] Invalid inputs throw descriptive errors

---

### Unit 6: CLI Output Formatting

**File**: `src/cli/format.ts`

Handles the three output modes: default text viewport, `--json` structured JSON, and `--quiet` minimal output.

```typescript
import type { ViewportSnapshot } from "../core/types.js";
import type {
	LaunchResultPayload,
	StopResultPayload,
	StatusResultPayload,
	BreakpointsResultPayload,
	BreakpointsListPayload,
} from "../daemon/protocol.js";

/**
 * Output mode determined by CLI flags.
 */
export type OutputMode = "text" | "json" | "quiet";

/**
 * Resolve output mode from CLI flags.
 */
export function resolveOutputMode(flags: { json?: boolean; quiet?: boolean }): OutputMode;

/**
 * Format a launch result for CLI output.
 */
export function formatLaunch(result: LaunchResultPayload, mode: OutputMode): string;

/**
 * Format a stop result for CLI output.
 */
export function formatStop(result: StopResultPayload, sessionId: string, mode: OutputMode): string;

/**
 * Format a status result for CLI output.
 */
export function formatStatus(result: StatusResultPayload, mode: OutputMode): string;

/**
 * Format a viewport string for CLI output.
 * In text mode: print as-is.
 * In quiet mode: print as-is (viewport already is the minimal form).
 * In JSON mode: wrap in a JSON object with viewport field.
 */
export function formatViewport(viewport: string, mode: OutputMode): string;

/**
 * Format an evaluate result.
 */
export function formatEvaluate(expression: string, result: string, mode: OutputMode): string;

/**
 * Format a variables result.
 */
export function formatVariables(result: string, mode: OutputMode): string;

/**
 * Format a stack trace result.
 */
export function formatStackTrace(result: string, mode: OutputMode): string;

/**
 * Format a breakpoint set result.
 */
export function formatBreakpointsSet(file: string, result: BreakpointsResultPayload, mode: OutputMode): string;

/**
 * Format a breakpoint list result.
 */
export function formatBreakpointsList(result: BreakpointsListPayload, mode: OutputMode): string;

/**
 * Format an error for CLI output.
 * In text mode: "Error: <message>"
 * In JSON mode: { "error": "<message>", "code": "<code>" }
 */
export function formatError(error: Error, mode: OutputMode): string;
```

**Implementation Notes**:
- **Text mode (default):**
  - `formatLaunch()`: Print `Session started: <id>\n` then viewport if present, or `Status: <status>` if running.
  - `formatStop()`: Print `Session <id> ended. Duration: <duration>s, Actions: <count>`.
  - `formatStatus()`: Print `Status: <status>\n` then viewport if stopped.
  - `formatViewport()`: Print viewport string as-is (it's already formatted by `renderViewport()`).
  - `formatEvaluate()`: Print `<expression> = <result>`.
  - `formatError()`: Print `Error: <message>` to stderr.
- **JSON mode (`--json`):**
  - All formatters return `JSON.stringify(payload, null, 2)` where payload is the raw result object, with viewport included as a `viewport` string field.
  - Errors return `{ "error": message, "code": code }`.
- **Quiet mode (`--quiet`):**
  - `formatLaunch()`: Viewport only, no session ID banner.
  - `formatStop()`: Empty string (nothing to show).
  - `formatViewport()`: Viewport as-is.
  - `formatEvaluate()`: Just the value, no expression prefix.
  - Suppress all chrome (session IDs, banners, status lines).
- **`resolveOutputMode()`:** If `json` is true, return `"json"`. Else if `quiet` is true, return `"quiet"`. Else return `"text"`.

**Acceptance Criteria**:
- [ ] Text mode produces human-readable output with session IDs and banners
- [ ] JSON mode produces valid JSON matching the expected schema for every command
- [ ] Quiet mode suppresses banners and chrome, showing only viewport/value
- [ ] Errors format appropriately in all three modes
- [ ] `resolveOutputMode()` correctly prioritizes json over quiet

---

### Unit 7: CLI Commands

**File**: `src/cli/commands/index.ts` (rewrite) + `src/cli/index.ts` (rewrite)

Implement all CLI commands using citty, each sending a JSON-RPC request to the daemon via `DaemonClient`.

**File**: `src/cli/index.ts`

```typescript
import { defineCommand, runMain } from "citty";
// Import all command definitions
import {
	launchCommand,
	stopCommand,
	statusCommand,
	continueCommand,
	stepCommand,
	runToCommand,
	breakCommand,
	breakpointsCommand,
	evalCommand,
	varsCommand,
	stackCommand,
	sourceCommand,
	watchCommand,
	logCommand,
	outputCommand,
	doctorCommand,
} from "./commands/index.js";

const main = defineCommand({
	meta: {
		name: "krometrail",
		version: "0.1.0",
		description: "Runtime debugging viewport for AI coding agents",
	},
	subCommands: {
		launch: launchCommand,
		stop: stopCommand,
		status: statusCommand,
		continue: continueCommand,
		step: stepCommand,
		"run-to": runToCommand,
		break: breakCommand,
		breakpoints: breakpointsCommand,
		eval: evalCommand,
		vars: varsCommand,
		stack: stackCommand,
		source: sourceCommand,
		watch: watchCommand,
		log: logCommand,
		output: outputCommand,
		doctor: doctorCommand,
		// Hidden: internal daemon entry point
		_daemon: () => import("../daemon/entry.js"),
	},
});

runMain(main);
```

**File**: `src/cli/commands/index.ts`

```typescript
import { defineCommand } from "citty";
import { DaemonClient, ensureDaemon } from "../../daemon/client.js";
import { getDaemonSocketPath } from "../../daemon/protocol.js";
import type {
	LaunchResultPayload,
	StopResultPayload,
	StatusResultPayload,
	ViewportPayload,
	BreakpointsResultPayload,
	BreakpointsListPayload,
} from "../../daemon/protocol.js";
import {
	formatLaunch,
	formatStop,
	formatStatus,
	formatViewport,
	formatEvaluate,
	formatVariables,
	formatStackTrace,
	formatBreakpointsSet,
	formatBreakpointsList,
	formatError,
	resolveOutputMode,
} from "../format.js";
import { parseBreakpointString, parseLocation, parseSourceRange } from "../parsers.js";

// --- Shared Args ---

const globalArgs = {
	json: {
		type: "boolean" as const,
		description: "Output as JSON instead of viewport text",
		default: false,
	},
	quiet: {
		type: "boolean" as const,
		description: "Viewport only, no banners or hints",
		default: false,
	},
	session: {
		type: "string" as const,
		description: "Target a specific session (required when multiple active)",
		alias: "s",
	},
};

/**
 * Helper: create a DaemonClient, ensuring daemon is running first.
 */
async function getClient(): Promise<DaemonClient> {
	const socketPath = getDaemonSocketPath();
	await ensureDaemon(socketPath);
	return new DaemonClient({ socketPath, requestTimeoutMs: 60_000 });
}

/**
 * Helper: resolve session ID. If --session is provided, use it.
 * Otherwise, call daemon.ping to get the active session count.
 * If exactly one session, auto-resolve. If multiple, error.
 */
async function resolveSessionId(
	client: DaemonClient,
	explicitSession?: string,
): Promise<string>;

// --- Session Lifecycle ---

export const launchCommand = defineCommand({
	meta: { name: "launch", description: "Launch a debug session" },
	args: {
		command: {
			type: "positional",
			description: "Command to debug, e.g. 'python app.py'",
			required: true,
		},
		break: {
			type: "string",
			description: "Set breakpoint(s), e.g. 'order.py:147' or 'order.py:147 when discount < 0'",
			alias: "b",
		},
		language: {
			type: "string",
			description: "Override language detection",
		},
		"stop-on-entry": {
			type: "boolean",
			description: "Pause on first executable line",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const breakpoints = args.break
				? [parseBreakpointString(args.break)]
				: undefined;

			const result = await client.call<LaunchResultPayload>("session.launch", {
				command: args.command,
				language: args.language,
				breakpoints: breakpoints?.map((fb) => ({
					file: fb.file,
					breakpoints: fb.breakpoints,
				})),
				stopOnEntry: args["stop-on-entry"],
			});

			process.stdout.write(formatLaunch(result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const stopCommand = defineCommand({
	meta: { name: "stop", description: "Terminate a debug session" },
	args: { ...globalArgs },
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<StopResultPayload>("session.stop", {
				sessionId,
			});
			process.stdout.write(formatStop(result, sessionId, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const statusCommand = defineCommand({
	meta: { name: "status", description: "Check session status" },
	args: { ...globalArgs },
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<StatusResultPayload>("session.status", {
				sessionId,
			});
			process.stdout.write(formatStatus(result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

// --- Execution Control ---

export const continueCommand = defineCommand({
	meta: { name: "continue", description: "Resume execution to next breakpoint" },
	args: {
		timeout: {
			type: "string",
			description: "Max wait time in ms",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<ViewportPayload>("session.continue", {
				sessionId,
				timeoutMs: args.timeout ? Number.parseInt(args.timeout, 10) : undefined,
			});
			process.stdout.write(formatViewport(result.viewport, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const stepCommand = defineCommand({
	meta: { name: "step", description: "Step execution (over, into, or out)" },
	args: {
		direction: {
			type: "positional",
			description: "Step direction: over, into, or out",
			required: true,
		},
		count: {
			type: "string",
			description: "Number of steps",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const direction = args.direction as "over" | "into" | "out";
			if (!["over", "into", "out"].includes(direction)) {
				throw new Error(`Invalid step direction: ${direction}. Must be 'over', 'into', or 'out'.`);
			}
			const result = await client.call<ViewportPayload>("session.step", {
				sessionId,
				direction,
				count: args.count ? Number.parseInt(args.count, 10) : undefined,
			});
			process.stdout.write(formatViewport(result.viewport, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const runToCommand = defineCommand({
	meta: { name: "run-to", description: "Run to a specific file:line" },
	args: {
		location: {
			type: "positional",
			description: "Target location, e.g. 'order.py:150'",
			required: true,
		},
		timeout: {
			type: "string",
			description: "Max wait time in ms",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const { file, line } = parseLocation(args.location);
			const result = await client.call<ViewportPayload>("session.runTo", {
				sessionId,
				file,
				line,
				timeoutMs: args.timeout ? Number.parseInt(args.timeout, 10) : undefined,
			});
			process.stdout.write(formatViewport(result.viewport, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

// --- Breakpoints ---

export const breakCommand = defineCommand({
	meta: {
		name: "break",
		description: "Set breakpoints, exception breakpoints, or clear breakpoints",
	},
	args: {
		breakpoint: {
			type: "positional",
			description: "Breakpoint spec: 'file:line[,line] [when cond] [hit cond] [log msg]'",
		},
		exceptions: {
			type: "string",
			description: "Set exception breakpoint filter (e.g. 'uncaught', 'raised')",
		},
		clear: {
			type: "string",
			description: "Clear all breakpoints in a file",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);

			if (args.exceptions) {
				// Exception breakpoints
				await client.call("session.setExceptionBreakpoints", {
					sessionId,
					filters: [args.exceptions],
				});
				process.stdout.write(
					mode === "json"
						? JSON.stringify({ filters: [args.exceptions] }, null, 2) + "\n"
						: `Exception breakpoints set: ${args.exceptions}\n`,
				);
			} else if (args.clear) {
				// Clear breakpoints in file
				await client.call("session.setBreakpoints", {
					sessionId,
					file: args.clear,
					breakpoints: [],
				});
				process.stdout.write(
					mode === "json"
						? JSON.stringify({ cleared: args.clear }, null, 2) + "\n"
						: `Breakpoints cleared: ${args.clear}\n`,
				);
			} else if (args.breakpoint) {
				// Set breakpoints
				const parsed = parseBreakpointString(args.breakpoint);
				const result = await client.call<BreakpointsResultPayload>(
					"session.setBreakpoints",
					{
						sessionId,
						file: parsed.file,
						breakpoints: parsed.breakpoints,
					},
				);
				process.stdout.write(
					formatBreakpointsSet(parsed.file, result, mode) + "\n",
				);
			} else {
				throw new Error(
					"Usage: krometrail break <file:line> | --exceptions <filter> | --clear <file>",
				);
			}
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const breakpointsCommand = defineCommand({
	meta: { name: "breakpoints", description: "List all active breakpoints" },
	args: { ...globalArgs },
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<BreakpointsListPayload>(
				"session.listBreakpoints",
				{ sessionId },
			);
			process.stdout.write(formatBreakpointsList(result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

// --- State Inspection ---

export const evalCommand = defineCommand({
	meta: { name: "eval", description: "Evaluate an expression" },
	args: {
		expression: {
			type: "positional",
			description: "Expression to evaluate, e.g. 'cart.items[0].__dict__'",
			required: true,
		},
		frame: {
			type: "string",
			description: "Stack frame index (0 = current)",
		},
		depth: {
			type: "string",
			description: "Object expansion depth",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<string>("session.evaluate", {
				sessionId,
				expression: args.expression,
				frameIndex: args.frame ? Number.parseInt(args.frame, 10) : undefined,
				maxDepth: args.depth ? Number.parseInt(args.depth, 10) : undefined,
			});
			process.stdout.write(formatEvaluate(args.expression, result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const varsCommand = defineCommand({
	meta: { name: "vars", description: "Show variables" },
	args: {
		scope: {
			type: "string",
			description: "Variable scope: local, global, closure, or all",
		},
		filter: {
			type: "string",
			description: "Regex filter on variable names",
		},
		frame: {
			type: "string",
			description: "Stack frame index (0 = current)",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<string>("session.variables", {
				sessionId,
				scope: args.scope,
				frameIndex: args.frame ? Number.parseInt(args.frame, 10) : undefined,
				filter: args.filter,
			});
			process.stdout.write(formatVariables(result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const stackCommand = defineCommand({
	meta: { name: "stack", description: "Show call stack" },
	args: {
		frames: {
			type: "string",
			description: "Maximum frames to show",
		},
		source: {
			type: "boolean",
			description: "Include source context per frame",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<string>("session.stackTrace", {
				sessionId,
				maxFrames: args.frames ? Number.parseInt(args.frames, 10) : undefined,
				includeSource: args.source,
			});
			process.stdout.write(formatStackTrace(result, mode) + "\n");
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const sourceCommand = defineCommand({
	meta: { name: "source", description: "View source code" },
	args: {
		target: {
			type: "positional",
			description: "File path, optionally with line range: 'file.py:15-30'",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const { file, startLine, endLine } = parseSourceRange(args.target);
			const result = await client.call<string>("session.source", {
				sessionId,
				file,
				startLine,
				endLine,
			});
			if (mode === "json") {
				process.stdout.write(JSON.stringify({ file, source: result }, null, 2) + "\n");
			} else {
				process.stdout.write(result + "\n");
			}
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

// --- Session Intelligence ---

export const watchCommand = defineCommand({
	meta: { name: "watch", description: "Add watch expressions" },
	args: {
		expressions: {
			type: "positional",
			description: "Expression(s) to watch",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			// Citty collects remaining positional args in args._
			const expressions = [args.expressions, ...(args._ ?? [])];
			const result = await client.call<string[]>("session.watch", {
				sessionId,
				expressions,
			});
			if (mode === "json") {
				process.stdout.write(JSON.stringify({ watchExpressions: result }, null, 2) + "\n");
			} else {
				process.stdout.write(`Watch expressions (${result.length} total):\n`);
				for (const expr of result) {
					process.stdout.write(`  ${expr}\n`);
				}
			}
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const logCommand = defineCommand({
	meta: { name: "log", description: "View session investigation log" },
	args: {
		detailed: {
			type: "boolean",
			description: "Show detailed log with timestamps",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const result = await client.call<string>("session.sessionLog", {
				sessionId,
				format: args.detailed ? "detailed" : "summary",
			});
			if (mode === "json") {
				process.stdout.write(JSON.stringify({ log: result }, null, 2) + "\n");
			} else {
				process.stdout.write(result + "\n");
			}
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

export const outputCommand = defineCommand({
	meta: { name: "output", description: "View captured program output" },
	args: {
		stderr: {
			type: "boolean",
			description: "Show only stderr",
			default: false,
		},
		stdout: {
			type: "boolean",
			description: "Show only stdout",
			default: false,
		},
		"since-action": {
			type: "string",
			description: "Only show output since action N",
		},
		...globalArgs,
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		const client = await getClient();
		try {
			const sessionId = await resolveSessionId(client, args.session);
			const stream = args.stderr ? "stderr" : args.stdout ? "stdout" : "both";
			const result = await client.call<string>("session.output", {
				sessionId,
				stream,
				sinceAction: args["since-action"]
					? Number.parseInt(args["since-action"], 10)
					: undefined,
			});
			if (mode === "json") {
				process.stdout.write(JSON.stringify({ output: result, stream }, null, 2) + "\n");
			} else {
				process.stdout.write(result || "No output captured.\n");
			}
		} catch (err) {
			process.stderr.write(formatError(err as Error, mode) + "\n");
			process.exit(1);
		} finally {
			client.dispose();
		}
	},
});

// --- Doctor (see Unit 8) ---

export { doctorCommand } from "./doctor.js";
```

**Implementation Notes**:
- **`resolveSessionId()`:** The daemon needs a way to report its active sessions. Add a `"daemon.sessions"` RPC method that returns `Array<{ id: string; status: string }>`. If the list has exactly one session, auto-resolve its ID. If multiple, require `--session`. If zero, throw "No active sessions". This avoids the need to store session IDs in files.
- **`getClient()`:** Every command calls this. It ensures the daemon is running (spawning if needed) and returns a fresh client. The client is disposed in `finally` blocks.
- **Exit codes:** `process.exit(0)` on success (implicit), `process.exit(1)` on error, `process.exit(2)` on timeout (detect by checking if error is `DAPTimeoutError`).
- **`_daemon` hidden subcommand:** When the compiled binary needs to spawn itself as the daemon, it runs `krometrail _daemon`. This is a hidden subcommand that imports `src/daemon/entry.ts`.
- **`--break` flag on `launch`:** Currently accepts a single string. For multiple breakpoints, the user calls `krometrail break` after launching. The `--break` flag on launch is a convenience for the most common case.
- **`watch` command with multiple args:** Citty collects remaining positional args in `args._`. The command gathers the named positional plus any extras.

**Acceptance Criteria**:
- [ ] All 16 commands are registered as subcommands
- [ ] Each command connects to daemon, sends correct RPC method, formats output
- [ ] `--json` flag produces valid JSON on all commands
- [ ] `--quiet` flag suppresses chrome on all commands
- [ ] `--session` flag targets a specific session
- [ ] Auto-session-resolution works with single active session
- [ ] Error with clear message when multiple sessions and no `--session` flag
- [ ] Exit code 1 on error, 2 on timeout
- [ ] `_daemon` hidden subcommand spawns daemon entry point

---

### Unit 8: Doctor Command

**File**: `src/cli/commands/doctor.ts`

The `doctor` command checks system readiness — available debuggers, versions, and platform info.

```typescript
import { defineCommand } from "citty";
import { listAdapters } from "../../adapters/registry.js";
import { PythonAdapter } from "../../adapters/python.js";
import { registerAdapter } from "../../adapters/registry.js";
import type { OutputMode } from "../format.js";
import { resolveOutputMode } from "../format.js";

export interface DoctorResult {
	platform: string;
	runtime: string;
	runtimeVersion: string;
	adapters: Array<{
		id: string;
		displayName: string;
		status: "available" | "missing";
		version?: string;
		installHint?: string;
	}>;
}

/**
 * Run all doctor checks and return structured results.
 * Exported for testing.
 */
export async function runDoctorChecks(): Promise<DoctorResult>;

/**
 * Format doctor results for the chosen output mode.
 */
export function formatDoctor(result: DoctorResult, mode: OutputMode): string;

export const doctorCommand = defineCommand({
	meta: {
		name: "doctor",
		description: "Check installed debuggers and system readiness",
	},
	args: {
		json: {
			type: "boolean",
			description: "Output as JSON",
			default: false,
		},
		quiet: {
			type: "boolean",
			description: "Minimal output",
			default: false,
		},
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);

		// Register adapters directly (doctor doesn't need the daemon)
		registerAdapter(new PythonAdapter());

		const result = await runDoctorChecks();
		process.stdout.write(formatDoctor(result, mode) + "\n");

		// Exit code: 0 if at least one adapter available, 1 if none
		const hasAvailable = result.adapters.some((a) => a.status === "available");
		process.exit(hasAvailable ? 0 : 1);
	},
});
```

**Implementation Notes**:
- **`runDoctorChecks()`:**
  1. Collect platform info: `process.platform`, `process.arch`, Bun version (`Bun.version` or `process.versions.bun`).
  2. Get all registered adapters via `listAdapters()`.
  3. For each adapter, call `checkPrerequisites()`. If satisfied, try to extract version (adapter-specific). If not satisfied, report missing + installHint.
  4. `doctor` does NOT need the daemon — it checks locally by importing and registering adapters directly.
- **Text output format:**
  ```
  Krometrail v0.1.0
  Platform: linux x86_64
  Runtime: Bun 1.x.x

  Adapters:
    [OK]  Python (debugpy)     v1.8.x
    [--]  Node.js (inspector)  not installed — npm install ...
    [--]  Go (delve)           not installed — go install ...
  ```
- **JSON output:** `DoctorResult` object as JSON.
- **Version extraction for Python:** Run `python3 -m debugpy --version` and parse stdout. This is already done in `PythonAdapter.checkPrerequisites()` but doesn't return the version string. We could add an optional `version` field to `PrerequisiteResult`, or extract it separately in doctor.

**Acceptance Criteria**:
- [ ] Reports platform, runtime version
- [ ] For each registered adapter, shows status (available/missing)
- [ ] Shows version when adapter is available
- [ ] Shows install hint when adapter is missing
- [ ] `--json` flag produces valid JSON
- [ ] Exit code 0 when at least one adapter available, 1 when none

---

### Unit 9: Skill File

**File**: `skill.md` (project root, shipped in npm package)

The skill file teaches agents how to use the CLI. It's the content from UX.md's "Agent Skill File" section, refined based on the actual implemented command syntax.

```markdown
# Krometrail — Debugging Skill

You have access to `krometrail`, a CLI debugger. Use it when you need to
inspect runtime state to diagnose a bug — especially when static code
reading and test output aren't enough to identify the root cause.

## Quick start
  krometrail launch "<command>" --break <file>:<line>
  krometrail continue          # run to next breakpoint
  krometrail step into|over|out
  krometrail eval "<expr>"     # evaluate expression at current stop
  krometrail vars              # show local variables
  krometrail stop              # end session

## Conditional breakpoints
  krometrail break "<file>:<line> when <condition>"

## All commands
  krometrail launch "<cmd>" [--break <bp>] [--stop-on-entry] [--language <lang>]
  krometrail stop [--session <id>]
  krometrail status [--session <id>]
  krometrail continue [--timeout <ms>]
  krometrail step over|into|out [--count <n>]
  krometrail run-to <file>:<line> [--timeout <ms>]
  krometrail break <file>:<line>[,<line>,...] [when <cond>] [hit <cond>] [log '<msg>']
  krometrail break --exceptions <filter>
  krometrail break --clear <file>
  krometrail breakpoints
  krometrail eval "<expr>" [--frame <n>] [--depth <n>]
  krometrail vars [--scope local|global|closure|all] [--filter "<regex>"]
  krometrail stack [--frames <n>] [--source]
  krometrail source <file>[:<start>-<end>]
  krometrail watch "<expr>" ["<expr>" ...]
  krometrail log [--detailed]
  krometrail output [--stderr|--stdout] [--since-action <n>]
  krometrail doctor

## Strategy
1. Start by setting a breakpoint where you expect the bug to manifest.
2. Inspect locals. Look for unexpected values.
3. If the bad value came from a function call, set a breakpoint inside
   that function and re-launch.
4. Use `krometrail eval` to test hypotheses without modifying code.
5. Once you identify the root cause, stop the session and fix the code.

## Key rules
- Always call `krometrail stop` when done to clean up.
- Prefer conditional breakpoints over stepping through loops.
- Each command prints a viewport showing source, locals, and stack.
- If a session times out (5 min default), re-launch.
```

Also add a `skill` command to the CLI:

```typescript
// In src/cli/commands/index.ts, add:
export const skillCommand = defineCommand({
	meta: { name: "skill", description: "Print the agent skill file to stdout" },
	args: {},
	async run() {
		const skillPath = new URL("../../../skill.md", import.meta.url);
		const content = await Bun.file(skillPath).text();
		process.stdout.write(content);
	},
});
```

And register in `src/cli/index.ts`:
```typescript
subCommands: {
	// ... existing commands ...
	skill: skillCommand,
}
```

**Implementation Notes**:
- The skill file lives at the project root so it's included in the npm package.
- `krometrail skill` prints it to stdout. An agent can load it via `$(krometrail skill)` or a tool can read it from the known npm path.
- The skill content matches the actual command syntax implemented in Unit 7.

**Acceptance Criteria**:
- [ ] `skill.md` exists at project root
- [ ] `krometrail skill` prints the skill file to stdout
- [ ] Skill file documents all commands with correct syntax
- [ ] Skill file includes strategy guidance for agents

---

### Unit 10: Binary Distribution & Build Config

**File**: `package.json` (update), build scripts

Updates to package.json and build configuration for compiled binary distribution.

```jsonc
// package.json updates:
{
	"bin": {
		"krometrail": "./src/cli/index.ts"
	},
	"files": [
		"src/",
		"skill.md"
	],
	"scripts": {
		// ... existing scripts ...
		"build": "bun build --compile src/cli/index.ts --outfile dist/krometrail",
		"build:linux-x64": "bun build --compile --target=bun-linux-x64 src/cli/index.ts --outfile dist/krometrail-linux-x64",
		"build:linux-arm64": "bun build --compile --target=bun-linux-arm64 src/cli/index.ts --outfile dist/krometrail-linux-arm64",
		"build:darwin-x64": "bun build --compile --target=bun-darwin-x64 src/cli/index.ts --outfile dist/krometrail-darwin-x64",
		"build:darwin-arm64": "bun build --compile --target=bun-darwin-arm64 src/cli/index.ts --outfile dist/krometrail-darwin-arm64",
		"build:windows-x64": "bun build --compile --target=bun-windows-x64 src/cli/index.ts --outfile dist/krometrail-windows-x64.exe",
		"build:all": "bun run build:linux-x64 && bun run build:linux-arm64 && bun run build:darwin-x64 && bun run build:darwin-arm64 && bun run build:windows-x64"
	}
}
```

**Implementation Notes**:
- **`bun build --compile`:** Bundles all dependencies into a single binary. The `--target` flag cross-compiles for different platforms.
- **Daemon spawning in compiled mode:** When the binary detects it's running compiled (not via `bun run`), `ensureDaemon()` spawns `<binary-path> _daemon` instead of `bun run src/daemon/entry.ts`. Detection: check `process.argv[0]` — if it doesn't contain `bun`, we're compiled.
- **`files` field:** Ensures `skill.md` is included in the npm package.
- **`krometrail --version`:** citty handles this via `meta.version`. Should also print platform and Bun version. Add a `setup` hook on the main command to enhance version output.
- **`.gitignore` update:** Add `dist/` to `.gitignore`.

**Acceptance Criteria**:
- [ ] `bun run build` produces a working single-file binary in `dist/`
- [ ] Binary starts, accepts commands, spawns daemon
- [ ] `krometrail --version` prints version, platform, and runtime info
- [ ] `npm pack` includes `src/`, `skill.md`, and `package.json`
- [ ] `dist/` is gitignored

---

### Unit 11: Session Resolution Enhancement

**File**: `src/daemon/server.ts` (addition to dispatch), `src/daemon/protocol.ts` (addition)

The daemon needs to support session listing so the CLI can auto-resolve sessions.

```typescript
// Addition to protocol.ts RpcMethods:
"daemon.sessions": {
	params: undefined;
	result: Array<{ id: string; status: string; language: string; actionCount: number }>;
};
```

```typescript
// Addition to SessionManager — new method:

/**
 * List all active sessions with their status.
 */
listSessions(): Array<{ id: string; status: string; language: string; actionCount: number }>;
```

**Implementation Notes**:
- `SessionManager.listSessions()` iterates `this.sessions` and returns `{ id, status: session.state, language: session.language, actionCount: session.actionCount }` for each.
- The daemon dispatches `"daemon.sessions"` to this method.
- The CLI's `resolveSessionId()` calls `client.call("daemon.sessions")` to get the list. If exactly one session, returns its ID. If multiple, throws with a list of sessions. If zero, throws "No active sessions."

**Acceptance Criteria**:
- [ ] `daemon.sessions` returns list of active sessions
- [ ] Auto-resolution works when exactly one session exists
- [ ] Clear error when multiple sessions exist without `--session` flag
- [ ] Clear error when no sessions exist

---

## Implementation Order

1. **Unit 1: Daemon Protocol Types** — Foundation types for all daemon communication. No dependencies.
2. **Unit 5: Breakpoint String Parser** — Pure functions, no dependencies on daemon. Can be tested immediately.
3. **Unit 6: CLI Output Formatting** — Pure functions, depends only on types from Unit 1. Can be tested immediately.
4. **Unit 2: Daemon Server** — Depends on Unit 1 (protocol types) and the existing `SessionManager`.
5. **Unit 3: Daemon Entry Point** — Depends on Unit 2.
6. **Unit 4: Daemon Client** — Depends on Unit 1 (protocol types) and Unit 3 (for spawning).
7. **Unit 11: Session Resolution** — Small addition to SessionManager and daemon dispatch.
8. **Unit 7: CLI Commands** — Depends on Units 4, 5, 6, 11. The main integration point.
9. **Unit 8: Doctor Command** — Independent of daemon. Can be built in parallel with Units 4-7.
10. **Unit 9: Skill File** — Documentation. Write after commands are finalized.
11. **Unit 10: Binary Distribution** — Build config. After commands work correctly.

```
Unit 1 (protocol) ─┬─→ Unit 2 (daemon server) → Unit 3 (entry) → Unit 4 (client) ─┐
                    │                                                                 │
Unit 5 (parsers) ───┤                                                                 ├─→ Unit 7 (commands) → Unit 9 (skill) → Unit 10 (build)
                    │                                                                 │
Unit 6 (format) ────┘                                  Unit 11 (session resolution) ──┘

Unit 8 (doctor) ── independent, can parallel with Units 2-7
```

---

## Testing

### Unit Tests: `tests/unit/cli/`

**`tests/unit/cli/parsers.test.ts`** — Breakpoint string parser:
- Simple `file:line` parsing
- Multi-line `file:line,line,line`
- Conditional `file:line when expr`
- Hit count `file:line hit >=N`
- Logpoint `file:line log 'message'`
- Combined conditions
- Source range parsing
- Location parsing
- Error cases (malformed input)

**`tests/unit/cli/format.test.ts`** — Output formatting:
- Text mode output for each command type
- JSON mode output validity and structure
- Quiet mode suppression
- Error formatting in all modes

**`tests/unit/daemon/protocol.test.ts`** — Zod schema validation:
- Valid params pass validation
- Invalid params rejected with clear errors
- Socket path resolution with and without XDG_RUNTIME_DIR

### Integration Tests: `tests/integration/`

**`tests/integration/daemon-lifecycle.test.ts`** — Daemon server:
- Start daemon, verify socket created and PID file written
- Send ping, verify response
- Send session.launch, verify session created
- Idle timeout triggers shutdown
- Stale socket cleanup on start
- Graceful shutdown cleans up sessions
- Multiple concurrent connections

**`tests/integration/cli-daemon.test.ts`** — CLI-to-daemon flow:
- `ensureDaemon()` spawns daemon when not running
- `ensureDaemon()` reuses existing daemon
- `DaemonClient.call()` sends and receives correctly
- Session resolution with single/multiple/zero sessions
- Error propagation from daemon to client

### E2E Tests: `tests/e2e/cli/`

**`tests/e2e/cli/debug-session.test.ts`** — Full CLI debug workflow:
- Launch → continue → step → eval → stop sequence via CLI commands
- Reproduce the INTERFACE.md Appendix C scenario
- Verify viewport output format matches MCP output
- Verify `--json` produces valid JSON
- Verify `--quiet` suppresses chrome
- Verify exit codes

**`tests/e2e/cli/breakpoint-parsing.test.ts`** — End-to-end breakpoint flows:
- `krometrail launch "python app.py" --break "order.py:147"`
- `krometrail break "order.py:147 when discount < 0"`
- `krometrail break --clear order.py`
- `krometrail breakpoints` listing

**`tests/e2e/cli/daemon-lifecycle.test.ts`** — Daemon lifecycle:
- First command auto-starts daemon
- Subsequent commands reuse daemon
- `krometrail stop` on last session triggers idle shutdown
- Stale daemon recovery

---

## Verification Checklist

```bash
# Unit tests pass
bun run test:unit

# Integration tests pass (needs debugpy)
bun run test:integration

# E2E tests pass (needs debugpy)
bun run test:e2e

# Lint passes
bun run lint

# Build produces working binary
bun run build
./dist/krometrail --version
./dist/krometrail doctor

# Full CLI debug scenario works
./dist/krometrail launch "python tests/fixtures/simple.py" --break simple.py:3 --stop-on-entry
./dist/krometrail step over
./dist/krometrail eval "x"
./dist/krometrail stop

# Skill file prints correctly
./dist/krometrail skill

# JSON mode produces valid JSON
./dist/krometrail launch "python tests/fixtures/simple.py" --break simple.py:3 --stop-on-entry --json | python3 -m json.tool
```
