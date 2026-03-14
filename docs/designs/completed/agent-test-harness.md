# Design: Agent Test Harness

## Problem

Krometrail has three test tiers today: unit, integration, and e2e. All three validate the tool chain from the inside — they call MCP tools directly via a test client and assert on viewport output. None of them answer the real question: **can an actual agent use krometrail to autonomously debug and fix a bug?**

debugger-mcp proved this kind of testing is viable (5 languages x 2 agents, 10/10 pass rate). But their tests only verify the agent can step through the SBCTED sequence — they don't verify the agent can actually *fix* a bug using the debugger. That's the gap.

We need a harness that:
1. Gives an agent buggy code and a failing test
2. Makes krometrail available as an MCP server
3. Lets the agent autonomously investigate and fix the bug
4. Validates the fix against a hidden test the agent never saw

---

## Design Principles

**Scenarios are data, not code.** A scenario is a directory of files plus a config. Adding a new test case means creating a folder, not writing test infrastructure.

**Agent-agnostic.** The harness runs against any agent binary that supports MCP or CLI. Agent-specific details (how to spawn, how to pass MCP config, how to set permissions) are isolated in thin driver modules. Starting with Claude Code as the first agent under test; other drivers (Codex, etc.) will follow once scenarios and reporting are proven.

**Cheap to run, expensive to skip.** These tests cost real money (LLM API calls). They must be opt-in, never in default CI. But skipping them entirely means shipping blind — so the harness should make it trivial to run a quick smoke test (one scenario, one agent) during development.

**The hidden test is the only oracle.** We don't assert on what the agent did, what tools it called, or how many turns it took. We only ask: does the hidden test pass? This keeps the harness robust against changes in agent behavior, model versions, and tool interfaces.

**Observable but not prescriptive.** The harness captures a full trace (agent stdout/stderr, tool calls if available, timing, cost) for debugging and analysis. But none of this is part of the pass/fail gate.

**The prompt is the only evidence.** The visible test passes with the buggy code — the agent cannot use test failures to locate the bug. The prompt is written as a natural-language bug report (customer complaint, engineer observation, support ticket) with concrete expected vs. actual values. This mirrors real production debugging where tests are green but behavior is wrong.

**The skill is installed, not injected.** The krometrail skill is placed at `.claude/skills/krometrail/SKILL.md` in the workspace — exactly how a real user would have it installed. It is not passed via `--append-system-prompt` or any other out-of-band mechanism.

**Every workspace has a `CLAUDE.md`.** Each scenario's `src/` includes a `CLAUDE.md` describing the project structure and test commands. The agent discovers it naturally, the same way it would in a real project.

---

## Scenario Structure

Each scenario is a self-contained directory:

```
tests/agent-harness/scenarios/
  python-float-accumulation/
    scenario.json         # Scenario metadata + config
    prompt.md             # Natural-language bug report given to the agent
    src/                  # Buggy source code (copied into workspace)
      CLAUDE.md           # Project description: files, how to run/test
      bill.py
      test_bill.py        # Visible test — passes with buggy code
    hidden/               # Hidden validation (agent never sees this)
      test_validation.py  # The real oracle test
```

### scenario.json

```json
{
  "scenario": {
    "name": "python-float-accumulation",
    "language": "python",
    "description": "Bill splitting rounds shares independently; their sum can differ from the total by one cent",
    "timeout_seconds": 300
  },
  "setup": { "commands": [] },
  "visible_test": {
    "command": "python3 -m pytest test_bill.py -x -q 2>&1"
  },
  "validation": {
    "command": "python3 -m pytest test_validation.py -x -q 2>&1"
  }
}
```

### src/CLAUDE.md

Project-level context for the agent — what each file does and how to run things. This is the mechanism the agent uses to orient itself, exactly as it would in a real repository.

```markdown
# Bill Splitter

Utility that splits a restaurant bill evenly among diners including tip.

## Files

- `bill.py` — `split_bill(total, num_people, tip_pct)` implementation
- `test_bill.py` — test suite

## Running

```bash
python3 -m pytest test_bill.py -v
```
```

### prompt.md

A natural-language bug report — the only evidence the agent has of what's wrong. Written as a customer complaint, engineer observation, or support ticket. No file names, no test commands, no instructions.

```markdown
Customers are complaining that their bill splits don't add up. When
someone splits a $47.00 bill three ways with an 18% tip, the function
gives everyone $18.49 but then reports the total as $55.46 — which is
$0.01 less than the $55.47 the shares actually sum to. Same problem with
a $53.00 bill split six ways.
```

