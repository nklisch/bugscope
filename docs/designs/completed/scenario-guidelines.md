# Scenario Design Guidelines

Guidelines for creating agent harness showcase scenarios. Each scenario is designed to demonstrate an agent using the debugger — not to measure whether an agent will reach for it unprompted.

See [harness-showcase-simplification.md](harness-showcase-simplification.md) for the design rationale behind the simplified suite.

---

## Purpose

A showcase scenario demonstrates what happens when an agent uses krometrail on a real bug. The bug must be one where:

1. **The debugger gives an immediate answer** — set one breakpoint, inspect variables, see the problem
2. **Reading source alone is slow or unreliable** — the value that reveals the bug is computed at runtime

The scenarios are not a difficulty progression. They are a representative set: one per language, each chosen because it showcases a different class of runtime-visible bug.

---

## Showcase Scenario Design Rules

### Bug type — must be runtime-visible

The bug must involve a value that cannot be determined by reading source alone:

- **Computed/derived keys** — hash output, encoded string, dynamic dispatch result
- **Shared mutable state** — an object or collection that accumulates across calls without the caller knowing
- **Stateful iterators or compiled objects** — `.lastIndex` on a regex, generator exhaustion, cursor position
- **Values from conditional transformation** — a value that may or may not have been transformed depending on a path taken earlier

**Not suitable:**
- Off-by-one errors readable from the condition
- Typos or wrong operator that are visible in source
- Logic bugs clear from a single read-through of one function

### Breakpoint payoff

Setting one breakpoint and inspecting the relevant variable should reveal the bug. The agent should not need to step through dozens of frames or inspect complex call trees. The "aha" moment should be: *I see the value; it's wrong; I know why.*

### Size

- 2–4 files, 100–300 lines total
- No noise files, no red herrings
- The agent should spend time *debugging*, not reading

### Single bug

One bug per showcase scenario. The goal is a clean demonstration of the debugger finding one thing, not multi-bug investigation.

---

## Scenario Anatomy

```
scenarios/<name>/
  scenario.json       # metadata + test commands
  prompt.md           # natural-language bug report with debugger invitation
  src/                # buggy source, CLAUDE.md, visible test
  hidden/             # oracle validation test (agent never sees this)
```

### scenario.json

```json
{
  "scenario": {
    "name": "<name>",
    "language": "<python|node|typescript|go|rust|cpp|java>",
    "description": "<one-line description of the bug>",
    "timeout_seconds": 300
  },
  "setup": {
    "commands": []
  },
  "visible_test": {
    "command": "<single command to run the visible test>"
  },
  "validation": {
    "command": "<single command to run the hidden oracle test>"
  }
}
```

No `level` field. There is no level scheme.

### src/CLAUDE.md

Factual project description: what each file does, how to run the tests. No mention of the bug, expected behavior, or debugging strategy.

```markdown
# <Project Name>

One-sentence description of what the system does.

## Files

- `<file>` — brief description
- `<file>` — brief description

## Running

```bash
<single test command>
```
```

### prompt.md

A natural-language bug report followed by a debugger invitation.

**Structure:**
1. Describe the symptom with concrete values (what was expected, what happened)
2. Do not name files, entry points, or suggest where to look
3. End with the standard debugger invitation paragraph

**Standard debugger invitation (append verbatim to every prompt):**
> If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.

**Good example:**
> We're seeing wrong item counts when we process multiple customers together. Alice has 5 items and Bob has 1 item. When we process them in a batch, Alice comes back correct at 5, but Bob comes back as 6 — it's like his cart still has Alice's stuff in it. Every customer after the first picks up the previous customers' items.
>
> If a debugger is available, use it — set a breakpoint at the relevant code and inspect the runtime values directly. It will be faster than reasoning from source alone.

**Bad example** (tells the agent where to look):
> The `Cart.__init__` method in `cart.py` has a class attribute bug. Set a breakpoint at line 8 and inspect `self.items`. Run `python3 -m pytest test_cart.py -v` to verify your fix.

### Visible test

**Must pass with the buggy code.** Its only role is to detect regressions — verify the agent didn't break unrelated functionality.

- Tests inputs or paths not affected by the bug
- One or two assertions is enough
- The agent cannot use it to locate the bug

### Hidden test

The oracle. Only passes when the bug is fixed.

- Tight assertions on the specific values from the bug report
- Must not depend on visible test state
- Tests the exact inputs described in the prompt

---

## Active Scenarios

| Scenario | Language | Bug | Why the debugger helps |
|---|---|---|---|
| `python-class-attribute-shared` | python | Mutable list declared as class attribute; shared across all instances | `self.items` looks like instance state. Only inspecting the object at runtime shows it's the same list across all carts. |
| `node-regex-lastindex` | node | `RegExp` with `g` flag has stateful `.lastIndex`; `.test()` alternates true/false for the same input | The source looks correct. Inspecting `regex.lastIndex` during execution reveals the state causing the flip. |
| `ts-runtime-registry` | typescript | DI container uses hash-computed service keys; wrong variant string produces a key that resolves to nothing | You cannot know the hash output from reading source. Set a breakpoint where keys are compared and inspect both sides. |

---

## Adding a New Scenario

A good candidate scenario:

1. Has a runtime-visible bug (see criteria above)
2. Can be demonstrated with a single breakpoint + variable inspection
3. Fits in 2–4 files
4. Is idiomatic to the target language (not a toy example)

Use the existing scenarios as reference. The `ts-runtime-registry` scenario is the gold standard for "must use debugger" — the hash values are simply unknowable without running the code. The `node-regex-lastindex` scenario is the gold standard for "stateful runtime object" — the bug is perfectly invisible in source.

---

## Supported Languages

| Language | `language` value | Runtime | Adapter |
|---|---|---|---|
| Python | `python` | CPython 3.10+ | debugpy |
| JavaScript (Node) | `node` | Node.js 20+ | js-debug |
| TypeScript | `typescript` | Node.js 20+ / tsx | js-debug |
| Go | `go` | Go 1.21+ | Delve |
| Rust | `rust` | rustc stable | CodeLLDB |
| C/C++ | `cpp` | GCC/Clang | GDB/lldb-dap |
| Java | `java` | JDK 17+ | java-debug-adapter |
