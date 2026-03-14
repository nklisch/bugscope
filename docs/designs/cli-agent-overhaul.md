# Design: CLI Agent-Friendly Overhaul

## Overview

Comprehensive overhaul of the CLI to achieve full MCP feature parity, follow agent-focused CLI best practices, and provide a consistent, machine-readable interface. This is a breaking change targeting pre-1.0.

**Key decisions:**
- Debug commands namespaced under `debug` (matching `browser` namespace)
- Uniform JSON response envelope on all commands
- Semantic exit codes
- Full MCP parity for browser investigation filters
- New `commands` introspection command for agent self-discovery

---

## Implementation Units

### Unit 1: Exit Code Constants and Error Classification

**File**: `src/cli/exit-codes.ts` (new)

```typescript
/** Semantic exit codes for agent-parseable error classification. */
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_TIMEOUT = 4;
export const EXIT_STATE = 5;

/**
 * Classify an error into the appropriate exit code.
 * Uses instanceof checks on the KrometrailError hierarchy.
 */
export function exitCodeFromError(err: unknown): number;
```

**Implementation Notes**:
- Import `KrometrailError`, `SessionNotFoundError`, `AdapterNotFoundError`, `DAPTimeoutError`, `SessionStateError` from `src/core/errors.ts`
- Import `SessionLimitError` for EXIT_STATE mapping
- Default to `EXIT_ERROR` for unknown errors
- `SessionNotFoundError` | `AdapterNotFoundError` | `TabNotFoundError` → `EXIT_NOT_FOUND`
- `DAPTimeoutError` → `EXIT_TIMEOUT`
- `SessionStateError` | `SessionLimitError` | `BrowserRecorderStateError` → `EXIT_STATE`
- The daemon RPC layer returns JSON-RPC errors with codes (`RPC_SESSION_NOT_FOUND`, etc.) — the CLI must also classify based on RPC error codes when the error comes from the daemon. Check for `JsonRpcError` shape: `{ code: number, message: string }`. Map `RPC_SESSION_NOT_FOUND` (-32000) → `EXIT_NOT_FOUND`, `RPC_SESSION_STATE_ERROR` (-32001) → `EXIT_STATE`, `RPC_LAUNCH_ERROR` (-32004) → `EXIT_ERROR`.

**Acceptance Criteria**:
- [ ] `exitCodeFromError(new SessionNotFoundError("x"))` returns `3`
- [ ] `exitCodeFromError(new DAPTimeoutError("continue", 30000))` returns `4`
- [ ] `exitCodeFromError(new SessionStateError("x", "running", ["stopped"]))` returns `5`
- [ ] `exitCodeFromError(new Error("generic"))` returns `1`
- [ ] RPC error with code -32000 returns `3`
- [ ] All constants are exported and documented

---

### Unit 2: JSON Response Envelope

**File**: `src/cli/envelope.ts` (new)

```typescript
import type { KrometrailError } from "../core/errors.js";

/**
 * Uniform JSON response envelope for all CLI --json output.
 * Agents can rely on this shape for every command.
 */
export interface CliSuccessEnvelope<T = unknown> {
	ok: true;
	data: T;
}

export interface CliErrorEnvelope {
	ok: false;
	error: {
		code: string;
		message: string;
		retryable: boolean;
	};
}

export type CliEnvelope<T = unknown> = CliSuccessEnvelope<T> | CliErrorEnvelope;

/**
 * Wrap a successful result in the envelope.
 */
export function successEnvelope<T>(data: T): string;

/**
 * Wrap an error in the envelope. Extracts code from KrometrailError,
 * classifies retryability.
 */
export function errorEnvelope(err: unknown): string;

/**
 * Retryable error codes — transient failures that may succeed on retry.
 */
export const RETRYABLE_CODES: ReadonlySet<string>;
```

**Implementation Notes**:
- `successEnvelope` calls `JSON.stringify({ ok: true, data }, null, 2)`
- `errorEnvelope` extracts `code` from `KrometrailError` instances (falls back to `"UNKNOWN_ERROR"`), `message` from `getErrorMessage()`, and `retryable` from `RETRYABLE_CODES.has(code)`
- Retryable codes: `"DAP_TIMEOUT"`, `"DAP_CONNECTION_FAILED"`, `"CDP_CONNECTION_FAILED"` — these are transient network/process issues
- Non-retryable: everything else (`"SESSION_NOT_FOUND"`, `"ADAPTER_PREREQUISITES"`, `"LAUNCH_FAILED"`, etc.)
- For RPC errors from daemon, reconstruct: code from the RPC error `data?.code` field if it's a string, otherwise use `"RPC_ERROR"`

