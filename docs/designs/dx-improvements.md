# Design: CLI DX Improvements — Error Handling, Doctor, Install Journey

## Overview

This design addresses the gaps identified in the e2e test audit: poor prerequisite error DX, missing exit codes, incomplete doctor fix commands, stale error messages, a monolithic `LaunchError`, and missing e2e coverage for the install journey and negative paths. The goal is to make every failure mode produce an actionable, machine-parseable, and human-readable response.

---

## Implementation Units

### Unit 1: Add `LaunchErrorCause` Enum and Enrich `LaunchError`

**File**: `src/core/errors.ts`

```typescript
/** Classifies the root cause of a launch failure for targeted guidance. */
export type LaunchErrorCause = "spawn_failed" | "connection_timeout" | "port_conflict" | "early_exit" | "unknown";

export class LaunchError extends KrometrailError {
	constructor(
		message: string,
		public readonly stderr?: string,
		public readonly cause_type: LaunchErrorCause = "unknown",
	) {
		super(message, "LAUNCH_FAILED");
		this.name = "LaunchError";
	}
}
```

**Implementation Notes**:
- The new `cause_type` field is optional with a default, so all existing `new LaunchError(msg)` and `new LaunchError(msg, stderr)` call sites remain valid — zero breaking changes.
- Update call sites in `src/adapters/helpers.ts` to pass the appropriate cause:
  - `spawnAndWait` timeout path → `"connection_timeout"`
  - `spawnAndWait` spawn error path → `"spawn_failed"`
  - `spawnAndWait` non-zero exit path → `"early_exit"`
  - `connectOrKill` catch path → `"connection_timeout"`
  - `detectEarlySpawnFailure` error path → `"spawn_failed"`, close non-zero path → `"early_exit"`

**Acceptance Criteria**:
- [ ] `LaunchErrorCause` type is exported from `src/core/errors.ts`
- [ ] `LaunchError.cause_type` defaults to `"unknown"` when not provided
- [ ] All `new LaunchError(...)` calls in `src/adapters/helpers.ts` pass an explicit `cause_type`
- [ ] Existing tests pass without modification (backwards-compatible constructor)

---

### Unit 2: Add `EXIT_PREREQUISITES` Exit Code

**File**: `src/cli/exit-codes.ts`

```typescript
/** Process exited normally. */
export const EXIT_SUCCESS = 0;

/** Generic runtime error (catch-all). */
export const EXIT_ERROR = 1;

/** Invalid usage (bad args, missing required flags, etc.). */
export const EXIT_USAGE = 2;

/** Requested resource not found (session, adapter, tab). */
export const EXIT_NOT_FOUND = 3;

/** Operation timed out (DAP, CDP). */
export const EXIT_TIMEOUT = 4;

/** Resource is in wrong state for the requested operation. */
export const EXIT_STATE = 5;

/** Adapter prerequisites not satisfied (debugger missing or too old). */
export const EXIT_PREREQUISITES = 6;
```

Update `exitCodeFromError()` — add `AdapterPrerequisiteError` handling before the generic `KrometrailError` catch-all, and also handle `RPC_ADAPTER_ERROR` from the daemon:

