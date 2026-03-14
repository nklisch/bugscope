# Design: Phase 7 — Ecosystem & Polish

## Overview

Phase 7 transforms krometrail from a working tool into a production-ready ecosystem. It covers six areas:

1. **Adapter SDK** — Scaffold, test harness, and docs for third-party adapter contributions
2. **Additional Language Adapters** — Rust (CodeLLDB), Java (java-debug-adapter), C/C++ (GDB DAP)
3. **Performance Benchmarking** — Measure tokens/session, actions-to-diagnosis, per-tool latency, comparison with competitors
4. **Agent Integration Testing** — Real Claude Code + MCP discovery tests against the discount-bug fixture
5. **Documentation & Guides** — Integration guides for Claude Code, Codex, Cursor/Windsurf; troubleshooting guide
6. **launch.json Compatibility** — Import VS Code launch configurations

**Dependencies:** Phases 1–6 must be complete. All three adapters (Python, Node.js, Go) are stable, framework detection works, and the CLI/MCP interfaces are finalized.

**Key constraints:**
- New adapters (Rust, Java, C/C++) follow the existing `DebugAdapter` interface exactly — no interface changes
- The adapter SDK is a documentation + template effort, not a separate npm package
- Performance benchmarks produce reproducible numbers via scripted test scenarios
- launch.json parsing is best-effort — only fields that map to `LaunchOptions`/`AttachOptions` are consumed

---

## Implementation Units

### Unit 1: Adapter Test Harness

**File**: `tests/harness/adapter-conformance.ts`

The conformance harness is a reusable test suite that any adapter can run to verify it meets the `DebugAdapter` contract. It provides fixture programs and expected behaviors for a standard "simple loop with function calls" scenario.

```typescript
import type { DebugAdapter } from "../../src/adapters/base.js";
import type { SessionManager } from "../../src/core/session-manager.js";

/**
 * Fixture definition for adapter conformance testing.
 * Each adapter provides a fixture program that:
 * - Has a loop (lines known ahead of time)
 * - Has a function call at a known line
 * - Has inspectable local variables (x: number, name: string, items: array)
 */
export interface ConformanceFixture {
	/** Path to the fixture source file */
	filePath: string;
	/** The command to launch it (e.g., "python3 fixture.py") */
	command: string;
	/** Language id matching the adapter's id */
	language: string;
	/** Line number where a breakpoint can be set inside the loop body */
	loopBodyLine: number;
	/** Line number of a function call that can be stepped into */
	functionCallLine: number;
	/** Line number inside the called function */
	insideFunctionLine: number;
	/** Expected variable names visible at loopBodyLine (subset check) */
	expectedLocals: string[];
	/** An expression that evaluates to a known value at loopBodyLine */
	evalExpression: string;
	/** The expected result substring from evaluating evalExpression */
	evalExpectedSubstring: string;
}

/**
 * Run the full adapter conformance suite against a fixture.
 * Call this from your adapter's integration test file.
 *
 * Tests:
 * 1. checkPrerequisites() returns satisfied: true
 * 2. Launch → breakpoint hit → viewport contains expected location
 * 3. Step over → line advances
 * 4. Step into function → enters function body
 * 5. Step out → returns to caller
 * 6. Evaluate expression → returns expected value
 * 7. Variables → contains expected locals
 * 8. Conditional breakpoint → only stops when condition is true
 * 9. Stop → session terminates cleanly, adapter.dispose() succeeds
 * 10. Error case: breakpoint on non-existent file → clear error
 */
export function runConformanceSuite(
	adapter: DebugAdapter,
	fixture: ConformanceFixture,
	createSessionManager: () => SessionManager,
): void;
```

**Implementation Notes:**
- Uses `describe`/`it` from vitest internally — the caller just calls `runConformanceSuite(adapter, fixture, factory)` inside their test file
- Each test creates a fresh `SessionManager` (via the factory) and a fresh session
- Tests are ordered with dependencies: launch must succeed before step tests run
- Timeout per test: 30s (debugger launches can be slow)
- If `adapter.checkPrerequisites()` returns `satisfied: false`, all tests are skipped with a clear message

**Acceptance Criteria:**
- [ ] Existing Python, Node.js, and Go adapters pass the conformance suite
- [ ] Running the suite against a broken adapter (e.g., one that returns wrong stream types) produces clear failure messages
- [ ] Each test is independent — failure of one doesn't block others (except prerequisite check)

---

### Unit 2: Conformance Fixtures for Existing Adapters

**Files**:
- `tests/fixtures/python/conformance.py`
- `tests/fixtures/node/conformance.js`
- `tests/fixtures/go/conformance.go`

Each fixture follows the same logical structure:

```python
# tests/fixtures/python/conformance.py
# Adapter conformance fixture — DO NOT MODIFY without updating conformance test
def greet(name):
    message = f"Hello, {name}!"  # line 4 — insideFunctionLine
    return message

def main():
    items = ["alpha", "beta", "gamma"]
    total = 0
    for i, item in enumerate(items):
        total += len(item)        # line 11 — loopBodyLine
        greet(item)               # line 12 — functionCallLine
    print(f"Total chars: {total}")

if __name__ == "__main__":
    main()
```

```javascript
// tests/fixtures/node/conformance.js
// Adapter conformance fixture — DO NOT MODIFY without updating conformance test
function greet(name) {
  const message = `Hello, ${name}!`;  // line 4 — insideFunctionLine
  return message;
}

function main() {
  const items = ["alpha", "beta", "gamma"];
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].length;   // line 12 — loopBodyLine
    greet(items[i]);            // line 13 — functionCallLine
  }
  console.log(`Total chars: ${total}`);
}

main();
```