**Acceptance Criteria**:
- [ ] `successEnvelope({ sessionId: "abc" })` produces `{ ok: true, data: { sessionId: "abc" } }`
- [ ] `errorEnvelope(new DAPTimeoutError("continue", 30000))` produces `{ ok: false, error: { code: "DAP_TIMEOUT", message: "...", retryable: true } }`
- [ ] `errorEnvelope(new SessionNotFoundError("x"))` produces `{ ok: false, error: { code: "SESSION_NOT_FOUND", ..., retryable: false } }`
- [ ] `errorEnvelope(new Error("generic"))` has `code: "UNKNOWN_ERROR"`, `retryable: false`

---

### Unit 3: Refactor `format.ts` to Use Envelope

**File**: `src/cli/format.ts` (modify)

Replace the current per-command JSON formatting with envelope-based formatting. The text and quiet modes remain unchanged.

```typescript
import { successEnvelope, errorEnvelope } from "./envelope.js";

export type OutputMode = "text" | "json" | "quiet";

export function resolveOutputMode(flags: { json?: boolean; quiet?: boolean }): OutputMode;

// --- Launch ---

export interface LaunchData {
	sessionId: string;
	status: string;
	framework?: string;
	frameworkWarnings?: string[];
	viewport?: string;
}

export function formatLaunch(result: LaunchResultPayload, mode: OutputMode): string;
// json mode: successEnvelope<LaunchData>({ sessionId, status, framework?, frameworkWarnings?, viewport? })
// text mode: unchanged
// quiet mode: viewport only

// --- Stop ---

export interface StopData {
	sessionId: string;
	durationMs: number;
	durationSec: number;
	actionCount: number;
}

export function formatStop(result: StopResultPayload, sessionId: string, mode: OutputMode): string;
// json mode: successEnvelope<StopData>({ sessionId, durationMs: result.duration, durationSec, actionCount })

// --- Status ---

export interface StatusData {
	status: string;
	viewport?: string;
	tokenStats?: { viewportTokensConsumed: number; viewportCount: number };
	actionCount?: number;
	elapsedMs?: number;
}

export function formatStatus(result: StatusResultPayload, mode: OutputMode): string;
// json mode: successEnvelope<StatusData>({ ...result })

// --- Viewport ---

export interface ViewportData {
	viewport: string;
}

export function formatViewport(viewport: string, mode: OutputMode): string;
// json mode: successEnvelope<ViewportData>({ viewport })

// --- Evaluate ---

export interface EvalData {
	expression: string;
	result: string;
}

export function formatEvaluate(expression: string, result: string, mode: OutputMode): string;
// json mode: successEnvelope<EvalData>({ expression, result })

// --- Variables ---

export interface VariablesData {
	variables: string;
}

export function formatVariables(result: string, mode: OutputMode): string;
// json mode: successEnvelope<VariablesData>({ variables: result })

// --- Stack Trace ---

export interface StackTraceData {
	stackTrace: string;
}

export function formatStackTrace(result: string, mode: OutputMode): string;
// json mode: successEnvelope<StackTraceData>({ stackTrace: result })

// --- Breakpoints Set ---

export interface BreakpointsSetData {
	file: string;
	breakpoints: BreakpointsResultPayload["breakpoints"];
}

export function formatBreakpointsSet(file: string, result: BreakpointsResultPayload, mode: OutputMode): string;
// json mode: successEnvelope<BreakpointsSetData>({ file, breakpoints: result.breakpoints })

// --- Breakpoints List ---

export function formatBreakpointsList(result: BreakpointsListPayload, mode: OutputMode): string;
// json mode: successEnvelope(result)

// --- Watch Expressions ---

export interface WatchData {
	watchExpressions: string[];
	count: number;
}

export function formatWatchExpressions(expressions: string[], mode: OutputMode): string;
// json mode: successEnvelope<WatchData>({ watchExpressions: expressions, count: expressions.length })

// --- Threads ---

export interface ThreadsData {
	threads: ThreadInfoPayload[];
	count: number;
}

export function formatThreads(threads: ThreadInfoPayload[], mode: OutputMode): string;
// json mode: successEnvelope<ThreadsData>({ threads, count: threads.length })
// NEW — currently threads formatting is inline in the command handler

// --- Source ---

export interface SourceData {
	file: string;
	source: string;
}

export function formatSource(file: string, source: string, mode: OutputMode): string;
// json mode: successEnvelope<SourceData>({ file, source })
// NEW — currently source formatting is inline in the command handler

// --- Log ---

export interface LogData {
	log: string;
}

export function formatLog(log: string, mode: OutputMode): string;
// json mode: successEnvelope<LogData>({ log })
// NEW

// --- Output ---

export interface OutputData {
	output: string;
	stream: string;
}

export function formatOutput(output: string, stream: string, mode: OutputMode): string;
// json mode: successEnvelope<OutputData>({ output, stream })
// NEW

// --- Error ---

export function formatError(err: unknown, mode: OutputMode): string;
// json mode: errorEnvelope(err) — replaces current inline JSON error formatting
// text mode: "Error: <message>" (unchanged)
// quiet mode: same as text

// --- Doctor ---
// (formatDoctor stays in doctor.ts but also uses envelope in json mode)

// --- Browser Session Info ---

export interface BrowserSessionData {
	startedAt: string;
	eventCount: number;
	markerCount: number;
	bufferAgeMs: number;
	tabs: Array<{ url: string; title: string }>;
}

export function formatBrowserSession(info: BrowserSessionInfo, mode: OutputMode): string;
// json mode: successEnvelope<BrowserSessionData>(...)
// text mode: current formatSessionInfo() logic from browser.ts
// NEW — consolidate from browser.ts

// --- Browser Sessions List ---

export function formatBrowserSessions(sessions: SessionSummary[], mode: OutputMode): string;
// json mode: successEnvelope({ sessions, count })
// text mode: table format
// NEW — currently inline in browser.ts

// --- Browser Investigation (overview, search, inspect, diff, replay-context) ---

export interface InvestigationData {
	result: string;
	command: string;
}

export function formatInvestigation(result: string, command: string, mode: OutputMode): string;
// json mode: successEnvelope<InvestigationData>({ result, command })
// text mode: result as-is
// NEW — these commands currently have no --json support
```

