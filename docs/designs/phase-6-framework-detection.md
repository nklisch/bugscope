# Design: Phase 6 — Framework Detection

## Overview

Phase 6 adds automatic framework detection so agents can debug test failures and web requests without manually configuring the debugger. When an agent calls `debug_launch("pytest tests/")`, the system automatically detects pytest and configures debugpy for subprocess-aware debugging. Similarly, `debug_launch("flask run")` auto-adds `--no-reload` to prevent debugger conflicts.

**Key constraints:**
- Detection is command-string-based — no project file scanning in this phase.
- Framework overrides never break existing behavior. They add flags/args that improve debugging.
- Agents can override detection with `framework: "none"` or force a specific framework.
- All overrides are transparent — warnings in the launch response explain what was changed.

**Scope:** 6 framework detectors (pytest, jest, go test, mocha, django, flask), integration into the launch flow at all 3 surfaces (session manager, MCP, CLI), and test fixtures proving each detector works.

---

## Implementation Units

### Unit 1: Framework Types & Registry

**File**: `src/frameworks/index.ts` (new)

```typescript
/**
 * Result of framework detection. Contains modifications to apply
 * to the launch config before passing to the adapter.
 */
export interface FrameworkOverrides {
	/** Detected framework identifier (e.g., "pytest", "jest", "django") */
	framework: string;
	/** Human-readable name for logs/viewport */
	displayName: string;
	/** Modified command string (replaces the original if set) */
	command?: string;
	/** Extra environment variables to merge */
	env?: Record<string, string>;
	/** Extra DAP launch args to merge into the adapter's launchArgs */
	launchArgs?: Record<string, unknown>;
	/** Warnings to include in the launch response (explain what was changed) */
	warnings: string[];
}

/**
 * A framework detector checks if a command matches a known framework
 * and returns config overrides for debugging.
 */
export interface FrameworkDetector {
	/** Unique identifier, e.g., "pytest" */
	id: string;
	/** Human-readable name, e.g., "pytest" */
	displayName: string;
	/** Which adapter this framework uses, e.g., "python" */
	adapterId: string;
	/**
	 * Check if the command matches this framework.
	 * Returns overrides if detected, or null if not a match.
	 */
	detect(command: string, cwd: string): FrameworkOverrides | null;
}

/** Registry of all framework detectors, keyed by id. */
const detectors: FrameworkDetector[] = [];

/** Register a framework detector. */
export function registerDetector(detector: FrameworkDetector): void {
	detectors.push(detector);
}

/**
 * Detect the framework from the command string.
 *
 * @param command - The launch command
 * @param adapterId - The resolved adapter id (e.g., "python", "node", "go")
 * @param cwd - Working directory
 * @param explicitFramework - If set, force this framework (or "none" to skip)
 * @returns FrameworkOverrides or null if no framework detected
 */
export function detectFramework(
	command: string,
	adapterId: string,
	cwd: string,
	explicitFramework?: string,
): FrameworkOverrides | null {
	// Explicit "none" skips detection
	if (explicitFramework === "none") return null;

	// Explicit framework name — find it
	if (explicitFramework) {
		const detector = detectors.find((d) => d.id === explicitFramework);
		if (!detector) return null;
		return detector.detect(command, cwd);
	}

	// Auto-detect: try each detector for this adapter
	for (const detector of detectors) {
		if (detector.adapterId !== adapterId) continue;
		const result = detector.detect(command, cwd);
		if (result) return result;
	}

	return null;
}

/**
 * Register all built-in framework detectors.
 * Called once at startup alongside registerAllAdapters().
 */
export function registerAllDetectors(): void {
	for (const detector of pythonDetectors) registerDetector(detector);
	for (const detector of nodeDetectors) registerDetector(detector);
	for (const detector of goDetectors) registerDetector(detector);
}

// Re-export language-specific detectors for registerAllDetectors
import { detectors as goDetectors } from "./go.js";
import { detectors as nodeDetectors } from "./node.js";
import { detectors as pythonDetectors } from "./python.js";
```

**Implementation Notes:**
- Detection is synchronous — command-string matching only. No file I/O for detection.
- Detectors are ordered within each language. First match wins.
- `registerAllDetectors()` must be called at startup in each entry point (MCP, daemon, CLI doctor).

**Acceptance Criteria:**
- [ ] `detectFramework("pytest tests/", "python", "/project")` returns a `FrameworkOverrides` with `framework: "pytest"`
- [ ] `detectFramework("python app.py", "python", "/project")` returns `null`
- [ ] `detectFramework("pytest tests/", "python", "/project", "none")` returns `null`
- [ ] `detectFramework("python app.py", "python", "/project", "pytest")` forces pytest detection (returns overrides or null depending on detector logic)

