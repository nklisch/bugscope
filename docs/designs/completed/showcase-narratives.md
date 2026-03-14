# Showcase Narratives — Design Notes

How the harness output can be used to tell debugging stories. No decisions made here — just capturing the building blocks and the shapes they could take.

## What we capture today

Per scenario run, the harness produces:

### Structured data (`report.json`)
- **Tool timeline** — ordered list of every tool call + result. Each entry has the tool name, the full input the agent sent, and the full output the agent received (viewports, file contents, test output, etc.)
- **Session log** — compact human-readable event stream (`[init]`, `[tool] debug_launch`, `[text] I found the bug...`, `[done]`)
- **Result summary** — the agent's own explanation of what it found and fixed
- **Diff** — git diff of what the agent changed
- **Metrics** — turns, tokens (input/cache/output breakdown), model, agent version
- **Scenario metadata** — name, language, description

### Raw artifacts (trace directory)
- `agent-stdout.txt` — full stream-json from the agent (every message, thinking blocks, tool calls, results)
- `session.log` — the compact event stream
- `workspace-diff.patch` — the raw patch
- `result.json` — full result including validation output

### Across runs (`index.json`)
- Every suite run with summary stats (pass rate, agents, scenarios)
- Enables historical comparison

## The narratives these enable

### 1. Investigation replay
The tool timeline is a step-by-step record of the agent's debugging session. Each entry shows:
- What the agent decided to do (tool call + input)
- What it learned (tool result — the viewport, test output, file content)
- How it responded (next tool call or text reasoning)

This is the core narrative: "Here's how an AI agent debugged this issue, step by step."

### 2. Before/after
- The visible test fails before the agent runs
- The agent investigates, finds the root cause, applies a fix
- The hidden test passes after
- The diff shows exactly what changed

Simple but powerful: "This was broken. The agent fixed it. Here's what it did."

### 3. Debugging tool showcase
Filter the timeline to just `debug_*` / `mcp__krometrail__*` tool calls. This shows:
- Which debug tools the agent chose and why
- What the viewport looked like at each stop (source context, locals, stack trace)
- How the agent used `eval` to test hypotheses
- The moment the agent found the root cause (visible in the viewport output)

This is the krometrail pitch: "Here's what runtime debugging looks like for an AI agent."

### 4. Difficulty progression
With scenarios at levels 1-5, you can show:
- Level 1: agent reads the code and fixes it (no debugging needed)
- Level 3: agent has to set breakpoints and inspect state to find the bug
- Level 5: agent must navigate complex objects, trace data through pipelines, evaluate expressions

The story: "As bugs get harder, debugging tools become essential."

### 5. Agent comparison
Run the same scenarios with different agents (Claude Code, Codex, etc.) or different models. Compare:
- Which scenarios each agent solved
- How many turns / tokens each used
- Whether they used debugging tools or tried to fix by reading alone
- Quality of the investigation (did they find the root cause or just patch the symptom?)

### 6. Tool usage patterns
Aggregate `toolCalls` across scenarios to show:
- Which debug tools agents reach for most
- How tool usage changes with scenario difficulty
- Whether agents that use debugging tools succeed more often

## Data shapes a renderer could consume

The `report.json` is designed to be self-contained. A renderer needs no other files.

**For a summary view:** `report.summary` + `report.agents` + `report.scenarios`

**For a scenario detail view:** `report.results[i]` — has metrics, diff, session log, result summary

**For an investigation replay:** `report.results[i].toolTimeline` — ordered array, each entry has tool/input/output

**For historical trends:** `index.json` — array of runs with summary stats

**For raw deep-dive:** individual trace files (agent-stdout.txt has everything including thinking blocks)

## Open questions

- How much of the tool output to show inline vs collapsed/expandable? Viewport output can be 50+ lines per tool call.
- Should the timeline include the agent's text reasoning between tool calls, or just the tool calls themselves? The session log has compact reasoning; the raw stdout has full thinking blocks.
- How to handle the diff display — inline code diff, side-by-side, or just the patch?
- Should scenarios have a "expected investigation path" to compare against what the agent actually did?
- Video/animation of the investigation vs static step-through?
- How to present the contrast between "with debugging tools" vs "without" for the same scenario?