**Implementation Notes**:
- All JSON-mode output now goes through `successEnvelope()` — this is the single source of truth for the envelope shape
- Text and quiet modes are unchanged from current behavior
- Several formatting functions are new (formatThreads, formatSource, formatLog, formatOutput, formatBrowserSession, formatBrowserSessions, formatInvestigation) — extracted from inline logic in command handlers
- The `Data` interfaces serve as documentation of what the agent receives; they are not used at runtime (the envelope serializes whatever is passed)

**Acceptance Criteria**:
- [ ] Every format function in json mode wraps output in `{ ok: true, data: ... }`
- [ ] `formatError` in json mode wraps in `{ ok: false, error: { code, message, retryable } }`
- [ ] Text and quiet modes produce identical output to current behavior
- [ ] New format functions cover threads, source, log, output, browser sessions
- [ ] Browser investigation commands (overview, search, inspect, diff, replay-context) have json mode support

---

### Unit 4: Command Namespace Restructure

**File**: `src/cli/commands/debug.ts` (new — extracted from `index.ts`)

Move all debug commands into a `debug` subcommand group. The file structure becomes:

```
src/cli/commands/
  debug.ts      — debug subcommand group (launch, attach, stop, status, continue, step, run-to, break, breakpoints, eval, vars, stack, source, watch, unwatch, log, output, threads)
  browser.ts    — browser subcommand group (unchanged structure)
  doctor.ts     — top-level doctor command (unchanged)
  commands.ts   — top-level commands introspection command (new)
  shared.ts     — shared args, runCommand, getClient, resolveSessionId (extracted from index.ts)
```

**File**: `src/cli/commands/shared.ts` (new — extracted from `index.ts`)

```typescript
import { DaemonClient, ensureDaemon } from "../../daemon/client.js";
import { getDaemonSocketPath } from "../../daemon/protocol.js";
import type { OutputMode } from "../format.js";
import { exitCodeFromError } from "../exit-codes.js";
import { formatError, resolveOutputMode } from "../format.js";

export const globalArgs = {
	json: {
		type: "boolean" as const,
		description: "Output as JSON envelope { ok, data } or { ok: false, error }",
		default: false,
	},
	quiet: {
		type: "boolean" as const,
		description: "Minimal output (viewport only, no banners or hints)",
		default: false,
	},
	session: {
		type: "string" as const,
		description: "Target a specific session (required when multiple active)",
		alias: "s",
	},
};

export async function getClient(timeoutMs?: number): Promise<DaemonClient>;

export async function resolveSessionId(
	client: DaemonClient,
	explicitSession?: string,
): Promise<string>;

/**
 * Wrap a CLI command with standard mode resolution, client lifecycle,
 * session resolution, error handling, and semantic exit codes.
 */
export async function runCommand(
	args: { json?: boolean; quiet?: boolean; session?: string },
	handler: (client: DaemonClient, sessionId: string, mode: OutputMode) => Promise<void>,
	opts?: { needsSession?: false },
): Promise<void>;
```

**Implementation Notes**:
- `runCommand` changes: replace `process.exit(1)` with `process.exit(exitCodeFromError(err))` — this is the only place exit codes are produced (aside from doctor.ts)
- `shared.ts` is a pure extraction from the top of `index.ts` — no logic changes except the exit code improvement
- The daemon RPC errors arrive as objects with `{ code, message, data }`. The `runCommand` catch block must reconstruct a `KrometrailError` from the RPC error data if possible, so `exitCodeFromError` can classify it. Add a helper: `function rpcErrorToKrometrailError(rpcError: { code: number; message: string; data?: unknown }): Error` that maps known RPC error codes to their error class instances.