---

### Unit 2: Python Framework Detectors

**File**: `src/frameworks/python.ts` (new)

```typescript
import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/** Matches "pytest", "python -m pytest", "python3 -m pytest" */
const PYTEST_PATTERN = /(?:^|\s)(?:python3?\s+-m\s+)?pytest\b/;

/** Matches pytest-xdist parallel flag: -n <num> or -nauto */
const XDIST_PATTERN = /(?:^|\s)-n\s*(?:\d+|auto)\b/;

/** Matches pytest --forked flag */
const FORKED_PATTERN = /\s--forked\b/;

const pytestDetector: FrameworkDetector = {
	id: "pytest",
	displayName: "pytest",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!PYTEST_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		const launchArgs: Record<string, unknown> = {
			// Enable subprocess debugging so debugpy attaches to pytest's
			// child processes (e.g., when pytest uses subprocesses for isolation)
			subProcess: true,
		};

		// Warn about incompatible modes
		if (XDIST_PATTERN.test(command)) {
			warnings.push(
				"pytest-xdist (-n) spawns parallel workers that cannot be individually debugged. " +
				"Consider removing -n for debugging, or use -n0 to disable parallelism.",
			);
		}
		if (FORKED_PATTERN.test(command)) {
			warnings.push(
				"pytest --forked spawns subprocesses per test. Breakpoints may not " +
				"be hit in forked processes. Consider removing --forked for debugging.",
			);
		}

		return {
			framework: "pytest",
			displayName: "pytest",
			launchArgs,
			warnings,
		};
	},
};

/** Matches "manage.py runserver" or "django-admin runserver" */
const DJANGO_PATTERN = /(?:manage\.py|django-admin)\s+runserver/;

const djangoDetector: FrameworkDetector = {
	id: "django",
	displayName: "Django",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!DJANGO_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --nothreading and --noreload if not already present
		const flags: string[] = [];
		if (!command.includes("--nothreading")) {
			flags.push("--nothreading");
		}
		if (!command.includes("--noreload")) {
			flags.push("--noreload");
		}

		if (flags.length > 0) {
			modifiedCommand = `${command} ${flags.join(" ")}`;
			warnings.push(
				`Added ${flags.join(", ")} for debugger compatibility. ` +
				"Django's auto-reloader and threading conflict with debugpy.",
			);
		}

		return {
			framework: "django",
			displayName: "Django",
			command: modifiedCommand,
			env: { PYTHONDONTWRITEBYTECODE: "1" },
			warnings,
		};
	},
};

/** Matches "flask run" or "python -m flask run" */
const FLASK_PATTERN = /(?:^|\s)(?:python3?\s+-m\s+)?flask\s+run/;

const flaskDetector: FrameworkDetector = {
	id: "flask",
	displayName: "Flask",
	adapterId: "python",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!FLASK_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --no-reload if not already present
		if (!command.includes("--no-reload") && !command.includes("--no-debugger")) {
			modifiedCommand = `${command} --no-reload`;
			warnings.push(
				"Added --no-reload for debugger compatibility. " +
				"Flask's Werkzeug reloader spawns a child process that conflicts with debugpy.",
			);
		}

		return {
			framework: "flask",
			displayName: "Flask",
			command: modifiedCommand,
			env: {
				WERKZEUG_RUN_MAIN: "true",
				FLASK_DEBUG: "0",
			},
			warnings,
		};
	},
};

export const detectors: FrameworkDetector[] = [
	pytestDetector,
	djangoDetector,
	flaskDetector,
];
```

**Implementation Notes:**
- Detectors are pure functions — no side effects, no I/O.
- Pytest is listed first because `python -m pytest manage.py runserver` is not a real command; ordering doesn't cause conflicts.
- Django detection appends `--nothreading --noreload` to the command string. The Python adapter's `parseCommand()` ignores flags it doesn't recognize, so these pass through to the debuggee.
- Flask detection sets `WERKZEUG_RUN_MAIN=true` to prevent Werkzeug from spawning a child reloader process.

**Acceptance Criteria:**
- [ ] `pytestDetector.detect("pytest tests/", "/p")` returns overrides with `subProcess: true` in launchArgs
- [ ] `pytestDetector.detect("python -m pytest tests/test_order.py -x", "/p")` returns overrides
- [ ] `pytestDetector.detect("python app.py", "/p")` returns `null`
- [ ] `pytestDetector.detect("pytest -n4 tests/", "/p")` returns overrides with xdist warning
- [ ] `djangoDetector.detect("python manage.py runserver", "/p")` returns overrides with `--nothreading --noreload` appended
- [ ] `djangoDetector.detect("python manage.py runserver --noreload", "/p")` does not double-add `--noreload`
- [ ] `flaskDetector.detect("flask run", "/p")` returns overrides with `--no-reload` appended and `WERKZEUG_RUN_MAIN` env
- [ ] `flaskDetector.detect("python app.py", "/p")` returns `null`

