# Agent Harness

Evaluates AI agents on real debugging tasks. An agent is given a buggy program and must identify and fix the bug based solely on a natural-language bug report. Pass/fail is determined by a hidden oracle test the agent never saw.

## Running

```bash
bun run test:agent                    # all agents × all scenarios × all modes
bun run test:agent:report             # generate report from latest trace run
```

Filter with env vars (combinable):

```bash
AGENT=claude-code bun run test:agent
SCENARIO=python-float-accumulation bun run test:agent
RUN_MODE=mcp bun run test:agent
RUN_MODE=mcp,baseline bun run test:agent
LEVEL=1 bun run test:agent
LEVEL=1,2 bun run test:agent
TRACE_DIR=./results bun run test:agent
```

> This suite is NOT run in CI. It spawns real agent binaries and costs money.

## Modes

Each scenario runs in three modes to measure the value of krometrail:

| Mode | What the agent gets |
|------|---------------------|
| `baseline` | Nothing — code reading, bash only |
| `cli` | `krometrail` CLI on PATH + skill installed in workspace |
| `mcp` | krometrail MCP server configured — full `debug_*` tool access |

## Scenarios

22 scenarios across three language suites:

| Suite | Count | Levels |
|-------|-------|--------|
| Python | 9 | 1–4 |
| Node.js | 7 | 1–4 |
| TypeScript | 6 | 1–3 |

## Scenario Layout

```
scenarios/<name>/
  scenario.json      # metadata, test commands, timeout
  prompt.md          # natural-language bug report the agent receives
  src/               # files copied into the agent's workspace
    CLAUDE.md        # project description: files, how to run/test
    <source files>
    <visible test>   # passes with buggy code — not a signal of what's wrong
  hidden/            # oracle test copied in after the agent finishes
```

`scenario.json` fields:

```json
{
  "scenario": {
    "name": "python-float-accumulation",
    "language": "python",
    "description": "...",
    "timeout_seconds": 300,
    "level": 1
  },
  "setup": { "commands": [] },
  "visible_test": { "command": "python3 -m pytest test_bill.py -x -q 2>&1" },
  "validation":   { "command": "python3 -m pytest test_validation.py -x -q 2>&1" }
}
```

- `visible_test` — passes with the buggy code; checked before and after the run to confirm the agent didn't break anything
- `validation` — the hidden oracle; copied in from `hidden/` after the agent finishes and must pass
- `setup.commands` — run inside the workspace before the agent starts (e.g. `npm install`)

## Design Philosophy

**The prompt is the only source of truth.** The visible test passes before the agent runs — it cannot be used to find the bug. The agent's only evidence is the bug report in `prompt.md`, written in the voice of a customer, engineer, or product team member describing what they observed and what they expected. The agent must investigate the code and runtime state to identify the root cause.

**The skill is installed like a real project.** The krometrail skill is placed at `.claude/skills/krometrail/SKILL.md` in the workspace — the same mechanism a real user would use — not injected via system prompt flags.

**Each scenario has a `CLAUDE.md`.** Just like a real project, the workspace root has a `CLAUDE.md` describing the project structure and how to run things. This is how the agent discovers the project layout, not through hints in the prompt.

**The hidden test is the only oracle.** We don't assert on what tools the agent called or how many turns it took. Pass/fail is purely: does the hidden test pass?

## Traces

Results are saved under `.traces/<timestamp>/`:

```
.traces/<timestamp>/
  meta.json
  <agent>/
    <scenario>/
      <mode>/
        result.json          # structured pass/fail + metrics
        agent-stdout.txt
        agent-stderr.txt
        session.log
        workspace-diff.patch
```

`result.json` includes: pass/fail, duration, token usage, turn count, tool call counts, retry count, the git diff, and the agent's final summary. `visibleTestBefore` should always be `true` — if it isn't, the visible test itself is broken.

## Report

```bash
bun run test:agent:report                        # latest trace dir → stdout (markdown)
bun run test:agent:report --dir .traces/2026-03  # specific run
bun run test:agent:report --format json          # JSON to stdout
bun run test:agent:report --out report.md        # write to file
```

## Agents

Drivers live in `drivers/`. Currently:

- `claude-code` — Claude Code CLI (`claude`)
- `codex` — OpenAI Codex CLI (stubbed, not yet enabled)

Add a new agent by implementing the `AgentDriver` interface in `lib/config.ts` and registering it in `lib/agents.ts`.

## Adding a Scenario

1. Create `scenarios/<name>/` with the layout above
2. Write a buggy `src/` program — **do not write a visible test that catches the bug**
3. Write `src/CLAUDE.md` describing the project structure and how to run/test it
4. Write a visible test (`src/test_*.py` etc.) that **passes with the buggy code** — test unaffected paths or structural properties
5. Write `hidden/test_validation.*` — the real oracle that only passes when the bug is fixed
6. Write `prompt.md` — a natural-language bug report in the voice of whoever discovered it (customer, engineer, product). State what was expected and what actually happened with concrete values. No instructions on how to fix it.
7. Write `scenario.json` with a realistic timeout and level

The harness copies `src/` into a fresh temp directory, installs the skill at `.claude/skills/krometrail/`, git-inits the workspace, runs setup commands, then hands control to the agent. After the agent exits, `hidden/` is copied in and the validation command runs.

## Diagnostics

If agent spawning is broken outside the harness:

```bash
bash tests/agent-harness/diagnose.sh
```

Run this from a terminal that is NOT inside a Claude Code session (the `CLAUDECODE` env var must be unset).