**File**: `src/cli/commands/debug.ts` (new)

```typescript
import { defineCommand } from "citty";
import { globalArgs, runCommand } from "./shared.js";
// ... all existing command definitions moved here

export const debugCommand = defineCommand({
	meta: { name: "debug", description: "Debug commands (launch, step, eval, ...)" },
	subCommands: {
		launch: launchCommand,
		attach: attachCommand,
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
		unwatch: unwatchCommand,
		log: logCommand,
		output: outputCommand,
		threads: threadsCommand,
	},
});
```

**File**: `src/cli/index.ts` (modify)

```typescript
import { defineCommand, runMain } from "citty";
import { debugCommand } from "./commands/debug.js";
import { browserCommand } from "./commands/browser.js";
import { doctorCommand } from "./commands/doctor.js";
import { commandsCommand } from "./commands/commands.js";

const main = defineCommand({
	meta: { name: "krometrail", version: "0.1.0" },
	args: {
		mcp: {
			type: "boolean",
			description: "Start as an MCP server on stdio instead of CLI",
			default: false,
		},
		tools: {
			type: "string",
			description: 'Comma-separated tool groups to expose (e.g., "debug,browser")',
		},
	},
	subCommands: {
		debug: debugCommand,
		browser: browserCommand,
		doctor: doctorCommand,
		commands: commandsCommand,
	},
	async run({ args }) {
		if (args.mcp) {
			// ... existing MCP server startup logic (unchanged)
		}
	},
});

runMain(main);
```

**Acceptance Criteria**:
- [ ] `krometrail debug launch "python app.py"` works
- [ ] `krometrail debug step over` works
- [ ] `krometrail debug eval "x + 1"` works
- [ ] `krometrail browser start` still works
- [ ] `krometrail doctor` still works
- [ ] `krometrail commands --json` works
- [ ] Old top-level commands (`krometrail launch`) no longer work (breaking change)
- [ ] Error exit codes are semantic (not always 1)

---

### Unit 5: `commands` Introspection Command

**File**: `src/cli/commands/commands.ts` (new)

```typescript
import { defineCommand } from "citty";

export interface CommandInfo {
	name: string;
	description: string;
	group: string;
	args: Array<{
		name: string;
		type: "positional" | "string" | "boolean";
		required: boolean;
		alias?: string;
		description: string;
		default?: unknown;
	}>;
}

export interface CommandsData {
	version: string;
	groups: Array<{
		name: string;
		description: string;
		commands: CommandInfo[];
	}>;
}

/**
 * Build the command inventory from the citty command definitions.
 */
export function buildCommandInventory(): CommandsData;

export const commandsCommand = defineCommand({
	meta: { name: "commands", description: "List all available commands (machine-readable)" },
	args: {
		json: {
			type: "boolean",
			description: "Output as JSON (default: true for this command)",
			default: true,
		},
		group: {
			type: "string",
			description: "Filter by command group: debug, browser, or all",
		},
	},
	async run({ args }) {
		// ...
	},
});
```

**Implementation Notes**:
- `buildCommandInventory()` imports `debugCommand` and `browserCommand`, iterates their `subCommands`, and extracts `meta` + `args` from each
- Also includes `doctor` and `commands` itself as top-level commands
- Default output is JSON (unlike all other commands) — this command is designed for agent discovery
- In text mode, output a compact table: `NAME  DESCRIPTION  FLAGS`
- The `--group` filter narrows to one group

**Acceptance Criteria**:
- [ ] `krometrail commands` produces valid JSON listing all commands
- [ ] `krometrail commands --group debug` lists only debug commands
- [ ] Each command entry includes name, description, group, and full args list
- [ ] Version field matches package version

---

### Unit 6: Add MCP-Only Parameters to Debug CLI Commands

**File**: `src/cli/commands/debug.ts` (modify — add flags to existing commands)

#### 6a: `launch` — add `--cwd`, `--env`, viewport config flags

```typescript
export const launchCommand = defineCommand({
	meta: { name: "launch", description: "Launch a debug session" },
	args: {
		// ... existing args ...
		cwd: {
			type: "string",
			description: "Working directory for the debug target",
		},
		env: {
			type: "string",
			description: "Environment variables as KEY=VAL pairs (comma-separated or repeat flag)",
		},
		"source-lines": {
			type: "string",
			description: "Lines of source context above/below current line (default: 15)",
		},
		"stack-depth": {
			type: "string",
			description: "Max call stack frames to show (default: 5)",
		},
		"locals-depth": {
			type: "string",
			description: "Object expansion depth for locals (default: 1)",
		},
		"token-budget": {
			type: "string",
			description: "Approximate token budget for viewport output (default: 8000)",
		},
		"diff-mode": {
			type: "boolean",
			description: "Show only changed variables vs previous stop",
			default: false,
		},
		// ... globalArgs ...
	},
	async run({ args }) {
		// Parse env: "KEY1=VAL1,KEY2=VAL2" → Record<string, string>
		// Build viewportConfig from --source-lines, --stack-depth, etc.
		// Pass cwd, env, viewportConfig to RPC
	},
});
```