```go
// tests/fixtures/go/conformance.go
// Adapter conformance fixture — DO NOT MODIFY without updating conformance test
package main

import "fmt"

func greet(name string) string {
	message := fmt.Sprintf("Hello, %s!", name) // line 8 — insideFunctionLine
	return message
}

func main() {
	items := []string{"alpha", "beta", "gamma"}
	total := 0
	for i, item := range items {
		total += len(item)    // line 15 — loopBodyLine
		greet(item)           // line 16 — functionCallLine
		_ = i
	}
	fmt.Printf("Total chars: %d\n", total)
}
```

**Acceptance Criteria:**
- [ ] Each fixture runs without errors standalone (`python3 conformance.py`, `node conformance.js`, `go run conformance.go`)
- [ ] Line numbers in `ConformanceFixture` definitions match actual file content

---

### Unit 3: Adapter Conformance Integration Tests

**Files**:
- `tests/integration/adapters/conformance-python.test.ts`
- `tests/integration/adapters/conformance-node.test.ts`
- `tests/integration/adapters/conformance-go.test.ts`

```typescript
// tests/integration/adapters/conformance-python.test.ts
import { resolve } from "node:path";
import { describe } from "vitest";
import { PythonAdapter } from "../../../src/adapters/python.js";
import { createSessionManager } from "../../../src/core/session-manager.js";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import type { ConformanceFixture } from "../../harness/adapter-conformance.js";
import { runConformanceSuite } from "../../harness/adapter-conformance.js";

const FIXTURE_PATH = resolve(import.meta.dirname, "../../fixtures/python/conformance.py");

const fixture: ConformanceFixture = {
	filePath: FIXTURE_PATH,
	command: `python3 ${FIXTURE_PATH}`,
	language: "python",
	loopBodyLine: 11,
	functionCallLine: 12,
	insideFunctionLine: 4,
	expectedLocals: ["items", "total", "i", "item"],
	evalExpression: "len(items)",
	evalExpectedSubstring: "3",
};

describe.skipIf(SKIP_NO_DEBUGPY)("Python adapter conformance", () => {
	runConformanceSuite(new PythonAdapter(), fixture, createSessionManager);
});
```

Node.js and Go follow the same pattern with their respective adapters, fixtures, and skip checks.

**Acceptance Criteria:**
- [ ] All three conformance suites pass (when debugger is installed)
- [ ] Each suite skips cleanly when debugger is not installed

---

### Unit 4: Adapter SDK Documentation

**File**: `docs/ADAPTER-SDK.md`

Step-by-step guide for creating a new adapter. This is the primary deliverable for community contributions.

Structure:

```markdown
# Creating an Krometrail Adapter

## Overview
How adapters fit into the architecture, what they're responsible for, and what they're not.

## The DebugAdapter Interface
Full interface with JSDoc from src/adapters/base.ts, annotated with implementation guidance.

## Step-by-Step Guide

### Step 1: Identify the DAP Debugger
- What DAP-compatible debugger exists for your language
- How it's launched (subprocess vs. connect to existing)
- Which DAP capabilities it supports

### Step 2: Create the Adapter File
- File location: src/adapters/{language}.ts
- Import base types
- Implement DebugAdapter interface
- Use shared helpers from helpers.ts (allocatePort, spawnAndWait, connectTCP, gracefulDispose)

### Step 3: Implement checkPrerequisites()
- Spawn the debugger's version command
- Return satisfied/missing/installHint

### Step 4: Implement launch()
- Allocate port (allocatePort())
- Parse command string to extract script/args
- Spawn debugger process (spawnAndWait() or direct spawn())
- Connect TCP to the debugger's DAP port (connectTCP())
- Set launchArgs for any adapter-specific DAP launch request fields
- Return DAPConnection with reader/writer/process/launchArgs

### Step 5: Implement attach()
- Connect to an existing debug server by host:port
- Return DAPConnection

### Step 6: Implement dispose()
- Use gracefulDispose(socket, process)

### Step 7: Register the Adapter
- Add to registry.ts registerAllAdapters()
- Register in mcp/index.ts, daemon/entry.ts, cli/commands/doctor.ts

### Step 8: Create Conformance Fixture
- Create tests/fixtures/{language}/conformance.{ext}
- Follow the standard fixture structure
- Define ConformanceFixture with correct line numbers

### Step 9: Run Conformance Tests
- Create tests/integration/adapters/conformance-{language}.test.ts
- Call runConformanceSuite()
- Create skip check helper in tests/helpers/{language}-check.ts

### Step 10: Add Doctor Version Check
- Add get{Language}Version() to src/cli/commands/doctor.ts

## Reference: Existing Adapters
- Python adapter walkthrough (simplest — direct TCP)
- Node.js adapter walkthrough (needs adapter download/caching)
- Go adapter walkthrough (needs build step, goroutine awareness)

## Common Patterns
- The _dapFlow: "launch-first" pattern (debugpy) vs standard initialize-first flow
- Handling stderr parsing for readiness detection
- Environment variable forwarding
- Source map considerations

## FAQ
- What if the debugger doesn't support conditional breakpoints?
- What if the debugger uses a non-TCP transport (stdin/stdout)?
- How do I handle debugger-specific launch.json fields?
```

**Acceptance Criteria:**
- [ ] Following the guide produces a working adapter for a new language (validated by implementing one of the Phase 7 adapters using only the guide)
- [ ] All code examples compile and reference correct imports
- [ ] The guide references actual file paths in the codebase

---

### Unit 5: Rust Adapter (CodeLLDB)