---

### Unit 3: Node.js Framework Detectors

**File**: `src/frameworks/node.ts` (new)

```typescript
import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/**
 * Matches jest commands:
 * - "jest tests/"
 * - "npx jest tests/"
 * - "node_modules/.bin/jest tests/"
 * - "bunx jest tests/"
 */
const JEST_PATTERN = /(?:^|\s)(?:npx\s+|bunx\s+|node_modules\/\.bin\/)?jest\b/;

const jestDetector: FrameworkDetector = {
	id: "jest",
	displayName: "Jest",
	adapterId: "node",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!JEST_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --runInBand if not already present — Jest spawns workers by default,
		// which can't be individually debugged via a single DAP session.
		if (!command.includes("--runInBand") && !command.includes("-i")) {
			// Insert --runInBand after the jest command
			modifiedCommand = command.replace(
				/(?<=\bjest)\b/,
				" --runInBand",
			);
			warnings.push(
				"Added --runInBand for debugging. Jest workers run in separate " +
				"processes that can't be debugged individually.",
			);
		}

		return {
			framework: "jest",
			displayName: "Jest",
			command: modifiedCommand,
			warnings,
		};
	},
};

/**
 * Matches mocha commands:
 * - "mocha tests/"
 * - "npx mocha tests/"
 * - "node_modules/.bin/mocha tests/"
 */
const MOCHA_PATTERN = /(?:^|\s)(?:npx\s+|bunx\s+|node_modules\/\.bin\/)?mocha\b/;

const mochaDetector: FrameworkDetector = {
	id: "mocha",
	displayName: "Mocha",
	adapterId: "node",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!MOCHA_PATTERN.test(command)) return null;

		// Mocha runs in the same process — no special config needed.
		// Detection is useful for future enhancements and for surfacing
		// the framework name in the viewport/logs.
		return {
			framework: "mocha",
			displayName: "Mocha",
			warnings: [],
		};
	},
};

export const detectors: FrameworkDetector[] = [
	jestDetector,
	mochaDetector,
];
```

**Implementation Notes:**
- Jest `--runInBand` insertion uses a regex replace to place it right after `jest`. This ensures flags like `--coverage` that follow aren't displaced.
- The regex `(?<=\bjest)\b` is a lookbehind that matches the position right after `jest`. If the regex engine doesn't support lookbehinds well, a simpler approach: `command.replace(/\bjest\b/, "jest --runInBand")`.
- Mocha detection is minimal — the js-debug adapter handles mocha well without special config. Detection primarily serves to surface the framework name in logs.

**Acceptance Criteria:**
- [ ] `jestDetector.detect("jest tests/", "/p")` returns overrides with `--runInBand` in command
- [ ] `jestDetector.detect("npx jest --coverage tests/", "/p")` returns overrides with `--runInBand` injected
- [ ] `jestDetector.detect("jest --runInBand tests/", "/p")` does not double-add `--runInBand`
- [ ] `jestDetector.detect("node app.js", "/p")` returns `null`
- [ ] `mochaDetector.detect("mocha tests/", "/p")` returns overrides with no command modification
- [ ] `mochaDetector.detect("npx mocha --reporter dot", "/p")` returns overrides

---

### Unit 4: Go Framework Detectors

**File**: `src/frameworks/go.ts` (new)

```typescript
import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/** Matches "go test" commands */
const GO_TEST_PATTERN = /^go\s+test\b/;

const goTestDetector: FrameworkDetector = {
	id: "gotest",
	displayName: "go test",
	adapterId: "go",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!GO_TEST_PATTERN.test(command.trim())) return null;

		// The Go adapter's parseGoCommand already handles "go test" → mode: "test".
		// Detection here surfaces the framework name and adds useful hints.
		const warnings: string[] = [];

		// Check for -count flag — without it, Go caches test results
		if (!command.includes("-count=") && !command.includes("-count ")) {
			warnings.push(
				"Tip: use -count=1 to disable test result caching during debugging.",
			);
		}

		return {
			framework: "gotest",
			displayName: "go test",
			warnings,
		};
	},
};

export const detectors: FrameworkDetector[] = [
	goTestDetector,
];
```