#### 6b: `attach` — add `--cwd`, viewport config flags

Same viewport config flags as launch, plus `--cwd`.

#### 6c: `continue` and `step` — add `--thread`

```typescript
// In continueCommand args:
thread: {
	type: "string",
	description: "Thread ID to continue (for multi-threaded debugging)",
},

// In stepCommand args:
thread: {
	type: "string",
	description: "Thread ID to step (for multi-threaded debugging)",
},
```

**Implementation Notes**:
- `--env` parsing: split on commas, then split each on first `=`. Validate format.
- Viewport config flags are parsed as numbers via `Number()` and passed to `viewportConfig` in the RPC params.
- These flags already have RPC support (the daemon `LaunchParams` and `AttachParams` schemas include `cwd`, `env`, `viewportConfig`). The CLI just wasn't exposing them.
- `--thread` maps to `threadId` in ContinueParams and StepParams.

**Acceptance Criteria**:
- [ ] `krometrail debug launch "python app.py" --cwd /tmp --env "DEBUG=1,LOG=verbose"` passes cwd and env to daemon
- [ ] `krometrail debug launch "python app.py" --source-lines 20 --stack-depth 3` configures viewport
- [ ] `krometrail debug launch "python app.py" --diff-mode` enables diff mode
- [ ] `krometrail debug launch "python app.py" --token-budget 4000` sets token budget
- [ ] `krometrail debug continue --thread 2` passes threadId
- [ ] `krometrail debug step over --thread 2` passes threadId

---

### Unit 7: Add MCP-Only Parameters to Browser CLI Commands

**File**: `src/cli/commands/browser.ts` (modify)

#### 7a: `browser start` — add `--framework-state`, `--screenshot-interval`

```typescript
export const browserStartCommand = defineCommand({
	// ...existing args...
	"screenshot-interval": {
		type: "string",
		description: "Screenshot capture interval in ms (0 to disable, default: disabled)",
	},
	"framework-state": {
		type: "string",
		description: "Framework state observation: 'auto' for auto-detect, or comma-separated list (react,vue,solid,svelte)",
	},
});
```

#### 7b: `browser overview` — add `--include`, `--time-range`, `--token-budget`

```typescript
export const browserOverviewCommand = defineCommand({
	// ...existing args (id, around-marker, budget → rename to token-budget)...
	include: {
		type: "string",
		description: "Comma-separated: timeline,markers,errors,network_summary,framework (default: all)",
	},
	"time-range": {
		type: "string",
		description: "Time range as START..END (ISO timestamps or HH:MM:SS)",
	},
	"token-budget": {
		type: "string",
		description: "Max tokens for response (default: 3000)",
	},
	// NOTE: rename --budget to --token-budget for consistency with MCP naming
});
```

#### 7c: `browser search` — full MCP parity filters

```typescript
export const browserSearchCommand = defineCommand({
	args: {
		id: { type: "positional", required: true },
		query: { type: "string", description: "Natural language search query" },
		"status-codes": { type: "string", description: "HTTP status codes, comma-separated (e.g., '422,500')" },
		"event-types": { type: "string", description: "Event types, comma-separated (e.g., 'network_request,console')" },
		"around-marker": { type: "string", description: "Center search around marker ID" },
		"url-pattern": { type: "string", description: "Glob pattern for URL filtering (e.g., '**/api/**')" },
		"console-levels": { type: "string", description: "Console levels, comma-separated (e.g., 'error,warn')" },
		"contains-text": { type: "string", description: "Case-insensitive substring match on event summary" },
		framework: { type: "string", description: "Filter by framework: react, vue, solid, svelte" },
		component: { type: "string", description: "Filter by component name (substring match)" },
		pattern: { type: "string", description: "Filter by bug pattern (e.g., 'stale_closure', 'infinite_rerender')" },
		"max-results": { type: "string", description: "Max results (default: 10)", default: "10" },
		"token-budget": { type: "string", description: "Max tokens for response (default: 2000)" },
		...globalArgs,  // ADD --json, --quiet, --session
	},
});
```

#### 7d: `browser inspect` — add `--json`, `--quiet`, full `--include`

```typescript
export const browserInspectCommand = defineCommand({
	args: {
		// ...existing args...
		include: {
			type: "string",
			description: "Comma-separated: surrounding_events,network_body,screenshot,form_state,console_context (default: all)",
		},
		...globalArgs,  // ADD --json, --quiet
	},
});
```

#### 7e: `browser diff` — rename `--before`/`--after` to `--from`/`--to`, add `--json`, framework_state