**File**: `src/adapters/rust.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import { LaunchError } from "../core/errors.js";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";

/**
 * Path where CodeLLDB adapter is cached.
 * Downloaded on first use via downloadCodeLLDB().
 */
export function getCodeLLDBCachePath(): string;

/**
 * Download and cache the CodeLLDB VS Code extension's DAP adapter binary.
 * Extracts the platform-appropriate binary from the VSIX archive.
 * Returns the path to the adapter executable.
 */
export async function downloadAndCacheCodeLLDB(): Promise<string>;

/**
 * Check if CodeLLDB is already cached at the expected path.
 */
export function isCodeLLDBCached(): Promise<boolean>;

export class RustAdapter implements DebugAdapter {
	id = "rust";
	fileExtensions = [".rs"];
	displayName = "Rust (CodeLLDB)";

	private process: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for cargo and CodeLLDB availability.
	 * If CodeLLDB is not cached, reports it as missing with download hint.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult>;

	/**
	 * Launch a Rust program via CodeLLDB DAP server.
	 *
	 * Flow:
	 * 1. Ensure CodeLLDB is downloaded/cached
	 * 2. Build the target: `cargo build` (or use pre-built binary)
	 * 3. Allocate port
	 * 4. Spawn: `codelldb --port {port}`
	 * 5. Wait for "Listening on port" on stderr
	 * 6. Connect TCP
	 * 7. Set launchArgs: { type: "lldb", program: "{target_binary}", cwd }
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection>;

	/**
	 * Attach to a running process via CodeLLDB.
	 * launchArgs: { type: "lldb", pid: config.pid }
	 */
	async attach(config: AttachConfig): Promise<DAPConnection>;

	async dispose(): Promise<void>;
}
```

**Implementation Notes:**
- CodeLLDB is downloaded as a VSIX (zip) from GitHub releases, extracted to `~/.krometrail/adapters/codelldb/`
- Follow the same caching pattern as `src/adapters/js-debug-adapter.ts` (check cache → download if missing → extract)
- The VSIX contains platform-specific binaries under `extension/adapter/` — detect platform and extract the right one
- `cargo build` must run before launching the debugger to produce the target binary
- Parse `Cargo.toml` or `cargo metadata` to find the target binary path, or accept it as part of the command (e.g., `cargo test -- test_name` or `./target/debug/myapp`)
- For `cargo test`, the test binary path is output by `cargo test --no-run --message-format=json`

**Acceptance Criteria:**
- [ ] `checkPrerequisites()` returns `satisfied: true` when cargo and CodeLLDB are available
- [ ] `launch()` with a simple Rust program hits a breakpoint and returns a viewport
- [ ] `dispose()` kills CodeLLDB and the debuggee
- [ ] Conformance suite passes
- [ ] `attach()` connects to a running process by PID

---

### Unit 6: Java Adapter (java-debug-adapter)

**File**: `src/adapters/java.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose, spawnAndWait } from "./helpers.js";

/**
 * Path where java-debug-adapter JAR is cached.
 */
export function getJavaDebugAdapterCachePath(): string;

/**
 * Download and cache the java-debug-adapter fat JAR from Maven Central
 * or GitHub releases. Returns the path to the JAR.
 */
export async function downloadAndCacheJavaDebugAdapter(): Promise<string>;

export class JavaAdapter implements DebugAdapter {
	id = "java";
	fileExtensions = [".java"];
	displayName = "Java (java-debug-adapter)";

	private process: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for JDK (javac) and java-debug-adapter JAR.
	 * JDK 17+ required.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult>;

	/**
	 * Launch a Java program via java-debug-adapter.
	 *
	 * Flow:
	 * 1. Ensure java-debug-adapter JAR is cached
	 * 2. Allocate port
	 * 3. Spawn: java -jar {jarPath} --port {port}
	 * 4. Wait for readiness output on stderr
	 * 5. Connect TCP
	 * 6. Set launchArgs:
	 *    - For "java Main.java": { mainClass, classPaths: ["."] }
	 *    - For "java -jar app.jar": { mainClass: "", classPaths: ["app.jar"] }
	 *    - For "mvn exec:java": detect mainClass from pom.xml
	 *    - For "gradle run": detect mainClass from build.gradle
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection>;

	/**
	 * Attach to a JVM with JDWP agent enabled.
	 * Expects the JVM was started with:
	 *   -agentlib:jdwp=transport=dt_socket,server=y,address={port}
	 */
	async attach(config: AttachConfig): Promise<DAPConnection>;

	async dispose(): Promise<void>;
}
```

**Implementation Notes:**
- java-debug-adapter is a standalone JAR from Microsoft's [java-debug](https://github.com/microsoft/java-debug) project
- Cache at `~/.krometrail/adapters/java-debug/java-debug-adapter.jar`
- Command parsing needs to handle: `java Main`, `java -jar app.jar`, `mvn test`, `gradle test`
- For Maven/Gradle, the adapter needs to configure `classPaths` correctly — this is the tricky part
- Start simple: support `java -jar` and `java MainClass` first, Maven/Gradle in a follow-up or documented as manual config
- JDK version check: parse `javac -version` output, require 17+

**Acceptance Criteria:**
- [ ] `checkPrerequisites()` detects JDK presence and version
- [ ] `launch()` with a simple Java program hits a breakpoint
- [ ] Conformance suite passes for basic Java programs
- [ ] `attach()` connects to a JVM with JDWP enabled

---

### Unit 7: C/C++ Adapter (GDB DAP)

**File**: `src/adapters/cpp.ts`