### Visible test (src/test_bill.py)

Passes with the buggy code. Tests inputs where the rounding happens to be exact, or only checks structural properties. The agent cannot use this to find the bug — it's only here to detect regressions.

```python
def test_even_split_no_tip():
    result = split_bill(30.00, 3, tip_pct=0.0)
    assert result["total_shares"] == 30.00  # exact division, no rounding
    assert result["shares"] == [10.00, 10.00, 10.00]
```

### Hidden test (hidden/test_validation.py)

The real oracle. Only passes when the bug is fixed. Tests the exact inputs from the bug report and any edge cases.

```python
def test_split_sums_to_total_with_tip():
    result = split_bill(47.00, 3)
    assert result["total_shares"] == result["total_with_tip"]

def test_six_person_split():
    result = split_bill(53.00, 6)
    assert result["total_shares"] == result["total_with_tip"]
```

---

## Agent Drivers

An agent driver is a module that knows how to spawn a specific agent with an MCP config. Each driver exports a single interface:

```typescript
interface AgentDriver {
	/** Human-readable name for logs */
	name: string;

	/** Check if the agent binary is available */
	available(): Promise<boolean>;

	/** Spawn the agent with a prompt and MCP config */
	run(options: AgentRunOptions): Promise<AgentRunResult>;
}

interface AgentRunOptions {
	/** Working directory (the temp workspace) */
	workDir: string;
	/** Path to MCP config JSON file */
	mcpConfigPath: string;
	/** The prompt text */
	prompt: string;
	/** Timeout in ms */
	timeoutMs: number;
	/** Max budget in USD (if the agent supports it) */
	maxBudgetUsd?: number;
	/** Environment variables to pass through */
	env?: Record<string, string>;
}

interface AgentRunResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	durationMs: number;
}
```

### Claude Code Driver

```typescript
import { spawn } from "node:child_process";

export const claudeCode: AgentDriver = {
	name: "claude-code",

	async available() {
		try {
			const proc = Bun.spawn(["claude", "--version"], { stdout: "pipe" });
			await proc.exited;
			return proc.exitCode === 0;
		} catch {
			return false;
		}
	},

	async run(options) {
		const start = Date.now();
		const args = [
			"-p", options.prompt,
			"--mcp-config", options.mcpConfigPath,
			"--allowedTools", "mcp__krometrail__*",
			"--max-turns", "50",
			"--permission-mode", "bypassPermissions",
		];

		if (options.maxBudgetUsd) {
			args.push("--max-budget-usd", String(options.maxBudgetUsd));
		}

		const proc = Bun.spawn(["claude", ...args], {
			cwd: options.workDir,
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, ...options.env },
		});

		const timeout = setTimeout(() => proc.kill(), options.timeoutMs);
		const exitCode = await proc.exited;
		clearTimeout(timeout);

		return {
			exitCode,
			stdout: await new Response(proc.stdout).text(),
			stderr: await new Response(proc.stderr).text(),
			timedOut: exitCode === null,
			durationMs: Date.now() - start,
		};
	},
};
```

### Codex Driver (stubbed)

A Codex driver is included for future cross-agent testing. See the source at `drivers/codex.ts`.

New agents are added by creating a new driver module. The harness discovers drivers from a registry — no framework code changes needed.

---

## Harness Core

### MCP Config Generation

The harness generates an MCP config JSON file that points at krometrail, configured to run in the scenario's workspace:

```typescript
function generateMcpConfig(workDir: string): McpConfig {
	return {
		mcpServers: {
			"krometrail": {
				command: "bun",
				args: [
					"run",
					resolve(__dirname, "../../src/mcp/index.ts"),
				],
				cwd: workDir,
			},
		},
	};
}
```

This means krometrail runs from source (not a compiled binary), making it easy to test changes during development.

### Workspace Setup

For each test run, the harness:

1. Creates a temp directory
2. Copies scenario `src/` files into it (including `CLAUDE.md`)
3. Installs the krometrail skill at `.claude/skills/krometrail/` — same as real user installation
4. Git-initializes the workspace (enables diff capture after the agent runs)
5. Runs setup commands from `scenario.json`
6. Generates the MCP config file and writes it to the workspace