```typescript
export const browserDiffCommand = defineCommand({
	args: {
		id: { type: "positional", required: true },
		from: { type: "string", required: true, description: "First moment (ISO timestamp, HH:MM:SS, or event ID)" },
		to: { type: "string", required: true, description: "Second moment (ISO timestamp, HH:MM:SS, or event ID)" },
		include: {
			type: "string",
			description: "Comma-separated: form_state,storage,url,console_new,network_new,framework_state (default: all except framework_state)",
		},
		"token-budget": { type: "string", description: "Max tokens (default: 2000)" },
		...globalArgs,
	},
});
```

#### 7f: `browser sessions` — add `--url-contains`

```typescript
export const browserSessionsCommand = defineCommand({
	args: {
		// ...existing args...
		"url-contains": {
			type: "string",
			description: "Filter sessions by URL pattern",
		},
		...globalArgs,  // ensure --json is present (it is, but add --quiet, --session for consistency)
	},
});
```

#### 7g: `browser overview`, `search`, `inspect`, `diff`, `replay-context` — add `--json`, `--quiet`

These browser investigation commands currently lack `--json` and `--quiet` flags. Add `...globalArgs` to all of them. In json mode, wrap the result string through `formatInvestigation()`.

**Implementation Notes**:
- `--framework-state` parsing: `"auto"` → `true`, `"react,vue"` → `["react", "vue"]`, absent → `undefined`
- `--time-range` parsing: `"2024-01-01T00:00..2024-01-01T01:00"` → split on `..`, parse each as ISO timestamp or `HH:MM:SS` relative to session start
- Comma-separated string flags are split with `.split(",").map(s => s.trim()).filter(Boolean)`
- `--budget` on existing commands gets renamed to `--token-budget` for consistency
- All browser investigation commands route through `formatInvestigation()` in json mode which wraps in the envelope
- The `--from`/`--to` rename on diff aligns with the MCP schema which uses `from`/`to` (the CLI currently uses `--before`/`--after`)

**Acceptance Criteria**:
- [ ] `krometrail browser start --framework-state auto` sends `frameworkState: true` to daemon
- [ ] `krometrail browser start --framework-state react,vue` sends `frameworkState: ["react", "vue"]`
- [ ] `krometrail browser start --screenshot-interval 5000` sends `screenshotIntervalMs: 5000`
- [ ] `krometrail browser search <id> --event-types network_request,console --url-pattern "**/api/**" --json` returns envelope-wrapped JSON
- [ ] `krometrail browser overview <id> --include timeline,errors --token-budget 2000 --json` returns envelope-wrapped JSON
- [ ] `krometrail browser inspect <id> --event <eid> --include network_body,screenshot --json` returns envelope
- [ ] `krometrail browser diff <id> --from <t1> --to <t2> --include framework_state --json` returns envelope
- [ ] All browser investigation commands support `--json` and `--quiet`
- [ ] `--budget` is renamed to `--token-budget` on all commands

---

### Unit 8: Add `--json` to Browser Start/Mark/Stop/Status

**File**: `src/cli/commands/browser.ts` (modify)

The recording lifecycle commands (`start`, `mark`, `status`, `stop`) currently lack `--json` and `--quiet`. Add `...globalArgs` (at minimum `--json`, `--quiet`) and format through the envelope.

```typescript
export const browserStartCommand = defineCommand({
	args: {
		// ...existing args + Unit 7a additions...
		json: { type: "boolean", default: false, description: "Output as JSON envelope" },
		quiet: { type: "boolean", default: false, description: "Minimal output" },
	},
	async run({ args }) {
		// On success: format via formatBrowserSession(info, mode)
	},
});

export const browserMarkCommand = defineCommand({
	args: {
		label: { type: "positional", required: false },
		json: { type: "boolean", default: false },
		quiet: { type: "boolean", default: false },
	},
	async run({ args }) {
		// json mode: successEnvelope({ marker: { id, timestamp, label } })
	},
});

export const browserStatusCommand = defineCommand({
	args: {
		json: { type: "boolean", default: false },
		quiet: { type: "boolean", default: false },
	},
});

export const browserStopCommand = defineCommand({
	args: {
		"close-browser": { type: "boolean", default: false },
		json: { type: "boolean", default: false },
		quiet: { type: "boolean", default: false },
	},
});
```

**Implementation Notes**:
- `browser start` in json mode: `successEnvelope<BrowserSessionData>({ startedAt, eventCount, ... })`
- `browser mark` in json mode: `successEnvelope({ id: marker.id, timestamp: marker.timestamp, label: marker.label })`
- `browser status` in json mode: `successEnvelope(info)` or `successEnvelope({ active: false })` if no session
- `browser stop` in json mode: `successEnvelope({ stopped: true })`
- These commands currently use inline formatting — extract to `formatBrowserSession` and `formatBrowserMark` in `format.ts`

