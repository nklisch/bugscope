# Design: Agent Harness Showcase Simplification

## Problem

The harness has accumulated 23 scenarios across six difficulty levels. The original goal was to measure whether an agent *could* debug — the level system was designed to find where agents fail. But the more immediate goal is different: **demonstrate that an agent *does* use the debugger** when krometrail is available.

With the level scheme and large scenario count, the harness is hard to run and the signal is diffuse. A 23-scenario suite that the agent can solve by reading code doesn't prove debugger usage — it just proves the agent can read.

We need a minimal, focused suite: one scenario per language, each designed so that the debugger is the most natural path to the answer.

---

## Goals

1. One scenario per language — runnable as a quick smoke test
2. Each scenario requires runtime inspection; code reading alone is slow and unreliable
3. Prompts explicitly invite debugger use when available
4. Drop the level scheme entirely — scenarios are just scenarios
5. Remove the multi-language L7 scenario (out of scope for this harness)

---

## Scenario Selection

### Criteria for a "showcase" scenario

A showcase scenario must satisfy:

- **Runtime-visible, statically-invisible**: The bug involves a runtime value (computed key, accumulated state, mutable shared object, stateful iterator) that cannot be determined from reading source alone
- **Breakpoint payoff**: Setting one breakpoint and inspecting variables reveals the bug immediately — the debugger gives the answer in one step
- **Small surface**: 2-4 files, ~100-300 lines. The agent should spend time *debugging*, not reading
- **Single bug**: No compound multi-bug interactions — the showcase is about the debugging workflow, not investigative breadth

### Selected scenarios

| Language   | Scenario                    | Bug                                                                  | Why it needs the debugger                                                                                 |
|------------|-----------------------------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Python     | `python-class-attribute-shared` | Mutable list declared as class attribute; shared across all instances | `self.items` looks like an instance attribute in `__init__`. Only inspecting the object at runtime shows it's the same list object across all carts. |
| Node       | `node-regex-lastindex`      | `RegExp` with `g` flag has stateful `.lastIndex`; `.test()` alternates true/false for the same input | The source looks correct. Only inspecting `regex.lastIndex` *during* execution reveals the state that causes the flip. |
| TypeScript | `ts-runtime-registry`       | DI container uses hash-computed service keys; `RateLimiter` declares dependency with wrong variant string producing a key that matches nothing | You cannot know the hash output from reading the source. Set a breakpoint where keys are compared and inspect both sides. |

### Scenarios to archive

All other scenarios move to `tests/agent-harness/scenarios/_archive/`. They are not deleted — they may be useful as a scenario library for future suites. The multi-language `multi-order-pipeline` (L7) is archived without replacement; cross-language scenarios are out of scope for this harness.

---

## Schema Changes

### scenario.json — drop `level`

Before:
```json
{
  "scenario": {
    "name": "python-class-attribute-shared",
    "language": "python",
    "description": "...",
    "timeout_seconds": 300,
    "level": 1
  },
  ...
}
```

After:
```json
{
  "scenario": {
    "name": "python-class-attribute-shared",
    "language": "python",
    "description": "...",
    "timeout_seconds": 300
  },
  ...
}
```

`level` is removed. There is no level scheme. A scenario is a scenario.

---

## Prompt Changes

The current prompts describe the symptom but make no mention of debugging strategy — by design, to avoid prescribing an approach. That made sense when we were evaluating whether an agent would reach for the debugger unprompted.

The new goal is different: **we want to see the debugger being used**. We're showcasing what krometrail enables, not evaluating whether the agent discovers it. So prompts now explicitly invite debugger use.

### Prompt template addition

Each prompt ends with a standalone paragraph:

> If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.

This is appended after the bug description. It does not say *where* to set the breakpoint or what to inspect — it just removes the ambiguity about whether to use the tool.

### Updated prompts

**python-class-attribute-shared:**
```
We're seeing wrong item counts when we process multiple customers together. Alice has 5 items and Bob has 1 item. When we process them in a batch, Alice comes back correct at 5, but Bob comes back as 6 — it's like his cart still has Alice's stuff in it. Every customer after the first picks up the previous customers' items.

If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.
```

**node-regex-lastindex:**
```
Our email validation is giving inconsistent results depending on how many users we process at once. "alice@example.com" is a perfectly valid email. When we validate just Alice, she comes back valid. When we validate Alice, Bob, and Carol together — all with valid emails — Bob comes back invalid even though his email is fine. Run it again and the pattern shifts. The same email shouldn't flip between valid and invalid based on what else is in the list.

If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.
```

**ts-runtime-registry:**
```
The app crashes on startup when it tries to resolve the RateLimiter service. The error says a dependency service wasn't found, and the key in the error message doesn't match anything we can find in the source. The RateLimiter depends on CacheService, but somehow the container can't find it.

If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.
```

---

## Updated Scenario Guidelines

`docs/designs/scenario-guidelines.md` is replaced with a simpler document covering only showcase scenarios. Key rules:

### Showcase scenario design rules

**Bug type — must be runtime-visible:**
- Computed/hashed keys where the output can't be determined by reading
- Shared mutable state that accumulates across calls
- Stateful iterators, generators, or compiled objects with hidden state
- Values derived from encoding, hashing, or dynamic dispatch

**Bug type — NOT suitable:**
- Off-by-one errors readable in source
- Typos or wrong operator (`+` vs `-`)
- Logic bugs that are clear from a single read-through

**Size:**
- 2-4 files, 100-300 lines total
- No noise files, no red herrings, no false leads — the agent should get to the bug quickly

**Prompt rules:**
- Describe the observable symptom with concrete values
- End with the standard debugger invitation paragraph
- Do not name files, entry points, or suggest where to look

**Visible test rules (unchanged):**
- Must pass with the buggy code
- Tests paths unaffected by the bug

---

## Implementation Plan

1. Archive all non-selected scenarios to `tests/agent-harness/scenarios/_archive/`
2. Update `prompt.md` in the 3 selected scenarios to append the debugger invitation
3. Remove `level` from `scenario.json` in the 3 selected scenarios
4. Replace `docs/designs/scenario-guidelines.md` with the simplified version above
5. Update the harness runner if it reads or validates `level` from `scenario.json`

---

## What This Does Not Change

- Scenario directory structure (`src/`, `hidden/`, `prompt.md`, `scenario.json`, `CLAUDE.md`)
- Skill delivery mechanism (`.claude/skills/krometrail/SKILL.md` in workspace)
- Visible test passes / hidden test is oracle — that contract is unchanged
- The harness runner itself — no structural changes needed

---

## Open Questions

- **Go/Rust/Java/C++**: The adapters exist but no showcase scenarios are written yet. They can be added to the active suite once each adapter is stable enough for harness use. The archive scenarios for those languages don't exist yet so nothing needs archiving.
- **Future expansion**: If we want to grow beyond showcasing to benchmarking again, the archive is available as a starting point. The level design framework can be preserved there as a reference, not deleted.