```typescript
import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { AttachConfig, DAPConnection, DebugAdapter, LaunchConfig, PrerequisiteResult } from "./base.js";
import { allocatePort, connectTCP, gracefulDispose } from "./helpers.js";

export class CppAdapter implements DebugAdapter {
	id = "cpp";
	fileExtensions = [".c", ".cpp", ".cc", ".cxx", ".h", ".hpp"];
	displayName = "C/C++ (GDB)";

	private process: ChildProcess | null = null;
	private socket: Socket | null = null;

	/**
	 * Check for GDB 14+ (which supports --interpreter=dap).
	 * Falls back to checking LLDB DAP if GDB is not available.
	 */
	async checkPrerequisites(): Promise<PrerequisiteResult>;

	/**
	 * Launch a C/C++ program via GDB's built-in DAP mode.
	 *
	 * Flow:
	 * 1. If command is a source file (.c/.cpp), compile first:
	 *    `gcc -g -o /tmp/krometrail-{hash} source.c` or
	 *    `g++ -g -o /tmp/krometrail-{hash} source.cpp`
	 * 2. If command is a build system (`make`, `cmake --build`),
	 *    run build first and find the binary
	 * 3. Allocate port
	 * 4. Spawn: `gdb --interpreter=dap` (uses stdin/stdout, not TCP)
	 *    OR for TCP mode: spawn GDB and connect via MI
	 * 5. Since GDB DAP uses stdin/stdout (not TCP), return
	 *    process.stdout as reader and process.stdin as writer directly
	 * 6. Set launchArgs: { program: "{binary_path}", cwd }
	 */
	async launch(config: LaunchConfig): Promise<DAPConnection>;

	/**
	 * Attach GDB to a running process.
	 * launchArgs: { program: "{binary}", pid: config.pid }
	 */
	async attach(config: AttachConfig): Promise<DAPConnection>;

	async dispose(): Promise<void>;
}
```

**Implementation Notes:**
- GDB 14+ added native DAP support via `--interpreter=dap`, which communicates over stdin/stdout (not TCP)
- This is the simplest adapter since no download/cache is needed — GDB is system-installed
- The DAPConnection uses `process.stdout` as reader and `process.stdin` as writer (no TCP socket)
- For the compilation step: detect `.c` vs `.cpp` and use `gcc -g` vs `g++ -g` respectively
- The `-g` flag is essential for debug symbols
- If the user passes a pre-built binary, skip compilation
- LLDB DAP is an alternative: `lldb-dap` (formerly `lldb-vscode`) also uses stdin/stdout
- Check GDB version: parse `gdb --version` output, look for version >= 14

**Acceptance Criteria:**
- [ ] `checkPrerequisites()` detects GDB 14+ or LLDB DAP availability
- [ ] `launch()` with a simple C program (source file) compiles and hits a breakpoint
- [ ] `launch()` with a pre-built binary hits a breakpoint
- [ ] Conformance suite passes
- [ ] `attach()` connects to a running process by PID

---

### Unit 8: Adapter Registration Updates

**File**: `src/adapters/registry.ts` (modify)

```typescript
// Add imports for new adapters
import { CppAdapter } from "./cpp.js";
import { JavaAdapter } from "./java.js";
import { RustAdapter } from "./rust.js";

export function registerAllAdapters(): void {
	registerAdapter(new PythonAdapter());
	registerAdapter(new NodeAdapter());
	registerAdapter(new GoAdapter());
	registerAdapter(new RustAdapter());
	registerAdapter(new JavaAdapter());
	registerAdapter(new CppAdapter());
}
```

**Also update:**
- `src/mcp/index.ts` — no change needed (uses `registerAllAdapters()`)
- `src/daemon/entry.ts` — no change needed (uses `registerAllAdapters()`)
- `src/cli/commands/doctor.ts` — add version check functions for Rust (cargo), Java (javac), C/C++ (gcc/gdb):

```typescript
async function getCargoVersion(): Promise<string | undefined>;
async function getJavacVersion(): Promise<string | undefined>;
async function getGdbVersion(): Promise<string | undefined>;
```

Add to the version detection switch:
```typescript
if (adapter.id === "rust") {
	version = await getCargoVersion();
} else if (adapter.id === "java") {
	version = await getJavacVersion();
} else if (adapter.id === "cpp") {
	version = await getGdbVersion();
}
```

**Acceptance Criteria:**
- [ ] `krometrail doctor` lists all 6 adapters with correct status
- [ ] New adapters show version when available, install hint when missing
- [ ] `registerAllAdapters()` registers all 6 adapters in the registry

---

### Unit 9: Performance Benchmark Suite

**File**: `benchmarks/run.ts`

A scripted benchmark runner that measures key performance metrics using real debug sessions.

```typescript
/**
 * Benchmark scenario definition.
 * Each scenario is a scripted debug session with known steps.
 */
interface BenchmarkScenario {
	/** Scenario name */
	name: string;
	/** Language adapter to use */
	language: string;
	/** Command to launch */
	command: string;
	/** Fixture file path */
	fixture: string;
	/** Scripted actions to perform */
	actions: BenchmarkAction[];
}

type BenchmarkAction =
	| { type: "launch"; breakpoints: Array<{ file: string; line: number }> }
	| { type: "continue" }
	| { type: "step"; direction: "over" | "into" | "out"; count?: number }
	| { type: "evaluate"; expression: string }
	| { type: "variables" }
	| { type: "stop" };

/**
 * Results from a benchmark run.
 */
interface BenchmarkResult {
	scenario: string;
	language: string;
	/** Total viewport tokens consumed (estimated chars/4) */
	totalViewportTokens: number;
	/** Number of viewports returned */
	viewportCount: number;
	/** Average tokens per viewport */
	avgTokensPerViewport: number;
	/** Total actions taken */
	actionCount: number;
	/** Per-action latency in ms */
	actionLatencies: Array<{ action: string; latencyMs: number }>;
	/** Average action latency */
	avgLatencyMs: number;
	/** Total session wall-clock time in ms */
	totalTimeMs: number;
	/** Whether the scenario completed successfully */
	success: boolean;
	/** Error message if failed */
	error?: string;
}

/**
 * Run all benchmark scenarios and output results.
 */
async function runBenchmarks(): Promise<BenchmarkResult[]>;

/**
 * Format benchmark results as a comparison table.
 */
function formatBenchmarkTable(results: BenchmarkResult[]): string;
```