**Acceptance Criteria**:
- [ ] `krometrail browser start --json` returns `{ ok: true, data: { startedAt, eventCount, ... } }`
- [ ] `krometrail browser mark "login" --json` returns `{ ok: true, data: { id, timestamp, label } }`
- [ ] `krometrail browser status --json` returns session info or `{ active: false }`
- [ ] `krometrail browser stop --json` returns `{ ok: true, data: { stopped: true } }`

---

### Unit 9: Update `doctor` to Use Envelope and Semantic Exit Codes

**File**: `src/cli/commands/doctor.ts` (modify)

```typescript
export function formatDoctor(result: DoctorResult, mode: OutputMode): string {
	if (mode === "json") {
		return successEnvelope(result);
		// Was: JSON.stringify(result, null, 2)
		// Now: { ok: true, data: { platform, runtime, adapters, frameworks, ... } }
	}
	// text and quiet modes unchanged
}
```

Also add `fix_command` field to adapter entries in `DoctorResult`:

```typescript
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
		fixCommand?: string;  // NEW — the actual shell command to install
	}>;
	frameworks: Array<{
		id: string;
		displayName: string;
		adapterId: string;
	}>;
	launchConfigs?: Array<{ name: string; type: string; request: string }>;
}
```

**Implementation Notes**:
- `fixCommand` is derived from adapter `installHint` — map common patterns:
  - Python debugpy: `"pip install debugpy"` or `"pip3 install debugpy"`
  - Node: `null` (built-in)
  - Delve: `"go install github.com/go-delve/delve/cmd/dlv@latest"`
  - etc.
- This gives agents an actionable command they can run to fix missing prerequisites
- Exit code stays 0 (at least one adapter) or 1 (no adapters) — no change needed, doctor already handles this

**Acceptance Criteria**:
- [ ] `krometrail doctor --json` output wrapped in `{ ok: true, data: ... }`
- [ ] Missing adapters include `fixCommand` when a known install command exists
- [ ] Text mode output unchanged

---

### Unit 10: Update Skill File and Documentation

**File**: `docs/UX.md` (modify — update CLI section)

Update the CLI command reference and examples to use the `debug` namespace:

```bash
# Before:
krometrail launch "python app.py" --break order.py:147
krometrail continue
krometrail step into
krometrail eval "discount"
krometrail stop

# After:
krometrail debug launch "python app.py" --break order.py:147
krometrail debug continue
krometrail debug step into
krometrail debug eval "discount"
krometrail debug stop
```

Update the Agent Skill File section with the new namespace and new flags.

**File**: `docs/INTERFACE.md` (modify — update CLI command reference)

- Update all command examples to use `debug` namespace
- Document the JSON envelope format
- Document exit codes (0-5)
- Document new flags (`--cwd`, `--env`, `--source-lines`, etc.)
- Document `commands` introspection command

**Acceptance Criteria**:
- [ ] All CLI examples in docs/ use `debug` namespace
- [ ] JSON envelope is documented with examples
- [ ] Exit codes table in INTERFACE.md
- [ ] `commands` command documented
- [ ] New flags documented for launch, attach, browser commands

---

### Unit 11: `runCommand` Error Handling Upgrade

**File**: `src/cli/commands/shared.ts` (the `runCommand` function)

```typescript
async function runCommand(
	args: { json?: boolean; quiet?: boolean; session?: string },
	handler: (client: DaemonClient, sessionId: string, mode: OutputMode) => Promise<void>,
	opts?: { needsSession?: false },
): Promise<void> {
	const mode = resolveOutputMode(args) as OutputMode;
	const client = await getClient();
	try {
		const sessionId = opts?.needsSession === false ? "" : await resolveSessionId(client, args.session);
		await handler(client, sessionId, mode);
	} catch (err) {
		// Convert RPC errors to KrometrailError for proper classification
		const classified = classifyError(err);
		process.stderr.write(`${formatError(classified, mode)}\n`);
		process.exit(exitCodeFromError(classified));
	} finally {
		client.dispose();
	}
}

/**
 * If the error is a daemon RPC error (has code/message from JSON-RPC),
 * attempt to reconstruct the appropriate KrometrailError subclass.
 * Otherwise return the error as-is.
 */
function classifyError(err: unknown): Error;
```

**Implementation Notes**:
- `classifyError` checks if `err` has shape `{ code: number, message: string }` (JSON-RPC error)
- Maps `RPC_SESSION_NOT_FOUND` to `new SessionNotFoundError(extractSessionId(err.message))`
- Maps `RPC_SESSION_STATE_ERROR` to `new SessionStateError(...)`
- Falls back to wrapping in a generic `KrometrailError(message, "RPC_ERROR")` for unknown RPC codes
- For non-RPC errors, returns `err` as-is