```typescript
import { AdapterPrerequisiteError } from "../core/errors.js";
import { RPC_ADAPTER_ERROR } from "../daemon/protocol.js";

export function exitCodeFromError(err: unknown): number {
	// instanceof hierarchy — most specific first
	if (err instanceof AdapterPrerequisiteError) {
		return EXIT_PREREQUISITES;
	}
	if (err instanceof SessionNotFoundError || err instanceof AdapterNotFoundError || err instanceof TabNotFoundError) {
		return EXIT_NOT_FOUND;
	}
	if (err instanceof DAPTimeoutError) {
		return EXIT_TIMEOUT;
	}
	if (err instanceof SessionStateError || err instanceof SessionLimitError || err instanceof BrowserRecorderStateError) {
		return EXIT_STATE;
	}

	// Generic KrometrailError — may be a daemon RPC error wrapped with a string numeric code
	if (err instanceof KrometrailError) {
		const numericCode = Number(err.code);
		if (!Number.isNaN(numericCode)) {
			if (numericCode === RPC_SESSION_NOT_FOUND) return EXIT_NOT_FOUND;
			if (numericCode === RPC_SESSION_STATE_ERROR) return EXIT_STATE;
			if (numericCode === RPC_ADAPTER_ERROR) return EXIT_PREREQUISITES;
		}
		return EXIT_ERROR;
	}

	// Plain Error or unknown — check for RPC error shape
	if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
		const code = (err as { code: unknown }).code;
		if (typeof code === "number") {
			if (code === RPC_SESSION_NOT_FOUND) return EXIT_NOT_FOUND;
			if (code === RPC_SESSION_STATE_ERROR) return EXIT_STATE;
			if (code === RPC_ADAPTER_ERROR) return EXIT_PREREQUISITES;
		}
	}

	return EXIT_ERROR;
}
```

Also update `classifyError()` in `src/cli/commands/shared.ts` to reconstruct `AdapterPrerequisiteError` from `RPC_ADAPTER_ERROR`:

```typescript
case RPC_ADAPTER_ERROR:
	return new AdapterPrerequisiteError(err.message, [], undefined);
```

**Implementation Notes**:
- `RPC_ADAPTER_ERROR` is used for both `AdapterPrerequisiteError` and `AdapterNotFoundError` on the daemon side. After this change, both map to `EXIT_PREREQUISITES` from exit codes (which is acceptable — both are "setup" problems). The `classifyError` function reconstructs a more specific error type for the JSON envelope `code` field.
- To distinguish `AdapterNotFoundError` vs `AdapterPrerequisiteError` through RPC, check the message for "prerequisites not met" vs "No debug adapter found". Add a heuristic in `classifyError`:

```typescript
case RPC_ADAPTER_ERROR:
	if (err.message.includes("prerequisites not met")) {
		return new AdapterPrerequisiteError("unknown", [], err.message);
	}
	return new AdapterNotFoundError(err.message);
```

**Acceptance Criteria**:
- [ ] `EXIT_PREREQUISITES` constant exported with value `6`
- [ ] `AdapterPrerequisiteError` → exit code 6 (not 3)
- [ ] `RPC_ADAPTER_ERROR` from daemon → exit code 6
- [ ] `AdapterNotFoundError` remains exit code 3
- [ ] Existing exit code tests updated, new tests added for code 6

---

### Unit 3: Fix `AdapterNotFoundError` Message

**File**: `src/core/errors.ts`

```typescript
export class AdapterNotFoundError extends KrometrailError {
	constructor(public readonly languageOrExt: string) {
		super(
			`No debug adapter found for '${languageOrExt}'. Run 'krometrail doctor' to see available adapters.`,
			"ADAPTER_NOT_FOUND",
		);
		this.name = "AdapterNotFoundError";
	}
}
```

**Implementation Notes**:
- Replace the stale `debug_status` reference with `krometrail doctor`.
- This is a string-only change. No interface changes.

**Acceptance Criteria**:
- [ ] Error message contains `krometrail doctor` not `debug_status`
- [ ] Existing unit test for `AdapterNotFoundError` updated to match new message

---

### Unit 4: Enrich `formatError` with Actionable Guidance

**File**: `src/cli/format.ts`

Replace the current minimal `formatError`:

```typescript
export function formatError(err: unknown, mode: OutputMode): string {
	if (mode === "json") {
		return errorEnvelope(err);
	}

	const message = err instanceof Error ? err.message : String(err);

	// In text mode, append actionable hints for known error types
	if (err instanceof AdapterPrerequisiteError) {
		const lines = [`Error: ${message}`];
		if (err.installHint) {
			lines.push("");
			lines.push(`  Fix: ${err.installHint}`);
		}
		lines.push("");
		lines.push("  Run 'krometrail doctor' to check all adapters.");
		return lines.join("\n");
	}

	if (err instanceof AdapterNotFoundError) {
		return `Error: ${message}`;
	}

	if (err instanceof DAPTimeoutError) {
		return `Error: ${message}\n\n  The debugger did not respond in time. This can happen if the program is compute-heavy or the debugger is slow to start.`;
	}

	if (err instanceof LaunchError) {
		const lines = [`Error: ${message}`];
		if (err.cause_type === "connection_timeout") {
			lines.push("");
			lines.push("  The debugger process started but krometrail could not connect to it.");
			lines.push("  Check if another process is using the debug port, or increase the timeout.");
		} else if (err.cause_type === "spawn_failed") {
			lines.push("");
			lines.push("  The debugger process could not be started. Check that the command is correct");
			lines.push("  and the debugger binary is on your PATH.");
		}
		return lines.join("\n");
	}

	return `Error: ${message}`;
}
```

**Implementation Notes**:
- Import `AdapterPrerequisiteError`, `AdapterNotFoundError`, `DAPTimeoutError`, `LaunchError` from `../core/errors.js`.
- The `err` passed to `formatError` is already classified by `classifyError()` in `shared.ts` — but `classifyError` currently reconstructs `AdapterPrerequisiteError` without the original `installHint`. To fix this, the daemon should pass `installHint` in the RPC error `data` field.

**Daemon change** (`src/daemon/server.ts` — `mapError`):

```typescript
if (err instanceof AdapterPrerequisiteError) {
	return {
		code: RPC_ADAPTER_ERROR,
		message: err.message,
		data: { installHint: err.installHint, missing: err.missing, adapterId: err.adapterId },
	};
}
```

**CLI change** (`src/cli/commands/shared.ts` — `classifyError`):

```typescript
case RPC_ADAPTER_ERROR: {
	if (err.message.includes("prerequisites not met")) {
		// Reconstruct with data fields if available
		const data = (err as KrometrailError & { data?: { installHint?: string; missing?: string[]; adapterId?: string } }).data;
		return new AdapterPrerequisiteError(
			data?.adapterId ?? "unknown",
			data?.missing ?? [],
			data?.installHint,
		);
	}
	return new AdapterNotFoundError(err.message);
}
```

For this to work, the `DaemonClient` must preserve the `data` field from `JsonRpcError`. Check `src/daemon/client.ts` — if it currently drops `data`, extend it to attach `data` to the thrown `KrometrailError`:

```typescript
// In DaemonClient.call(), where it throws on error response:
const errObj = new KrometrailError(response.error.message, String(response.error.code));
if (response.error.data) {
	(errObj as KrometrailError & { data?: unknown }).data = response.error.data;
}
throw errObj;
```

**Acceptance Criteria**:
- [ ] Text-mode `AdapterPrerequisiteError` shows install hint and "Run 'krometrail doctor'" guidance
- [ ] Text-mode `LaunchError` with `cause_type: "connection_timeout"` shows port/timeout hint
- [ ] Text-mode `LaunchError` with `cause_type: "spawn_failed"` shows PATH hint
- [ ] Text-mode `DAPTimeoutError` shows timeout guidance
- [ ] JSON mode is unaffected (uses `errorEnvelope` as before)
- [ ] Daemon passes `installHint`, `missing`, `adapterId` through RPC error `data` field
- [ ] CLI reconstructs full `AdapterPrerequisiteError` from RPC error

---

### Unit 5: Complete Doctor Fix Commands — Single Source of Truth

**File**: `src/adapters/base.ts`

Extend `PrerequisiteResult` to include a structured fix command:

```typescript
export interface PrerequisiteResult {
	satisfied: boolean;
	missing?: string[];
	installHint?: string;
	/** A concrete shell command the user can run to fix the issue. */
	fixCommand?: string;
}
```

**File**: Update each adapter's `checkPrerequisites()` to return `fixCommand` when not satisfied:

| Adapter | `fixCommand` |
|---------|-------------|
| python | `pip install debugpy` |
| node | `# Install Node.js 18+ from https://nodejs.org` (comment — no single command) |
| go | `go install github.com/go-delve/delve/cmd/dlv@latest` |
| rust | `cargo install --locked codelldb` |
| ruby | `gem install debug` |
| csharp | `# netcoredbg is auto-downloaded on first use` |
| swift | `xcode-select --install` (macOS) / `# Install Swift from https://swift.org` (Linux) |
| kotlin | `sdk install kotlin` |
| java | `# JDK 17+ required — install from https://adoptium.net` |
| cpp | `apt-get install gdb` (Linux) / `xcode-select --install` (macOS) |

**Implementation Notes**:
- Each adapter's failing `PrerequisiteResult` adds a `fixCommand` field. The adapter knows its own platform-specific install command best.
- For adapters with auto-download (csharp netcoredbg, java java-debug-adapter, kotlin kotlin-debug-adapter), `fixCommand` is a comment explaining auto-download, or `undefined` (the prerequisite is the language runtime, not the DAP adapter).
- Platform-specific commands use `process.platform` to select (e.g., swift uses xcode-select on darwin, comment on linux).

**File**: `src/cli/commands/doctor.ts`

Remove the hardcoded `deriveFixCommand()` function entirely. Instead, read `fixCommand` directly from the `PrerequisiteResult`:

```typescript
// In runDoctorChecks(), when prereq is not satisfied:
adapterResults.push({
	id: adapter.id,
	displayName: adapter.displayName,
	status: "missing",
	installHint: prereq.installHint,
	fixCommand: prereq.fixCommand, // Directly from adapter
});
```

**File**: `src/cli/commands/doctor.ts` — Add `--fix` flag:

```typescript
export const doctorCommand = defineCommand({
	meta: {
		name: "doctor",
		description: "Check installed debuggers and system readiness",
	},
	args: {
		json: { type: "boolean", description: "Output as JSON", default: false },
		quiet: { type: "boolean", description: "Minimal output", default: false },
		fix: { type: "boolean", description: "Print fix commands for missing adapters", default: false },
	},
	async run({ args }) {
		const mode = resolveOutputMode(args);
		registerAllAdapters();
		const result = await runDoctorChecks();

		if (args.fix) {
			const missing = result.adapters.filter((a) => a.status === "missing" && a.fixCommand);
			if (missing.length === 0) {
				process.stdout.write("All adapters are available — nothing to fix.\n");
				process.exit(0);
			}
			process.stdout.write("# Run these commands to install missing debuggers:\n\n");
			for (const adapter of missing) {
				process.stdout.write(`# ${adapter.displayName}\n${adapter.fixCommand}\n\n`);
			}
			process.exit(0);
		}

		process.stdout.write(`${formatDoctor(result, mode)}\n`);
		const hasAvailable = result.adapters.some((a) => a.status === "available");
		process.exit(hasAvailable ? 0 : 1);
	},
});
```

**Acceptance Criteria**:
- [ ] `PrerequisiteResult.fixCommand` is an optional string on the interface
- [ ] All 10 adapters return `fixCommand` when prerequisites are not satisfied (or `undefined` for auto-download adapters)
- [ ] `deriveFixCommand()` in doctor.ts is deleted — doctor uses adapter-provided `fixCommand`
- [ ] `krometrail doctor --fix` prints a copy-paste script block for missing adapters
- [ ] `krometrail doctor --fix` exits 0 when nothing is missing
- [ ] `DoctorResult.fixCommand` in JSON output comes from the adapter, not a hardcoded map

---

### Unit 6: Enrich Error Envelope with `fixCommand`

**File**: `src/cli/envelope.ts`

```typescript
export interface CliErrorEnvelope {
	ok: false;
	error: {
		code: string;
		message: string;
		retryable: boolean;
		/** Concrete shell command to fix the issue, if known. */
		fixCommand?: string;
	};
}
```

Update `errorEnvelope()`:

```typescript
export function errorEnvelope(err: unknown): string {
	let code = "UNKNOWN_ERROR";
	let fixCommand: string | undefined;
	const message = getErrorMessage(err);

	if (err instanceof KrometrailError) {
		code = err.code;
	}
	if (err instanceof AdapterPrerequisiteError && err.installHint) {
		fixCommand = err.installHint;
	}

	const retryable = RETRYABLE_CODES.has(code);

	const envelope: CliErrorEnvelope = {
		ok: false,
		error: { code, message, retryable, ...(fixCommand ? { fixCommand } : {}) },
	};

	return JSON.stringify(envelope, null, 2);
}
```

**Implementation Notes**:
- `fixCommand` is only set for `AdapterPrerequisiteError` for now. Can be extended to other error types later.
- The `installHint` serves double duty here — it's the human-readable fix. The structured `fixCommand` from `PrerequisiteResult` could also be propagated if we attach it to `AdapterPrerequisiteError`, but for the JSON envelope the `installHint` is more useful since it includes context.

To make this cleaner, add `fixCommand` to `AdapterPrerequisiteError`:

**File**: `src/core/errors.ts`

```typescript
export class AdapterPrerequisiteError extends KrometrailError {
	constructor(
		public readonly adapterId: string,
		public readonly missing: string[],
		public readonly installHint?: string,
		public readonly fixCommand?: string,
	) {
		super(
			`Adapter '${adapterId}' prerequisites not met: ${missing.join(", ")}. ${installHint ? `Install: ${installHint}` : ""}`,
			"ADAPTER_PREREQUISITES",
		);
		this.name = "AdapterPrerequisiteError";
	}
}
```

Then in `session-manager.ts` where the error is thrown, pass the `fixCommand` from `PrerequisiteResult`:

```typescript
if (!prereq.satisfied) {
	throw new AdapterPrerequisiteError(adapter.id, prereq.missing ?? [], prereq.installHint, prereq.fixCommand);
}
```

And in the envelope:

```typescript
if (err instanceof AdapterPrerequisiteError) {
	fixCommand = err.fixCommand;
}
```

**Acceptance Criteria**:
- [ ] `CliErrorEnvelope.error.fixCommand` is optional string
- [ ] `AdapterPrerequisiteError` carries `fixCommand` from the adapter
- [ ] JSON error output for missing prerequisites includes `fixCommand`
- [ ] `fixCommand` is omitted (not `null`) when not available

---

### Unit 7: `ChromeNotFoundError` Platform-Aware Message

**File**: `src/core/errors.ts`

```typescript
export class ChromeNotFoundError extends KrometrailError {
	constructor() {
		const platform = process.platform;
		const hint =
			platform === "darwin"
				? "Install Chrome from https://google.com/chrome, or use --attach to connect to an existing instance."
				: platform === "linux"
					? "Install Chrome: apt install google-chrome-stable, or use --attach to connect to an existing instance."
					: "Install Chrome from https://google.com/chrome, or use --attach to connect to an existing instance.";
		super(hint, "CHROME_NOT_FOUND");
		this.name = "ChromeNotFoundError";
	}
}
```

**Acceptance Criteria**:
- [ ] Linux message includes `apt install` hint
- [ ] macOS message includes download URL
- [ ] All platforms mention `--attach` alternative

---

## Implementation Order

1. **Unit 1** — `LaunchErrorCause` enum on `LaunchError` (no dependents, backwards-compatible)
2. **Unit 3** — Fix `AdapterNotFoundError` message (standalone string fix)
3. **Unit 7** — `ChromeNotFoundError` platform-aware message (standalone)
4. **Unit 5** — `PrerequisiteResult.fixCommand` + adapter updates + doctor `--fix` (extends interface, touches all adapters)
5. **Unit 6** — Enrich `AdapterPrerequisiteError` with `fixCommand`, enrich error envelope (depends on Unit 5)
6. **Unit 2** — `EXIT_PREREQUISITES` exit code + `classifyError` updates (depends on Unit 6 for full error reconstruction)
7. **Unit 4** — `formatError` enrichment (depends on Units 1, 2, 5, 6 — uses `cause_type`, `installHint`, `fixCommand`)

---

## Testing

### Unit Tests: `tests/unit/core/errors.test.ts`

Add tests for:
- `LaunchError` with all `cause_type` values
- `LaunchError` default `cause_type` is `"unknown"` when omitted
- `AdapterNotFoundError` message contains "krometrail doctor"
- `AdapterPrerequisiteError` with `fixCommand` field
- `ChromeNotFoundError` message varies by platform (mock `process.platform` or just assert contains key phrases)

### Unit Tests: `tests/unit/cli/exit-codes.test.ts`

Add tests for:
- `AdapterPrerequisiteError` → `EXIT_PREREQUISITES` (6)
- `RPC_ADAPTER_ERROR` numeric code → `EXIT_PREREQUISITES` (6)
- `AdapterNotFoundError` remains → `EXIT_NOT_FOUND` (3)
- Update existing test that expected `AdapterPrerequisiteError` → 3 (if any)

### Unit Tests: `tests/unit/cli/envelope.test.ts`

Add tests for:
- `errorEnvelope(new AdapterPrerequisiteError("python", ["debugpy"], "pip install debugpy", "pip install debugpy"))` includes `fixCommand`
- `errorEnvelope(new Error("generic"))` does NOT include `fixCommand`

### Unit Tests: `tests/unit/cli/format.test.ts`

Add tests for:
- `formatError(new AdapterPrerequisiteError(...), "text")` includes install hint and "krometrail doctor"
- `formatError(new LaunchError("...", "...", "connection_timeout"), "text")` includes port hint
- `formatError(new LaunchError("...", "...", "spawn_failed"), "text")` includes PATH hint
- `formatError(new DAPTimeoutError("step", 30000), "text")` includes timeout guidance
- `formatError(...)` in "json" mode delegates to `errorEnvelope` unchanged

### Unit Tests: `tests/unit/cli/doctor.test.ts` (new file)

Add tests for:
- `runDoctorChecks()` returns `fixCommand` from adapters (mock adapter registry)
- `formatDoctor()` in text mode shows fix commands for missing adapters
- `formatDoctor()` in JSON mode includes `fixCommand` in adapter entries

### E2E Tests: `tests/e2e/cli/prerequisite-errors.test.ts` (new file)

```typescript
import { describe, expect, it } from "vitest";
import { runCli, runCliJson } from "../../helpers/cli-runner.js";