**Benchmark Scenarios:**

1. **discount-bug-10-actions** — The canonical discount bug (Python). 10 actions: launch, continue, step into, evaluate x3, step out, continue, evaluate, stop. Measures typical investigation.

2. **simple-loop-50-steps** — Step through a 50-iteration loop (Python). Measures compression tier transitions and viewport token growth over long sessions.

3. **cross-language-baseline** — Same simple-loop fixture in Python, Node.js, and Go. 5 actions each. Measures cross-adapter consistency and latency differences.

4. **deep-stack-inspection** — Program with 10+ frame call stack. Measure viewport token count with deep stacks.

**Implementation Notes:**
- Uses `SessionManager` directly (not MCP) to minimize measurement overhead
- Token estimation: `Math.ceil(viewportText.length / 4)` (same as `estimateTokens()` in compression.ts)
- Latency measured via `performance.now()` around each action
- Results written to `benchmarks/results.json` and a human-readable table to stdout
- Run via `bun run benchmarks/run.ts`

**Acceptance Criteria:**
- [ ] All scenarios complete without errors (when adapters are available)
- [ ] Results include tokens/viewport, action latency, and total session metrics
- [ ] A 10-action discount-bug session consumes < 5000 viewport tokens
- [ ] Results are reproducible (variance < 20% across runs)

---

### Unit 10: Benchmark Fixtures

**Files**:
- `benchmarks/fixtures/deep-stack.py` — 10+ frame call stack
- `benchmarks/fixtures/long-loop.py` — 50-iteration loop with changing variables

```python
# benchmarks/fixtures/deep-stack.py
def level_10(x):
    result = x * 2      # breakpoint target
    return result

def level_9(x):
    return level_10(x + 1)

def level_8(x):
    return level_9(x + 1)

# ... levels 7 through 1 ...

def level_1(x):
    return level_2(x + 1)

def main():
    result = level_1(0)
    print(f"Result: {result}")

if __name__ == "__main__":
    main()
```

```python
# benchmarks/fixtures/long-loop.py
def process_item(index, value):
    transformed = value.upper()
    length = len(transformed)
    return f"{index}: {transformed} ({length})"

def main():
    items = [f"item_{i}" for i in range(50)]
    results = []
    for i, item in enumerate(items):
        result = process_item(i, item)  # step target
        results.append(result)
    print(f"Processed {len(results)} items")

if __name__ == "__main__":
    main()
```

**Acceptance Criteria:**
- [ ] Each fixture runs standalone without errors
- [ ] deep-stack.py has at least 10 call frames when breakpoint is hit

---

### Unit 11: Agent Integration Test — MCP Discovery

**File**: `tests/e2e/agent-integration/mcp-discovery.test.ts`

Test that an MCP client can discover and use krometrail tools without any skill file — the tool descriptions alone are sufficient.

```typescript
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";
import { callTool, createTestClient } from "../../helpers/mcp-test-client.js";

describe.skipIf(SKIP_NO_DEBUGPY)("Agent integration: MCP discovery", () => {
	let client: Client;
	let cleanup: () => Promise<void>;

	beforeAll(async () => {
		({ client, cleanup } = await createTestClient());
	});

	afterAll(async () => {
		await cleanup();
	});

	it("lists all expected tools with descriptions", async () => {
		const result = await client.listTools();
		const toolNames = result.tools.map((t) => t.name);

		// All 18 tools should be present
		expect(toolNames).toContain("debug_launch");
		expect(toolNames).toContain("debug_stop");
		expect(toolNames).toContain("debug_continue");
		expect(toolNames).toContain("debug_step");
		expect(toolNames).toContain("debug_evaluate");
		expect(toolNames).toContain("debug_variables");
		expect(toolNames).toContain("debug_set_breakpoints");
		expect(toolNames).toContain("debug_session_log");

		// Each tool has a non-empty description
		for (const tool of result.tools) {
			expect(tool.description).toBeTruthy();
			expect(tool.description!.length).toBeGreaterThan(20);
		}
	});

	it("tool descriptions contain agent guidance", async () => {
		const result = await client.listTools();
		const tools = Object.fromEntries(result.tools.map((t) => [t.name, t]));

		// debug_launch should mention breakpoints and stop_on_entry
		expect(tools.debug_launch.description).toMatch(/breakpoint/i);

		// debug_set_breakpoints should warn about non-executable lines
		expect(tools.debug_set_breakpoints.description).toMatch(/non-executable|structural|declarative/i);

		// debug_step should explain over/into/out
		expect(tools.debug_step.description).toMatch(/over.*into.*out|step over|step into/i);
	});

	it("full debug session works via tool calls alone", async () => {
		const fixture = resolve(import.meta.dirname, "../../../tests/fixtures/python/discount-bug.py");

		// Launch
		const launchResult = await callTool(client, "debug_launch", {
			command: `python3 ${fixture}`,
			breakpoints: [{ file: fixture, breakpoints: [{ line: 13 }] }],
		});
		const sessionId = launchResult.match(/Session: ([a-f0-9]{8})/)?.[1];
		expect(sessionId).toBeTruthy();

		try {
			// Continue to breakpoint
			const viewport = await callTool(client, "debug_continue", {
				session_id: sessionId,
				timeout_ms: 10_000,
			});
			expect(viewport).toContain("STOPPED");
			expect(viewport).toContain("Locals:");

			// Evaluate
			const evalResult = await callTool(client, "debug_evaluate", {
				session_id: sessionId,
				expression: "tier_multipliers",
			});
			expect(evalResult).toContain("gold");

			// Session log
			const log = await callTool(client, "debug_session_log", {
				session_id: sessionId,
			});
			expect(log).toContain("action");

			// Status with token stats
			const status = await callTool(client, "debug_status", {
				session_id: sessionId,
			});
			expect(status).toContain("stopped");
		} finally {
			await callTool(client, "debug_stop", { session_id: sessionId });
		}
	});
});
```