**Acceptance Criteria**:
- [ ] Daemon `SESSION_NOT_FOUND` RPC error → exit code 3
- [ ] Daemon `SESSION_STATE_ERROR` → exit code 5
- [ ] Daemon timeout → exit code 4
- [ ] Generic errors → exit code 1
- [ ] JSON mode error output uses envelope format

---

## Implementation Order

1. **Unit 1: Exit Codes** — no dependencies, standalone constants
2. **Unit 2: JSON Envelope** — depends on Unit 1 for error classification concepts, but imports from `src/core/errors.ts`
3. **Unit 3: Refactor format.ts** — depends on Unit 2 (imports `successEnvelope`/`errorEnvelope`)
4. **Unit 4: Namespace Restructure** — depends on Unit 1 + 3 (uses new format functions and exit codes in `shared.ts`)
5. **Unit 5: Commands Introspection** — depends on Unit 4 (imports command definitions from debug.ts/browser.ts)
6. **Unit 6: Debug MCP Parity Flags** — depends on Unit 4 (modifies commands in debug.ts)
7. **Unit 7: Browser MCP Parity Flags** — depends on Unit 3 + 4 (uses new format functions, modifies browser.ts)
8. **Unit 8: Browser Lifecycle --json** — depends on Unit 3 (uses new format functions)
9. **Unit 9: Doctor Envelope** — depends on Unit 2 (uses `successEnvelope`)
10. **Unit 11: Error Handling Upgrade** — depends on Unit 1 + 2 + 4 (uses exit codes, envelope, lives in shared.ts)
11. **Unit 10: Documentation** — last, after all commands are finalized

---

## Testing

### Unit Tests: `tests/unit/cli/exit-codes.test.ts` (new)

```typescript
describe("exitCodeFromError", () => {
	it("returns EXIT_NOT_FOUND for SessionNotFoundError", () => { ... });
	it("returns EXIT_TIMEOUT for DAPTimeoutError", () => { ... });
	it("returns EXIT_STATE for SessionStateError", () => { ... });
	it("returns EXIT_ERROR for generic Error", () => { ... });
	it("returns EXIT_NOT_FOUND for RPC code -32000", () => { ... });
});
```

### Unit Tests: `tests/unit/cli/envelope.test.ts` (new)

```typescript
describe("successEnvelope", () => {
	it("wraps data in { ok: true, data }", () => { ... });
	it("serializes nested objects", () => { ... });
});

describe("errorEnvelope", () => {
	it("wraps KrometrailError with code and retryable", () => { ... });
	it("marks DAP_TIMEOUT as retryable", () => { ... });
	it("marks SESSION_NOT_FOUND as non-retryable", () => { ... });
	it("handles generic Error with UNKNOWN_ERROR code", () => { ... });
});
```

### Unit Tests: `tests/unit/cli/format.test.ts` (modify)

- Update all JSON-mode assertions to expect envelope format `{ ok: true, data: ... }`
- Add tests for new format functions: `formatThreads`, `formatSource`, `formatLog`, `formatOutput`, `formatBrowserSession`, `formatBrowserSessions`, `formatInvestigation`
- Add tests for `formatError` JSON mode using envelope

### Unit Tests: `tests/unit/cli/commands.test.ts` (new)

```typescript
describe("buildCommandInventory", () => {
	it("returns all debug commands", () => { ... });
	it("returns all browser commands", () => { ... });
	it("includes args with types and descriptions", () => { ... });
	it("filters by group", () => { ... });
});
```

### Integration Tests

No new integration tests needed — the daemon RPC interface is unchanged. Existing integration tests remain valid.

### E2E Tests: `tests/e2e/cli/` (new directory)

Add CLI e2e tests that exercise the namespaced commands with real debuggers:

```typescript
// tests/e2e/cli/debug-workflow.test.ts
describe.skipIf(SKIP_NO_DEBUGPY)("E2E: CLI debug workflow", () => {
	it("launch → continue → eval → stop with JSON envelope", async () => {
		// Uses Bun.$ to run krometrail CLI commands
		// Validates JSON envelope shape
		// Validates exit codes
	});
});
```

---

## Verification Checklist

```bash
# Build succeeds
bun run build

# Unit tests pass (includes new exit-codes, envelope, format, commands tests)
bun run test:unit

# Lint passes
bun run lint

# E2E CLI tests pass (needs debugpy)
bun run test:e2e

# Manual verification: JSON envelope shape
krometrail debug launch "python -c 'print(1)'" --stop-on-entry --json | jq '.ok'
# → true

krometrail debug stop --json | jq '.data.actionCount'
# → number

# Manual verification: exit codes
krometrail debug stop --session nonexistent; echo $?
# → 3

# Manual verification: commands introspection
krometrail commands | jq '.data.groups[].commands[].name'

# Manual verification: browser JSON support
krometrail browser start --json | jq '.ok'
krometrail browser stop --json | jq '.ok'
```