```typescript
async function prepareWorkspace(scenario: Scenario): Promise<Workspace> {
	const workDir = await mkdtemp(join(tmpdir(), "krometrail-test-"));

	// Copy source files
	await cp(scenario.srcDir, workDir, { recursive: true });

	// Run setup commands
	for (const cmd of scenario.setup.commands) {
		const proc = Bun.spawn(["bash", "-c", cmd], {
			cwd: workDir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`Setup command failed: ${cmd}\n${stderr}`);
		}
	}

	// Generate MCP config
	const mcpConfigPath = join(workDir, ".mcp-config.json");
	await writeFile(mcpConfigPath, JSON.stringify(generateMcpConfig(workDir)));

	return { workDir, mcpConfigPath };
}
```

### Validation

After the agent finishes, the harness:

1. Copies hidden test files into the workspace
2. Runs the validation command
3. Reports pass/fail

```typescript
async function validate(workspace: Workspace, scenario: Scenario): Promise<ValidationResult> {
	// Copy hidden files into workspace
	await cp(scenario.hiddenDir, workspace.workDir, { recursive: true });

	// Run validation command
	const proc = Bun.spawn(["bash", "-c", scenario.validation.command], {
		cwd: workspace.workDir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;

	return {
		passed: exitCode === 0,
		stdout: await new Response(proc.stdout).text(),
		stderr: await new Response(proc.stderr).text(),
	};
}
```

### Trace Capture

Every run produces a structured trace under `.traces/` (gitignored). See the **Metrics & Reporting** section for the full trace structure, result format, and report generation.

---

## Test Runner

The runner is a vitest test file that iterates scenarios x agents:

**File:** `tests/agent-harness/runner.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { discoverScenarios } from "./lib/scenarios";
import { discoverAgents } from "./lib/agents";
import { runScenario } from "./lib/harness";

const scenarios = await discoverScenarios();
const agents = await discoverAgents();

describe.each(agents)("Agent: $name", (agent) => {
	describe.each(scenarios)("Scenario: $name", (scenario) => {
		it(
			"agent fixes the bug",
			async () => {
				const result = await runScenario(agent, scenario);

				// The only assertion: did the hidden test pass?
				expect(result.validation.passed, [
					`Agent: ${agent.name}`,
					`Scenario: ${scenario.name}`,
					`Duration: ${result.durationMs}ms`,
					`Exit code: ${result.agentResult.exitCode}`,
					result.validation.stderr,
				].join("\n")).toBe(true);
			},
			scenario.timeoutSeconds * 1000 + 30_000, // scenario timeout + buffer
		);
	});
});
```

### Running

```bash
# All scenarios, all available agents
bun run test:agent

# Specific agent
AGENT=claude-code bun run test:agent

# Specific scenario
SCENARIO=python-discount-bug bun run test:agent

# Both filters
AGENT=claude-code SCENARIO=python-discount-bug bun run test:agent
```

Package.json:
```json
{
  "scripts": {
    "test:agent": "vitest run tests/agent-harness/"
  }
}
```

Vitest config override for agent tests:
```typescript
// tests/agent-harness/vitest.config.ts
export default defineConfig({
	test: {
		testTimeout: 300_000,  // 5 min default — agents are slow
		hookTimeout: 60_000,
		include: ["tests/agent-harness/**/*.test.ts"],
	},
});
```

---

## Active Scenarios

Three showcase scenarios — one per language. Each is designed so the debugger gives an immediate answer that source reading cannot. See [scenario-guidelines.md](scenario-guidelines.md) for design rules and selection criteria.

### python-class-attribute-shared

`items = []` declared on the class body is shared across all instances. Processing multiple customers in sequence accumulates prior customers' items. The bug is invisible in `__init__` — `self.items` looks like instance state until you inspect the object at runtime and see it's the same list.

### node-regex-lastindex

A `RegExp` compiled with the `g` flag has stateful `.lastIndex`. When reused across calls, `.test()` alternates between `true` and `false` for the same valid input. The source looks correct. Inspecting `regex.lastIndex` mid-execution reveals the state causing the flip.

### ts-runtime-registry

A dependency injection container builds service keys by hashing `name + variant`. One service declares a dependency using the wrong variant string, producing a hash that matches nothing in the registry. You cannot determine the hash output from source — a breakpoint at key comparison and variable inspection reveals both the expected and actual key values.

---

## File Layout