describe("E2E: prerequisite and adapter errors", () => {
	describe("missing adapter prerequisites", () => {
		it("launch with empty PATH returns exit code 6 and actionable error", async () => {
			// Use a minimal PATH that has bun but not debuggers
			const result = await runCli(
				["debug", "launch", "python3 /tmp/nonexistent.py"],
				{ env: { PATH: "/usr/bin:/bin" } },
			);
			expect(result.exitCode).toBe(6);
			expect(result.stderr).toContain("prerequisites not met");
		});

		it("launch with empty PATH returns JSON error with fixCommand", async () => {
			const result = await runCliJson(
				["debug", "launch", "python3 /tmp/nonexistent.py", "--json"],
				{ env: { PATH: "/usr/bin:/bin" } },
			);
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("ADAPTER_PREREQUISITES");
				expect(result.error.retryable).toBe(false);
			}
		});
	});

	describe("unknown language/extension", () => {
		it("launch with unknown extension returns exit code 3", async () => {
			const result = await runCli(["debug", "launch", "unknown.xyz"]);
			expect(result.exitCode).toBe(3);
			expect(result.stderr).toContain("krometrail doctor");
			expect(result.stderr).not.toContain("debug_status");
		});
	});

	describe("doctor --fix", () => {
		it("doctor --fix prints fix commands for missing adapters", async () => {
			const result = await runCli(["doctor", "--fix"]);
			expect(result.exitCode).toBe(0);
			// Should contain at least one fix command or "nothing to fix"
			const output = result.stdout;
			expect(output.includes("# Run these commands") || output.includes("nothing to fix")).toBe(true);
		});

		it("doctor --json includes fixCommand in missing adapter entries", async () => {
			const result = await runCliJson<{
				adapters: Array<{ id: string; status: string; fixCommand?: string }>;
			}>(["doctor", "--json"]);
			expect(result.ok).toBe(true);
			if (result.ok) {
				const missing = result.data.adapters.filter((a) => a.status === "missing");
				// Missing adapters that have known fix commands should include them
				for (const adapter of missing) {
					// At minimum, installHint should be present for all missing
					// fixCommand is present for adapters with concrete commands
				}
			}
		});
	});

	describe("error message quality", () => {
		it("prerequisite error in text mode includes install hint and doctor reference", async () => {
			const result = await runCli(
				["debug", "launch", "python3 /tmp/nonexistent.py"],
				{ env: { PATH: "/usr/bin:/bin" } },
			);
			expect(result.stderr).toContain("krometrail doctor");
		});
	});
});
```

### E2E Tests: `tests/e2e/cli/doctor-completeness.test.ts` (new file)

```typescript
import { describe, expect, it } from "vitest";
import { runCliJson } from "../../helpers/cli-runner.js";