**Acceptance Criteria:**
- [ ] Tool listing returns all 18 tools with non-empty descriptions
- [ ] Tool descriptions contain agent guidance (breakpoint warnings, strategy hints)
- [ ] Full discount-bug scenario completes in < 10 actions using only discovered tools
- [ ] Total viewport tokens for the session are < 5000

---

### Unit 12: launch.json Parser

**File**: `src/core/launch-json.ts`

```typescript
import { z } from "zod/v4";
import type { LaunchOptions, AttachOptions } from "./session-manager.js";

/**
 * A single launch configuration from .vscode/launch.json.
 */
export interface LaunchJsonConfig {
	name: string;
	type: string;
	request: "launch" | "attach";
	program?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	port?: number;
	host?: string;
	/** Python-specific */
	module?: string;
	/** Python-specific */
	justMyCode?: boolean;
	/** Go-specific */
	mode?: string;
	/** Node-specific */
	runtimeExecutable?: string;
	/** Node-specific */
	runtimeArgs?: string[];
	/** All other fields preserved as-is */
	[key: string]: unknown;
}

/**
 * Parsed launch.json file.
 */
export interface LaunchJsonFile {
	version: string;
	configurations: LaunchJsonConfig[];
}

/** Zod schema for parsing launch.json */
export const LaunchJsonConfigSchema: z.ZodType<LaunchJsonConfig>;

/**
 * Read and parse a .vscode/launch.json file.
 * Handles JSONC (comments and trailing commas) since VS Code allows them.
 * Returns null if the file doesn't exist.
 */
export async function parseLaunchJson(filePath: string): Promise<LaunchJsonFile | null>;

/**
 * List available configuration names from a launch.json.
 */
export function listConfigurations(launchJson: LaunchJsonFile): Array<{ name: string; type: string; request: string }>;

/**
 * Convert a launch.json configuration to LaunchOptions or AttachOptions.
 *
 * Mapping:
 * - type → language (debugpy/python → "python", node/node2 → "node", go → "go",
 *   lldb/cppdbg → "cpp", java → "java")
 * - request: "launch" → LaunchOptions, "attach" → AttachOptions
 * - program → command (with runtime prefix if needed)
 * - module → command: "python -m {module}"
 * - args → appended to command
 * - cwd → cwd
 * - env → env
 * - port/host → AttachOptions.port/host
 *
 * Unsupported fields are silently ignored (best-effort).
 */
export function configToOptions(config: LaunchJsonConfig): { type: "launch"; options: LaunchOptions } | { type: "attach"; options: AttachOptions };

/**
 * Strip JSONC features (// comments, /* comments */, trailing commas)
 * to produce valid JSON. VS Code's launch.json commonly uses these.
 */
export function stripJsonc(input: string): string;
```

**Implementation Notes:**
- JSONC stripping: remove `//` line comments, `/* */` block comments, and trailing commas before `]` or `}`
- Type mapping is a lookup table — unknown types produce a clear error message listing supported types
- For `program` field: if it contains `${workspaceFolder}`, replace with `cwd` or process.cwd()
- VS Code variable substitution (`${env:VAR}`, `${file}`, etc.) is NOT supported — document this limitation
- The parser is lenient: unknown fields are preserved but not used, missing required fields produce clear errors

**Acceptance Criteria:**
- [ ] Parses a standard Python debugpy launch.json config into LaunchOptions
- [ ] Parses a Node.js launch.json config into LaunchOptions
- [ ] Parses a Go Delve launch.json config into LaunchOptions
- [ ] Handles JSONC (comments, trailing commas)
- [ ] Handles attach configurations
- [ ] Returns clear error for unsupported configuration types
- [ ] Replaces `${workspaceFolder}` with cwd

---

### Unit 13: launch.json CLI Integration

**Files**:
- `src/cli/commands/launch.ts` (modify — add `--config` and `--config-name` flags)
- `src/mcp/tools/index.ts` (modify — add optional `launch_config` parameter to `debug_launch`)

**CLI additions:**

```typescript
// In launch command args:
{
	config: {
		type: "string",
		description: "Path to launch.json file (default: .vscode/launch.json)",
	},
	"config-name": {
		type: "string",
		description: "Name of the configuration to use from launch.json",
		alias: "C",
	},
}
```

When `--config` is provided (or `--config-name` without `--config`):
1. Parse the launch.json file (default path: `.vscode/launch.json`)
2. If `--config-name` specified, find that configuration by name
3. If no `--config-name` and only one configuration, use it
4. If no `--config-name` and multiple configurations, list them and exit with error
5. Convert to `LaunchOptions`/`AttachOptions` via `configToOptions()`
6. Merge with any CLI flags (CLI flags take precedence)
7. Call `sessionManager.launch()` or `sessionManager.attach()`

**MCP additions:**

```typescript
// Add to debug_launch tool input schema:
{
	launch_config: z.object({
		path: z.string().optional().describe("Path to launch.json file"),
		name: z.string().optional().describe("Configuration name to use"),
	}).optional().describe("Use a VS Code launch.json configuration"),
}
```

**Doctor enhancement:**

```typescript
// In doctor command, after adapter checks:
// Check for .vscode/launch.json in cwd
const launchJson = await parseLaunchJson(resolve(process.cwd(), ".vscode/launch.json"));
if (launchJson) {
	const configs = listConfigurations(launchJson);
	// Print available configurations
}
```