**Implementation Notes:**
- Go test detection is lightweight — the heavy lifting (mode: "test") is already in the Go adapter.
- The `-count=1` tip is genuinely useful: without it, Go's test cache can cause confusing behavior when debugging (tests "pass" without running because results are cached).

**Acceptance Criteria:**
- [ ] `goTestDetector.detect("go test ./...", "/p")` returns overrides with `framework: "gotest"`
- [ ] `goTestDetector.detect("go test -count=1 ./pkg/...", "/p")` returns overrides without the caching tip
- [ ] `goTestDetector.detect("go run main.go", "/p")` returns `null`
- [ ] `goTestDetector.detect("./mybinary", "/p")` returns `null`

---

### Unit 5: Session Manager Integration

**File**: `src/core/session-manager.ts` (modify `launch` method)

Add `framework` to `LaunchOptions` and integrate detection into the launch flow.

```typescript
// Add to LaunchOptions interface:
export interface LaunchOptions {
	command: string;
	language?: string;
	/** Explicit framework override. "none" disables detection. */
	framework?: string;
	breakpoints?: Array<{ file: string; breakpoints: Breakpoint[] }>;
	cwd?: string;
	env?: Record<string, string>;
	viewportConfig?: Partial<ViewportConfig>;
	stopOnEntry?: boolean;
}
```

**Changes to `SessionManager.launch()`** — insert framework detection after adapter resolution, before `adapter.launch()`:

```typescript
async launch(options: LaunchOptions): Promise<LaunchResult> {
	// ... existing concurrent session limit check ...

	// 2. Resolve adapter
	const adapter = this.resolveAdapter(options.command, options.language);

	// Check prerequisites
	const prereqs = await adapter.checkPrerequisites();
	if (!prereqs.satisfied) {
		throw new AdapterPrerequisiteError(adapter.id, prereqs.missing ?? [], prereqs.installHint);
	}

	// 2.5 NEW: Framework detection
	const cwd = options.cwd ?? process.cwd();
	const frameworkOverrides = detectFramework(
		options.command,
		adapter.id,
		cwd,
		options.framework,
	);

	// Apply framework overrides to the launch config
	const effectiveCommand = frameworkOverrides?.command ?? options.command;
	const effectiveEnv = frameworkOverrides?.env
		? { ...frameworkOverrides.env, ...options.env }
		: options.env;

	// 3. Launch adapter with (possibly modified) config
	const connection = await adapter.launch({
		command: effectiveCommand,
		cwd,
		env: effectiveEnv,
	});

	// ... existing DAPClient setup ...

	// When building dapLaunchArgs, merge framework overrides:
	const dapLaunchArgs: Record<string, unknown> = {
		noDebug: false,
		program: effectiveCommand,
		stopOnEntry: options.stopOnEntry ?? false,
		cwd,
		env: effectiveEnv ?? {},
		...adapterLaunchArgs,
		// Framework overrides go last so they take precedence over adapter defaults
		...(frameworkOverrides?.launchArgs ?? {}),
	};

	// ... rest of launch flow unchanged ...

	// Store framework info and warnings in the session for status reporting
	const session: DebugSession = {
		// ... existing fields ...
		framework: frameworkOverrides?.framework ?? null,
		frameworkWarnings: frameworkOverrides?.warnings ?? [],
	};

	// ... rest of method ...

	// Include framework info in the launch result
	// The viewport prefix includes framework warnings if any
}
```

**New fields on `DebugSession`:**

```typescript
// Add to DebugSession interface:
export interface DebugSession {
	// ... existing fields ...
	/** Detected framework identifier, or null */
	framework: string | null;
	/** Framework-related warnings surfaced at launch */
	frameworkWarnings: string[];
}
```

**Changes to launch result formatting** — include framework warnings in the launch response viewport:

```typescript
// In the launch result construction (after session is built):
let viewport = result.viewport;
if (viewport && session.frameworkWarnings.length > 0) {
	const warningBlock = session.frameworkWarnings
		.map((w) => `⚠ ${w}`)
		.join("\n");
	viewport = `${warningBlock}\n\n${viewport}`;
}
```

Wait — the viewport is text output for agents. Warnings should be part of the launch response text, not the viewport itself. Better to prepend to the full response text.

**Import needed:**

```typescript
import { detectFramework, registerAllDetectors } from "../frameworks/index.js";
```

Note: `registerAllDetectors()` is called at each entry point (not in session-manager).