```
tests/agent-harness/
  runner.test.ts                    # Vitest entry point
  vitest.config.ts                  # Extended timeouts for agent tests
  lib/
    harness.ts                      # Core: prepareWorkspace, runAgent, validate
    scenarios.ts                    # Discover and parse scenario directories
    agents.ts                       # Agent driver registry and discovery
    config.ts                       # Types for scenario.toml, agent options
    trace.ts                        # Trace capture and storage
  drivers/
    claude-code.ts                  # Claude Code agent driver
    codex.ts                        # Codex agent driver (stubbed)
  scenarios/
    python-discount-bug/
      scenario.toml
      prompt.md
      src/
        discount.py
        test_discount.py
      hidden/
        test_validation.py
    python-off-by-one/
      scenario.toml
      prompt.md
      src/
        process_items.py
        test_items.py
      hidden/
        test_validation.py
    node-async-race/
      scenario.toml
      prompt.md
      src/
        file-cache.js
        test-cache.js
      hidden/
        test_validation.js
  .traces/                          # Gitignored — run traces for debugging
```

---

## Open Questions

1. **TOML vs TypeScript config?** TOML keeps scenarios declarative and language-agnostic. TypeScript config would allow computed values and type checking. Leaning TOML for simplicity — scenarios are data, not programs.

2. **Agent permission model.** Claude Code has `--permission-mode bypassPermissions` for non-interactive use. Other agents may handle this differently. The driver abstraction handles this, but we should document the security implications (agent runs with full file access in a temp dir).

3. **Flakiness budget.** LLM-based tests are inherently non-deterministic. Should we retry on failure? Run N times and require M passes? Initial stance: no retries, accept flakiness, track pass rates over time in traces. A scenario that fails >30% of the time is either too hard or poorly designed.

4. **Cost tracking.** Claude Code reports cost via `--output-format stream-json`. Should the harness parse this and enforce budget limits, or just rely on `--max-budget-usd`? Leaning toward the latter — let the agent enforce its own budget.

5. **Multi-file bugs.** Some real bugs span multiple files. The scenario structure supports this (entire `src/` directory is copied), but do we need any special handling for the prompt to orient the agent?

---

## Metrics & Reporting

The harness captures rich metrics per run and produces publishable reports. This is not CI — it's a tool for generating results you can share, blog about, or use in documentation.

### Metrics Collected Per Run

Every scenario x agent run captures:

| Metric | Source | Description |
|--------|--------|-------------|
| `passed` | Hidden test exit code | Did the agent fix the bug? |
| `duration_ms` | Wall clock | Total time from agent spawn to exit |
| `agent_exit_code` | Process | How the agent exited (0, non-zero, null=killed) |
| `timed_out` | Harness | Did the agent hit the timeout? |
| `cost_usd` | Agent stdout (parsed) | Cost of the run (agent-reported, if available) |
| `num_turns` | Agent stdout (parsed) | Number of agent turns (if available) |
| `tool_calls` | Agent stdout (parsed) | List of MCP tools called, with counts |
| `tokens_input` | Agent stdout (parsed) | Input tokens consumed (if available) |
| `tokens_output` | Agent stdout (parsed) | Output tokens consumed (if available) |
| `model` | Agent stdout (parsed) | Model used (if available) |
| `agent_version` | `--version` output | Agent binary version |
| `krometrail_version` | package.json | Krometrail version under test |
| `timestamp` | System clock | ISO 8601 run timestamp |
| `visible_test_before` | Pre-run test | Did the visible test pass before the agent ran? Should always be `true` — if not, the scenario is broken |
| `visible_test_after` | Post-run test | Does the visible test still pass after the agent ran? |
| `validation_stdout` | Hidden test | Raw output from the hidden test |
| `files_changed` | git diff in workspace | Which files the agent modified |
| `diff` | git diff in workspace | The actual patch the agent produced |

### Run Result File

Each run produces a `result.json`:

```json
{
  "scenario": "python-discount-bug",
  "agent": "claude-code",
  "model": "claude-sonnet-4-6",
  "agent_version": "1.2.3",
  "krometrail_version": "0.1.0",
  "timestamp": "2026-03-04T14:30:00Z",
  "passed": true,
  "duration_ms": 45200,
  "cost_usd": 0.12,
  "num_turns": 8,
  "tokens_input": 32000,
  "tokens_output": 4500,
  "timed_out": false,
  "tool_calls": {
    "debug_launch": 1,
    "debug_set_breakpoints": 2,
    "debug_continue": 3,
    "debug_evaluate": 2,
    "debug_variables": 1,
    "debug_stop": 1
  },
  "files_changed": ["discount.py"],
  "visible_test_before": false,
  "visible_test_after": true,
  "diff": "--- a/discount.py\n+++ b/discount.py\n@@ -4,1 +4,1 @@\n-    \"gold\": 1.0,\n+    \"gold\": 0.1,"
}
```