**Acceptance Criteria:**
- [ ] `krometrail launch --config .vscode/launch.json --config-name "Python: Current File"` works
- [ ] `krometrail launch --config-name "Python: Current File"` uses default path
- [ ] CLI flags override launch.json values
- [ ] `krometrail doctor` reports available launch.json configurations
- [ ] MCP `debug_launch` with `launch_config` parameter works
- [ ] Error message lists available configurations when name doesn't match

---

### Unit 14: Integration Guide — Claude Code (MCP)

**File**: `docs/guides/claude-code.md`

```markdown
# Using Krometrail with Claude Code

## Setup: MCP Server

Add to your Claude Code MCP config (~/.claude/mcp.json or project .mcp.json):

```json
{
  "mcpServers": {
    "krometrail": {
      "command": "npx",
      "args": ["krometrail", "mcp"]
    }
  }
}
```

Or with a compiled binary:
```json
{
  "mcpServers": {
    "krometrail": {
      "command": "/path/to/krometrail",
      "args": ["mcp"]
    }
  }
}
```

## Setup: CLI with Skill File

Alternative: use the CLI path. Add to your project's CLAUDE.md:

```markdown
## Debugging

You have access to `krometrail` for runtime debugging.
See: node_modules/krometrail/skill.md
```

Or print the skill: `krometrail skill >> CLAUDE.md`

## Verification

1. Start Claude Code
2. Ask: "What debug tools do you have available?"
3. Claude should list the krometrail debug_* tools (MCP) or know about the CLI commands (skill)

## Example Workflow

Ask Claude Code:
> The test_gold_discount test is failing with an assertion error.
> Use the debugger to find the root cause.

Claude Code will:
1. Set a breakpoint at the failing assertion
2. Launch the test under the debugger
3. Inspect variables to find the bad value
4. Trace back to the source of the incorrect value
5. Report the root cause

## Tips

- MCP path is zero-config — Claude discovers tools automatically
- CLI path gives Claude bash access to the full command set
- For best results, let Claude choose where to set breakpoints
- Claude can use conditional breakpoints to efficiently debug loops
- The viewport is compact (~400 tokens) so Claude can take many debug steps
```

**Acceptance Criteria:**
- [ ] MCP setup instructions work with both npx and binary
- [ ] Skill file setup instructions work
- [ ] Example workflow is accurate and reproducible

---

### Unit 15: Integration Guide — Codex

**File**: `docs/guides/codex.md`

Structure:
- System prompt setup (include skill.md content)
- CLI installation (npx or binary)
- Example workflow showing Codex using CLI commands
- Tips for Codex-specific behavior (parallel tool use, context management)

**Acceptance Criteria:**
- [ ] Setup instructions are correct for Codex's system prompt model
- [ ] Example workflow uses CLI commands correctly

---

### Unit 16: Integration Guide — Cursor/Windsurf

**File**: `docs/guides/cursor-windsurf.md`

Structure:
- MCP server configuration for Cursor
- MCP server configuration for Windsurf
- Verification steps
- Known limitations (if any MCP features are unsupported)

**Acceptance Criteria:**
- [ ] MCP config format matches Cursor/Windsurf documentation
- [ ] Verification steps work

---

### Unit 17: Troubleshooting Guide

**File**: `docs/guides/troubleshooting.md`

Structure:

```markdown
# Troubleshooting Krometrail

## Debugger Not Found
### Python: debugpy not installed
### Node.js: js-debug adapter download failed
### Go: dlv not found
### Rust: CodeLLDB download failed
### Java: JDK not found or version < 17
### C/C++: GDB version < 14

## Connection Issues
### Port conflicts
### Timeout on launch
### Debugger process crashed

## Breakpoint Issues
### Breakpoint not hit (wrong file path)
### Breakpoint set on non-executable line
### Conditional breakpoint syntax errors per language

## Session Issues
### Session timeout (5 min default) — how to increase
### Action limit reached — how to increase
### Multiple sessions — using --session flag

## Framework Detection Issues
### Framework not auto-detected
### Framework detection causes launch failure
### Overriding framework detection with framework: "none"

## Performance Issues
### Slow launch times
### Large viewport output
### Context window exhaustion — use progressive compression

## Common Error Messages
### "Adapter not found for extension .xyz"
### "Session is in 'running' state, expected 'stopped'"
### "Failed to connect to debugger on port XXXX"

## Getting Help
### `krometrail doctor` output
### Daemon logs: ~/.krometrail/daemon.log
### GitHub Issues: https://github.com/...
```

**Acceptance Criteria:**
- [ ] Each section has a concrete solution, not just a description of the problem
- [ ] Error messages match actual error strings from `src/core/errors.ts`
- [ ] `krometrail doctor` is referenced as the first diagnostic step

---

### Unit 18: launch.json Compatibility Tests

**File**: `tests/unit/core/launch-json.test.ts`