**Implementation Notes:**
- Framework env vars are merged *under* user-provided env (user overrides win): `{ ...frameworkOverrides.env, ...options.env }`.
- Framework `launchArgs` are merged *over* adapter launchArgs — this is intentional because the framework knows better than the adapter's defaults (e.g., pytest needs `subProcess: true` even though debugpy doesn't default to it).
- Framework warnings are stored on the session so `debug_status` can also report them.
- The `framework` field on `LaunchOptions` is optional. Not providing it means auto-detect. Setting it to `"none"` disables detection.

**Acceptance Criteria:**
- [ ] `launch({ command: "pytest tests/" })` detects pytest and sets `subProcess: true` in DAP launch args
- [ ] `launch({ command: "pytest tests/", framework: "none" })` does not apply framework overrides
- [ ] `launch({ command: "python app.py", framework: "django" })` forces django detection (returns null since command doesn't match django)
- [ ] `launch({ command: "flask run" })` modifies command to include `--no-reload`
- [ ] `launch({ command: "jest tests/" })` modifies command to include `--runInBand`
- [ ] Framework warnings are accessible via `session.frameworkWarnings`
- [ ] User-provided env vars override framework env vars

---

### Unit 6: MCP Tool Updates

**File**: `src/mcp/tools/index.ts` (modify `debug_launch` tool)

Add `framework` parameter to the `debug_launch` tool schema:

```typescript
server.tool(
	"debug_launch",
	"Launch a debug target process. Sets initial breakpoints and returns a session handle. " +
	"The viewport shows source, locals, and call stack at each stop. " +
	"Automatically detects test frameworks (pytest, jest, go test) and web frameworks " +
	"(Django, Flask) to configure the debugger appropriately.",
	{
		command: z.string().describe(
			"Command to execute, e.g. 'python app.py' or 'pytest tests/' or 'flask run'. " +
			"Test and web frameworks are auto-detected and configured for debugging.",
		),
		language: z.enum(["python", "javascript", "typescript", "go", "rust", "java", "cpp"])
			.optional()
			.describe("Override automatic language detection based on file extension"),
		framework: z.string().optional().describe(
			"Override framework auto-detection. Use a framework name (e.g., 'pytest', 'jest', " +
			"'django', 'flask', 'mocha', 'gotest') to force detection, or 'none' to disable it.",
		),
		breakpoints: z.array(FileBreakpointsMcpSchema).optional().describe(
			"Initial breakpoints to set before execution begins. " +
			"Note: breakpoints on non-executable lines (comments, blank lines, decorators) " +
			"may be adjusted by the debugger to the nearest executable line.",
		),
		cwd: z.string().optional().describe("Working directory for the debug target"),
		env: z.record(z.string(), z.string()).optional()
			.describe("Additional environment variables for the debug target"),
		viewport_config: z.object({
			source_context_lines: z.number().optional(),
			stack_depth: z.number().optional(),
			locals_max_depth: z.number().optional(),
			locals_max_items: z.number().optional(),
			string_truncate_length: z.number().optional(),
			collection_preview_items: z.number().optional(),
		}).optional().describe("Override default viewport rendering parameters"),
		stop_on_entry: z.boolean().optional()
			.describe("Pause on the first executable line. Default: false"),
	},
	async ({ command, language, framework, breakpoints, cwd, env, viewport_config, stop_on_entry }) => {
		try {
			const result = await sessionManager.launch({
				command,
				language,
				framework,
				breakpoints,
				cwd,
				env,
				viewportConfig: mapViewportConfig(viewport_config),
				stopOnEntry: stop_on_entry,
			});
			// ... existing response handling (framework warnings are included by session manager)
		} catch (err) {
			// ... existing error handling
		}
	},
);
```

**Changes to MCP `index.ts`** — add `registerAllDetectors()` call:

```typescript
// src/mcp/index.ts
import { registerAllDetectors } from "../frameworks/index.js";

// After registerAllAdapters():
registerAllDetectors();
```

**Implementation Notes:**
- The `framework` parameter is a free string, not an enum — this avoids breaking MCP schema when new frameworks are added.
- The tool description is updated to mention auto-detection so agents know they can just pass framework commands directly.

**Acceptance Criteria:**
- [ ] MCP `debug_launch` accepts `framework` parameter
- [ ] `framework: "none"` disables auto-detection
- [ ] `framework: "pytest"` forces pytest config
- [ ] Tool description mentions auto-detection
- [ ] `registerAllDetectors()` is called on MCP server startup

---

### Unit 7: Daemon Protocol & CLI Updates

**File**: `src/daemon/protocol.ts` (modify `LaunchParamsSchema`)

```typescript
export const LaunchParamsSchema = z.object({
	command: z.string(),
	language: z.string().optional(),
	framework: z.string().optional(),
	breakpoints: z.array(FileBreakpointsSchema).optional(),
	cwd: z.string().optional(),
	env: z.record(z.string(), z.string()).optional(),
	viewportConfig: z.object({
		sourceContextLines: z.number().optional(),
		stackDepth: z.number().optional(),
		localsMaxDepth: z.number().optional(),
		localsMaxItems: z.number().optional(),
		stringTruncateLength: z.number().optional(),
		collectionPreviewItems: z.number().optional(),
	}).optional(),
	stopOnEntry: z.boolean().optional(),
});
```

**File**: `src/daemon/entry.ts` (add `registerAllDetectors`)

```typescript
import { registerAllDetectors } from "../frameworks/index.js";

// After registerAllAdapters():
registerAllDetectors();
```

**File**: `src/cli/commands/index.ts` (modify `launchCommand`)

Add `--framework` flag:

```typescript
export const launchCommand = defineCommand({
	meta: { name: "launch", description: "Launch a debug session" },
	args: {
		command: {
			type: "positional",
			description: "Command to debug, e.g. 'python app.py' or 'pytest tests/'",
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
		framework: {
			type: "string",
			description: "Override framework auto-detection (e.g., 'pytest', 'jest', 'none')",
		},
		"stop-on-entry": {
			type: "boolean",
			description: "Pause on first executable line",
			default: false,
		},
		...globalArgs,
	},
	async run({ args }) {
		await runCommand(
			args,
			async (client, _sessionId, mode) => {
				const breakpoints = args.break ? [parseBreakpointString(args.break)] : undefined;
				const result = await client.call<LaunchResultPayload>("session.launch", {
					command: args.command,
					language: args.language,
					framework: args.framework,
					breakpoints: breakpoints?.map((fb) => ({
						file: fb.file,
						breakpoints: fb.breakpoints,
					})),
					stopOnEntry: args["stop-on-entry"],
				});
				process.stdout.write(`${formatLaunch(result, mode)}\n`);
			},
			{ needsSession: false },
		);
	},
});
```

**File**: `src/cli/commands/doctor.ts` (add framework detector listing)

Add a section to the doctor output listing registered framework detectors:

```typescript
// After adapter listing:
import { detectors as registeredDetectors } from "../../frameworks/index.js";

// In the doctor command handler:
console.log("\nFramework Detectors:");
for (const detector of registeredDetectors) {
	console.log(`  ${detector.displayName} (${detector.adapterId})`);
}
```

Wait — `detectors` is a module-level array in the registry. It should be exported via a `listDetectors()` function, not the raw array. Let me update Unit 1.

**Add to `src/frameworks/index.ts`:**

```typescript
/** Return all registered detectors (for doctor command). */
export function listDetectors(): ReadonlyArray<FrameworkDetector> {
	return detectors;
}
```

**Implementation Notes:**
- The daemon protocol schema just adds `framework` — the daemon server already passes params directly to `sessionManager.launch()`, so no dispatch code changes.
- CLI `--framework` is a free string, matching the MCP parameter.
- Doctor lists detectors so agents/users can see what frameworks are supported.

**Acceptance Criteria:**
- [ ] `LaunchParamsSchema` accepts `framework` string
- [ ] CLI `--framework` flag passes through to daemon
- [ ] `krometrail doctor` lists registered framework detectors
- [ ] `registerAllDetectors()` is called on daemon startup

---

### Unit 8: Launch Result with Framework Info

**File**: `src/daemon/protocol.ts` (modify `LaunchResultPayload`)

```typescript
export interface LaunchResultPayload {
	sessionId: string;
	viewport?: string;
	status: string;
	/** Detected framework, or null */
	framework?: string;
	/** Framework warnings (e.g., "Added --runInBand for debugging") */
	frameworkWarnings?: string[];
}
```

**File**: `src/core/session-manager.ts` (modify `LaunchResult`)

```typescript
export interface LaunchResult {
	sessionId: string;
	viewport?: string;
	status: SessionStatus;
	/** Detected framework identifier */
	framework?: string;
	/** Framework-related warnings */
	frameworkWarnings?: string[];
}
```

Populate in the launch method:

```typescript
return {
	sessionId,
	viewport: expectStop ? viewport : undefined,
	status: expectStop ? "stopped" : "running",
	framework: frameworkOverrides?.framework ?? undefined,
	frameworkWarnings: frameworkOverrides?.warnings?.length
		? frameworkOverrides.warnings
		: undefined,
};
```

**File**: `src/cli/format.ts` (modify `formatLaunch`)

```typescript
export function formatLaunch(result: LaunchResultPayload, mode: OutputMode): string {
	if (mode === "json") {
		return JSON.stringify(result, null, 2);
	}

	const lines: string[] = [];

	// Session header
	lines.push(`Session: ${result.sessionId}`);

	// Framework info
	if (result.framework) {
		lines.push(`Framework: ${result.framework}`);
	}

	// Framework warnings
	if (result.frameworkWarnings?.length) {
		for (const warning of result.frameworkWarnings) {
			lines.push(`Warning: ${warning}`);
		}
	}

	// Viewport or status
	if (result.viewport) {
		lines.push("");
		lines.push(result.viewport);
	} else {
		lines.push(`Status: ${result.status}`);
	}

	if (mode === "quiet") {
		// Quiet mode: viewport only
		return result.viewport ?? `Status: ${result.status}`;
	}

	return lines.join("\n");
}
```

**Implementation Notes:**
- Framework info and warnings are part of the launch response, not the viewport. The viewport format is unchanged.
- In JSON mode, `framework` and `frameworkWarnings` appear as fields in the JSON.
- In quiet mode, only the viewport is shown (no framework info).

**Acceptance Criteria:**
- [ ] `LaunchResult` includes `framework` and `frameworkWarnings` fields
- [ ] CLI text mode shows "Framework: pytest" and warnings
- [ ] CLI JSON mode includes framework fields
- [ ] CLI quiet mode omits framework info
- [ ] MCP response includes framework info in the text output

---

## Implementation Order

1. **Unit 1: Framework Types & Registry** — defines the interface all detectors implement
2. **Unit 2: Python Detectors** — pytest, django, flask (can parallel with 3, 4)
3. **Unit 3: Node.js Detectors** — jest, mocha (can parallel with 2, 4)
4. **Unit 4: Go Detectors** — go test (can parallel with 2, 3)
5. **Unit 5: Session Manager Integration** — wires detection into the launch flow
6. **Unit 8: Launch Result with Framework Info** — adds framework fields to result types and formatters
7. **Unit 6: MCP Tool Updates** — adds `framework` param and calls `registerAllDetectors()`
8. **Unit 7: Daemon Protocol & CLI Updates** — adds `framework` to schema, CLI flag, doctor output

Units 2, 3, 4 are independent and can be implemented in parallel after Unit 1.
Units 6, 7 depend on Unit 5 (session manager must accept `framework` first).

---

## Testing

### Unit Tests: `tests/unit/frameworks/`

#### `tests/unit/frameworks/python.test.ts`

```typescript
describe("pytestDetector", () => {
	it("detects 'pytest tests/'", () => { ... });
	it("detects 'python -m pytest tests/test_order.py -x'", () => { ... });
	it("detects 'python3 -m pytest tests/'", () => { ... });
	it("does not detect 'python app.py'", () => { ... });
	it("does not detect 'python pytest_helper.py'", () => { ... });
	it("sets subProcess: true in launchArgs", () => { ... });
	it("warns about pytest-xdist -n flag", () => { ... });
	it("warns about --forked flag", () => { ... });
	it("no warnings for clean pytest command", () => { ... });
});

describe("djangoDetector", () => {
	it("detects 'python manage.py runserver'", () => { ... });
	it("detects 'django-admin runserver'", () => { ... });
	it("does not detect 'python manage.py migrate'", () => { ... });
	it("appends --nothreading --noreload", () => { ... });
	it("does not double-add --noreload", () => { ... });
	it("does not double-add --nothreading", () => { ... });
	it("sets PYTHONDONTWRITEBYTECODE env", () => { ... });
});

describe("flaskDetector", () => {
	it("detects 'flask run'", () => { ... });
	it("detects 'python -m flask run'", () => { ... });
	it("does not detect 'flask db migrate'", () => { ... });
	it("appends --no-reload", () => { ... });
	it("does not double-add --no-reload", () => { ... });
	it("sets WERKZEUG_RUN_MAIN env", () => { ... });
});
```

#### `tests/unit/frameworks/node.test.ts`

```typescript
describe("jestDetector", () => {
	it("detects 'jest tests/'", () => { ... });
	it("detects 'npx jest tests/'", () => { ... });
	it("detects 'bunx jest tests/'", () => { ... });
	it("does not detect 'node app.js'", () => { ... });
	it("injects --runInBand", () => { ... });
	it("does not double-add --runInBand", () => { ... });
	it("does not double-add when -i present", () => { ... });
});

describe("mochaDetector", () => {
	it("detects 'mocha tests/'", () => { ... });
	it("detects 'npx mocha tests/'", () => { ... });
	it("does not detect 'node mocha-helper.js'", () => { ... });
	it("returns no command modification", () => { ... });
});
```

#### `tests/unit/frameworks/go.test.ts`

```typescript
describe("goTestDetector", () => {
	it("detects 'go test ./...'", () => { ... });
	it("detects 'go test -v ./pkg/...'", () => { ... });
	it("does not detect 'go run main.go'", () => { ... });
	it("does not detect './mybinary'", () => { ... });
	it("warns about test caching when -count not present", () => { ... });
	it("no caching warning when -count=1 present", () => { ... });
});
```

#### `tests/unit/frameworks/index.test.ts`

```typescript
describe("detectFramework", () => {
	beforeAll(() => { registerAllDetectors(); });

	it("auto-detects pytest for python adapter", () => { ... });
	it("auto-detects jest for node adapter", () => { ... });
	it("auto-detects go test for go adapter", () => { ... });
	it("returns null for unknown commands", () => { ... });
	it("returns null when framework='none'", () => { ... });
	it("forces specific framework when explicit", () => { ... });
	it("returns null when explicit framework doesn't match command", () => { ... });
	it("only tries detectors for the resolved adapter", () => { ... });
});
```

### Integration Tests: `tests/integration/frameworks/`

#### `tests/integration/frameworks/pytest.test.ts`

Test that pytest detection works end-to-end with a real debugpy session:

```typescript
describe.skipIf(SKIP_NO_DEBUGPY)("pytest framework detection", () => {
	let manager: SessionManager;
	let sessionId: string;

	beforeEach(() => {
		registerAllDetectors();
		manager = new SessionManager(testLimits);
	});

	afterEach(async () => {
		if (sessionId) await manager.stop(sessionId).catch(() => {});
		await manager.disposeAll();
	});

	it("launches pytest with subProcess: true and hits a breakpoint", async () => {
		const result = await manager.launch({
			command: `python3 -m pytest ${PYTEST_FIXTURE} -x`,
			breakpoints: [{ file: PYTEST_FIXTURE_MODULE, breakpoints: [{ line: 5 }] }],
		});
		sessionId = result.sessionId;
		expect(result.framework).toBe("pytest");
		// Continue to hit breakpoint
		const viewport = await manager.continue(sessionId, 15_000);
		expect(viewport).toContain("STOPPED");
	});
});
```

**Test fixture**: `tests/fixtures/python/pytest-target/`

```
tests/fixtures/python/pytest-target/
├── conftest.py       # Empty or minimal
├── module.py         # Simple module with a function to debug
└── test_module.py    # Test that calls the function
```

`module.py`:
```python
def calculate(x, y):
    result = x + y
    return result
```

`test_module.py`:
```python
from module import calculate

def test_calculate():
    result = calculate(2, 3)
    assert result == 5
```

### E2E Tests: `tests/e2e/mcp/framework-detection.test.ts`

```typescript
describe.skipIf(SKIP_NO_DEBUGPY)("E2E: framework detection", () => {
	let client: Client;

	beforeAll(async () => {
		({ client, cleanup } = await createTestClient());
	});

	it("auto-detects pytest and reports framework in response", async () => {
		const result = await callTool(client, "debug_launch", {
			command: `python3 -m pytest ${PYTEST_FIXTURE} -x`,
			breakpoints: [{ file: MODULE_FILE, breakpoints: [{ line: 3 }] }],
		});
		expect(result).toContain("pytest");
	});

	it("framework: 'none' disables auto-detection", async () => {
		const result = await callTool(client, "debug_launch", {
			command: `python3 -m pytest ${PYTEST_FIXTURE} -x`,
			framework: "none",
			stop_on_entry: true,
		});
		// Should still launch successfully, just without framework overrides
		expect(result).not.toContain("Framework:");
	});
});
```

---

## Verification Checklist

```bash
# 1. Unit tests pass
bun run test:unit tests/unit/frameworks/

# 2. Integration tests pass (requires debugpy)
bun run test:integration tests/integration/frameworks/

# 3. E2E tests pass
bun run test:e2e tests/e2e/mcp/framework-detection.test.ts

# 4. Existing tests still pass (no regressions)
bun run test

# 5. Lint passes
bun run lint

# 6. CLI help shows --framework flag
bun run dev -- launch --help

# 7. Doctor shows framework detectors
bun run dev -- doctor

# 8. Manual smoke test: pytest
bun run dev -- launch "pytest tests/fixtures/python/pytest-target/ -x" --break module.py:3

# 9. Manual smoke test: framework=none
bun run dev -- launch "pytest tests/" --framework none --stop-on-entry
```