### Report Generation

The harness includes a report command that aggregates results across runs:

```bash
# Generate a report from all traces
bun run test:agent:report

# Generate from a specific run directory
bun run test:agent:report --dir .traces/2026-03-04
```

This produces a **markdown report** suitable for publishing:

```markdown
# Krometrail — Agent Test Report

**Date:** 2026-03-04
**Krometrail version:** 0.1.0

## Summary

| Agent | Scenarios | Passed | Failed | Pass Rate | Avg Duration | Avg Cost |
|-------|-----------|--------|--------|-----------|--------------|----------|
| claude-code (sonnet-4-6) | 3 | 3 | 0 | 100% | 42s | $0.15 |

## Results by Scenario

### python-discount-bug

| Agent | Result | Duration | Cost | Turns | Debug Tools Used |
|-------|--------|----------|------|-------|------------------|
| claude-code | PASS | 45s | $0.12 | 8 | launch, breakpoints, continue(3), evaluate(2), stop |

### python-off-by-one

| Agent | Result | Duration | Cost | Turns | Debug Tools Used |
|-------|--------|----------|------|-------|------------------|
| claude-code | PASS | 38s | $0.10 | 6 | launch, breakpoints, step(4), variables, stop |

### node-async-race

| Agent | Result | Duration | Cost | Turns | Debug Tools Used |
|-------|--------|----------|------|-------|------------------|
| claude-code | PASS | 62s | $0.22 | 11 | launch, breakpoints, continue(4), evaluate(3), variables(2), stop |

## Tool Usage Patterns

| Tool | Total Calls | Avg per Scenario |
|------|-------------|-----------------|
| debug_launch | 3 | 1.0 |
| debug_continue | 10 | 3.3 |
| debug_set_breakpoints | 3 | 1.0 |
| debug_evaluate | 5 | 1.7 |
| debug_variables | 3 | 1.0 |
| debug_step | 4 | 1.3 |
| debug_stop | 3 | 1.0 |
```

The report command also outputs the same data as JSON for programmatic consumption:

```bash
bun run test:agent:report --format json > report.json
```

### Trace Directory Structure

```
tests/agent-harness/.traces/
  2026-03-04T14-30-00Z/                    # One directory per suite run
    meta.json                               # Suite-level metadata
    claude-code/
      python-discount-bug/
        result.json                         # Structured metrics
        agent-stdout.txt                    # Raw agent output
        agent-stderr.txt                    # Agent errors
        workspace-diff.patch                # Git diff of agent's changes
        validation-stdout.txt               # Hidden test output
      python-off-by-one/
        ...
    report.md                               # Generated report
    report.json                             # Machine-readable report
```

### Workspace as Git Repo

To capture diffs cleanly, the harness initializes each workspace as a git repo:

```typescript
// In prepareWorkspace:
await exec("git init", { cwd: workDir });
await exec("git add -A", { cwd: workDir });
await exec('git commit -m "initial"', { cwd: workDir });
```

After the agent finishes:

```typescript
// Capture what the agent changed
const diff = await exec("git diff HEAD", { cwd: workDir });
const filesChanged = await exec("git diff --name-only HEAD", { cwd: workDir });
```

This gives us a clean patch showing exactly what the agent modified, perfect for including in reports.

---

## Non-Goals

- **Benchmarking agents against each other.** The reports show per-agent results side by side, but the purpose is to validate krometrail, not to rank agents. We don't draw conclusions about which agent is "better" — model versions, prompts, and configurations all affect outcomes.

- **Testing without krometrail.** ~~We don't run scenarios without krometrail to establish a baseline.~~ *Update: baseline runs are now implemented — see [with-without-comparison.md](with-without-comparison.md).*

- **Covering every language.** The active suite has Python, Node, and TypeScript. New languages can be added as adapters mature — the harness is language-agnostic, new languages are just new scenario directories.

- **Complex real-world codebases.** Scenarios are small and focused by design (2–4 files, 100–300 lines). The goal is a clean debugger demonstration, not a comprehensive codebase investigation.