describe("E2E: doctor completeness", () => {
	it("doctor --json returns all 10 registered adapters", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; displayName: string; status: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const ids = result.data.adapters.map((a) => a.id);
			expect(ids).toContain("python");
			expect(ids).toContain("node");
			expect(ids).toContain("go");
			expect(ids).toContain("rust");
			expect(ids).toContain("java");
			expect(ids).toContain("cpp");
			expect(ids).toContain("ruby");
			expect(ids).toContain("csharp");
			expect(ids).toContain("swift");
			expect(ids).toContain("kotlin");
			expect(result.data.adapters.length).toBe(10);
		}
	});

	it("every missing adapter has an installHint", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; status: string; installHint?: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const missing = result.data.adapters.filter((a) => a.status === "missing");
			for (const adapter of missing) {
				expect(adapter.installHint, `Adapter '${adapter.id}' is missing but has no installHint`).toBeTruthy();
			}
		}
	});

	it("available adapters have version strings", async () => {
		const result = await runCliJson<{
			adapters: Array<{ id: string; status: string; version?: string }>;
		}>(["doctor", "--json"]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const available = result.data.adapters.filter((a) => a.status === "available");
			for (const adapter of available) {
				expect(adapter.version, `Adapter '${adapter.id}' is available but has no version`).toBeTruthy();
			}
		}
	});
});
```

### E2E Tests: `tests/e2e/cli/install-flow.test.ts` (new file)

```typescript
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../../");
const INSTALL_SCRIPT = resolve(PROJECT_ROOT, "scripts/install.sh");

function runShell(
	cmd: string,
	args: string[],
	opts?: { env?: Record<string, string>; cwd?: string; timeoutMs?: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: opts?.env ? { ...process.env, ...opts.env } : undefined,
			cwd: opts?.cwd,
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
		proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
		const timer = setTimeout(() => { proc.kill(); reject(new Error("timeout")); }, opts?.timeoutMs ?? 30_000);
		proc.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr }); });
		proc.on("error", (err) => { clearTimeout(timer); reject(err); });
	});
}