```typescript
import { describe, expect, it } from "vitest";
import { configToOptions, listConfigurations, parseLaunchJson, stripJsonc } from "../../../src/core/launch-json.js";

describe("launch-json parser", () => {
	describe("stripJsonc", () => {
		it("removes line comments", () => { /* ... */ });
		it("removes block comments", () => { /* ... */ });
		it("removes trailing commas", () => { /* ... */ });
		it("preserves strings containing // and /*", () => { /* ... */ });
	});

	describe("parseLaunchJson", () => {
		it("parses a valid launch.json file", () => { /* ... */ });
		it("returns null for non-existent file", () => { /* ... */ });
		it("handles JSONC features", () => { /* ... */ });
	});

	describe("listConfigurations", () => {
		it("returns names, types, and request modes", () => { /* ... */ });
	});

	describe("configToOptions", () => {
		it("converts Python debugpy launch config", () => {
			const config = {
				name: "Python: Current File",
				type: "debugpy",
				request: "launch" as const,
				program: "${workspaceFolder}/app.py",
				args: ["--verbose"],
				cwd: "/project",
				env: { DEBUG: "1" },
			};
			const result = configToOptions(config);
			expect(result.type).toBe("launch");
			expect(result.options).toMatchObject({
				command: "python3 /project/app.py --verbose",
				language: "python",
				cwd: "/project",
				env: { DEBUG: "1" },
			});
		});

		it("converts Python module config", () => {
			const config = {
				name: "Python: Module",
				type: "debugpy",
				request: "launch" as const,
				module: "pytest",
				args: ["tests/", "-x"],
				cwd: "/project",
			};
			const result = configToOptions(config);
			expect(result.type).toBe("launch");
			expect(result.options).toMatchObject({
				command: "python3 -m pytest tests/ -x",
				language: "python",
			});
		});

		it("converts Node.js launch config", () => { /* ... */ });
		it("converts Go launch config", () => { /* ... */ });
		it("converts attach config to AttachOptions", () => { /* ... */ });
		it("replaces ${workspaceFolder} with cwd", () => { /* ... */ });
		it("errors on unsupported type", () => { /* ... */ });
	});
});
```

**File**: `tests/fixtures/launch-json/` — Test launch.json files:
- `python-basic.json` — Simple Python debugpy config
- `node-basic.json` — Simple Node.js config
- `multi-config.json` — Multiple configurations
- `with-comments.jsonc` — JSONC with comments and trailing commas

**Acceptance Criteria:**
- [ ] JSONC stripping handles all edge cases
- [ ] All adapter types are correctly mapped to languages
- [ ] ${workspaceFolder} substitution works
- [ ] Unknown types produce helpful error messages
- [ ] Attach configs produce AttachOptions

---

## Implementation Order

1. **Unit 1–3: Adapter conformance harness + fixtures + tests** — Foundation for verifying all adapters including new ones. Run existing adapters through it first.
2. **Unit 4: Adapter SDK documentation** — Write the guide before implementing new adapters, then validate it by following it.
3. **Unit 5: Rust adapter (CodeLLDB)** — First new adapter. Most complex due to VSIX download/caching.
4. **Unit 6: Java adapter** — Second new adapter. JAR download/caching.
5. **Unit 7: C/C++ adapter (GDB DAP)** — Third new adapter. Simplest (no download, stdin/stdout).
6. **Unit 8: Registration updates** — Wire all new adapters into registry and doctor.
7. **Unit 12–13: launch.json parser + CLI/MCP integration** — Independent of adapters, can parallel with 5–8.
8. **Unit 18: launch.json tests** — Validate parser.
9. **Unit 9–10: Performance benchmarks** — Needs stable adapters. Can start after Unit 8.
10. **Unit 11: Agent integration test** — MCP discovery test. Can parallel with benchmarks.
11. **Units 14–17: Documentation** — Write after everything is implemented and tested.

Parallelizable groups:
- Units 5, 6, 7 (new adapters) can be implemented in parallel
- Units 12–13, 18 (launch.json) can parallel with adapter work
- Units 14–17 (docs) can parallel with benchmarks

---

## Testing

### Unit Tests

**`tests/unit/core/launch-json.test.ts`**
- JSONC stripping: comments, trailing commas, string preservation
- Config parsing: valid files, missing files, malformed JSON
- Config listing: names, types, request modes
- Config conversion: Python, Node.js, Go, Rust, Java, C/C++, attach mode
- Variable substitution: ${workspaceFolder}
- Error cases: unsupported type, missing required fields

### Integration Tests

**`tests/integration/adapters/conformance-*.test.ts`** (3 files — Python, Node.js, Go)
- Full conformance suite for each existing adapter
- Each runs 10 test scenarios against real debuggers
- Skips cleanly when debugger not installed

**`tests/integration/adapters/rust.test.ts`** (new)
- Basic launch + breakpoint + viewport
- Cargo build integration
- Skip when cargo/CodeLLDB not available

**`tests/integration/adapters/java.test.ts`** (new)
- Basic launch + breakpoint + viewport
- Java compilation via javac
- Skip when JDK not available

**`tests/integration/adapters/cpp.test.ts`** (new)
- Basic launch + breakpoint + viewport
- Automatic compilation with gcc/g++
- GDB DAP stdin/stdout transport
- Skip when GDB 14+ not available

### E2E Tests

**`tests/e2e/agent-integration/mcp-discovery.test.ts`**
- Tool listing completeness
- Tool description quality (agent guidance)
- Full discount-bug scenario via MCP

### Benchmarks

**`benchmarks/run.ts`** — Not a vitest test; standalone script
- Run via `bun run benchmarks/run.ts`
- Outputs results to `benchmarks/results.json` and stdout table

---

## Verification Checklist

```bash
# 1. All existing tests still pass
bun run test

# 2. Conformance suite passes for existing adapters
bun run test tests/integration/adapters/conformance-python.test.ts
bun run test tests/integration/adapters/conformance-node.test.ts
bun run test tests/integration/adapters/conformance-go.test.ts

# 3. New adapter tests pass (when debuggers installed)
bun run test tests/integration/adapters/rust.test.ts
bun run test tests/integration/adapters/java.test.ts
bun run test tests/integration/adapters/cpp.test.ts

# 4. launch.json parsing tests pass
bun run test tests/unit/core/launch-json.test.ts

# 5. Agent integration tests pass
bun run test tests/e2e/agent-integration/

# 6. Doctor shows all 6 adapters
bun run dev -- doctor

# 7. Benchmarks run successfully
bun run benchmarks/run.ts

# 8. Lint passes
bun run lint

# 9. Build succeeds
bun run build
```