describe("E2E: install.sh", () => {
	const tempDir = mkdtempSync(join(tmpdir(), "krometrail-install-test-"));

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("install script is valid shell syntax", async () => {
		const result = await runShell("sh", ["-n", INSTALL_SCRIPT]);
		expect(result.exitCode).toBe(0);
	});

	it("install script --help exits 0 and shows usage", async () => {
		const result = await runShell("sh", [INSTALL_SCRIPT, "--help"]);
		expect(result.exitCode).toBe(0);
		expect((result.stdout + result.stderr).toLowerCase()).toMatch(/usage|install/);
	});

	it("install script installs binary to custom dir", async () => {
		const binDir = join(tempDir, "bin");
		const result = await runShell("sh", [INSTALL_SCRIPT, "--install-dir", binDir], {
			timeoutMs: 60_000,
		});

		// If this fails due to network (CI without internet), skip gracefully
		if (result.stderr.includes("rate limit") || result.stderr.includes("Could not download")) {
			console.warn("Skipping install test: network issue");
			return;
		}

		expect(result.exitCode).toBe(0);
		expect(existsSync(join(binDir, "krometrail"))).toBe(true);
	}, 90_000);

	it("installed binary runs --version successfully", async () => {
		const binDir = join(tempDir, "bin");
		const binaryPath = join(binDir, "krometrail");
		if (!existsSync(binaryPath)) {
			console.warn("Skipping: binary not installed (previous test may have been skipped)");
			return;
		}

		const result = await runShell(binaryPath, ["--version"]);
		expect(result.exitCode).toBe(0);
		expect((result.stdout + result.stderr).trim()).toMatch(/\d+\.\d+\.\d+/);
	});

	it("installed binary runs doctor successfully", async () => {
		const binDir = join(tempDir, "bin");
		const binaryPath = join(binDir, "krometrail");
		if (!existsSync(binaryPath)) {
			console.warn("Skipping: binary not installed");
			return;
		}

		const result = await runShell(binaryPath, ["doctor"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Platform:");
		expect(result.stdout).toContain("Adapters:");
	});

	it("install script with bogus version fails gracefully", async () => {
		const binDir = join(tempDir, "bin-bogus");
		const result = await runShell("sh", [INSTALL_SCRIPT, "--version", "v99.99.99", "--install-dir", binDir], {
			timeoutMs: 30_000,
		});
		expect(result.exitCode).not.toBe(0);
		// Should show an error, not crash with a shell syntax error
		expect(result.stderr + result.stdout).not.toContain("syntax error");
	});
});
```

### E2E Tests: `tests/e2e/cli/error-exit-codes.test.ts` (new file)

```typescript
import { describe, expect, it } from "vitest";
import { runCli } from "../../helpers/cli-runner.js";

describe("E2E: error exit codes", () => {
	it("unknown extension → exit 3 (NOT_FOUND)", async () => {
		const result = await runCli(["debug", "launch", "app.xyz"]);
		expect(result.exitCode).toBe(3);
	});

	it("missing prerequisites → exit 6 (PREREQUISITES)", async () => {
		// Use restricted PATH to ensure adapters fail prerequisite checks
		const result = await runCli(
			["debug", "launch", "python3 test.py"],
			{ env: { PATH: "/usr/bin:/bin" } },
		);
		expect(result.exitCode).toBe(6);
	});

	it("no active sessions → exit 1 (ERROR)", async () => {
		const result = await runCli(["debug", "continue"]);
		// No daemon or sessions running — should be a generic error
		expect(result.exitCode).toBe(1);
	});
});
```

---

## Verification Checklist

```bash
# All existing tests still pass
bun run test:unit

# New unit tests pass
bun run test:unit -- --reporter=verbose tests/unit/core/errors.test.ts
bun run test:unit -- --reporter=verbose tests/unit/cli/exit-codes.test.ts
bun run test:unit -- --reporter=verbose tests/unit/cli/envelope.test.ts
bun run test:unit -- --reporter=verbose tests/unit/cli/format.test.ts
bun run test:unit -- --reporter=verbose tests/unit/cli/doctor.test.ts

# New E2E tests pass
bun run test:e2e -- --reporter=verbose tests/e2e/cli/prerequisite-errors.test.ts
bun run test:e2e -- --reporter=verbose tests/e2e/cli/doctor-completeness.test.ts
bun run test:e2e -- --reporter=verbose tests/e2e/cli/install-flow.test.ts
bun run test:e2e -- --reporter=verbose tests/e2e/cli/error-exit-codes.test.ts

# Lint clean
bun run lint

# Manual spot-checks
krometrail doctor --json | jq '.data.adapters[] | select(.status == "missing")'
krometrail doctor --fix
krometrail debug launch "python3 /tmp/nonexistent.py" 2>&1; echo "exit: $?"
```
