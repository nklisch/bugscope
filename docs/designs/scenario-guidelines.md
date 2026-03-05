# Scenario Design Guidelines

Cross-language guidelines for creating agent test harness scenarios. Each language should have scenarios at every level, exercising that language's specific debugging patterns and common footguns.

## Level Design Framework

### Level 1 — Read the Code
**Goal:** Baseline. Can the agent find and fix an obvious bug?

**Design rules:**
- Bug is a single wrong token: wrong constant, wrong operator, typo in identifier
- Fix is a 1-line change
- The test error message is descriptive and points near the bug
- Agent could fix this without running anything, but the test confirms it

**Language-specific examples:**
- Python: wrong dict value, wrong comparison operator
- JavaScript: `===` vs `==`, wrong array method (`splice` vs `slice`)
- Go: wrong type conversion, off-by-one in slice bounds
- Rust: wrong `.unwrap()` vs `.unwrap_or()`, wrong match arm

### Level 2 — Run and Trace
**Goal:** Agent must execute the code and follow the failure path.

**Design rules:**
- Bug isn't obvious from a single line — requires understanding data flow
- The test error message tells you *what* is wrong but not *where*
- Agent needs to trace from the failing assertion back through 2-3 function calls
- There should be a plausible "wrong fix" that an agent might try without tracing (e.g., patching the test expectation)

**Language-specific patterns:**
- Python: wrong operator precedence, variable shadowing, wrong iteration order
- JavaScript: async ordering, prototype chain confusion, `this` binding
- Go: nil pointer from wrong error check path, goroutine variable capture
- Rust: wrong lifetime leading to use-after-move, iterator chaining bug

### Level 3 — Inspect Runtime State
**Goal:** The bug depends on state that isn't obvious from the code. You need to stop execution and look at actual values.

**Design rules:**
- Code looks correct on read-through — the bug is in how state accumulates at runtime
- At least one value must be inspected to understand the problem (a variable, a field, a return value)
- The root cause is a language-specific footgun (mutable defaults, closure capture, shared references)
- Multiple variables or fields need checking — the agent can't just guess which one is wrong

**Language-specific footguns:**
- Python: mutable default args, late-binding closures, class vs instance attributes
- JavaScript: closure over `var` in loop, prototype mutation, implicit type coercion
- Go: goroutine closure capturing loop variable (pre-1.22), slice header sharing underlying array
- Rust: interior mutability (`RefCell`) panic, `Rc` reference cycle

### Level 4 — Multi-Component Interaction
**Goal:** The error manifests far from its root cause. Agent must trace data flow across module boundaries.

**Design rules:**
- At least 2 files or 3+ functions involved
- The failing test is in module A, the bug is in module B
- There should be an intermediate transformation that obscures the relationship
- A "silent wrong" pattern: no error or exception, just incorrect output
- Generator exhaustion, stale cache, wrong merge order — things that don't crash

**Language-specific patterns:**
- Python: generator exhaustion, mutation of passed-in objects, import-time side effects
- JavaScript: event loop ordering, callback vs promise resolution order, module caching
- Go: channel deadlock, context cancellation propagation, interface nil check
- Rust: trait method dispatch to wrong impl, Arc<Mutex<>> deadlock

### Level 5 — Subtle and Adversarial
**Goal:** The code looks completely correct on careful review. The bug is in an edge case, a precision issue, or an assumption about the environment.

**Design rules:**
- An experienced developer would need 10+ minutes to find this by reading alone
- The bug involves a non-obvious interaction: float precision, hash ordering, encoding, concurrency
- The test case is specifically constructed to trigger the edge case
- There should be one "aha moment" — once you see the runtime value, the fix is clear

**Language-specific examples:**
- Python: float accumulation, dict ordering assumptions, Unicode normalization
- JavaScript: `Number.MAX_SAFE_INTEGER` overflow, `Date` timezone handling, RegExp statefulness
- Go: map iteration order, string/rune confusion, time.After leak
- Rust: integer overflow in release mode, `PartialOrd` inconsistency, `Send`/`Sync` bounds

### Level 5 Showcase — Complex State
**Goal:** Exercise the eval/inspect tools on realistically large, nested objects. The bug is findable but buried in complexity.

**Design rules:**
- At least 200 lines of source, multiple data structures with 5+ nesting levels
- A multi-stage pipeline where data is transformed at each stage
- The bug is a field reference that was correct at one stage but wrong after transformation
- An agent without debugging tools would need to mentally simulate the entire pipeline
- With debugging tools, it's 2-3 breakpoints and a few `eval` calls

### Level 5 Contrived — Requires Runtime
**Goal:** A puzzle that is *impossible* to solve without executing the code and inspecting runtime values.

**Design rules:**
- Values are computed at runtime from external inputs, encoded data, or registries
- The source code alone does not contain enough information to determine the actual values
- The agent must set breakpoints and evaluate expressions to discover what the values are
- At least one value is derived from: encoded data (base64, hashed), environment variables, computed registries, or dynamic dispatch

---

## Cross-Language Scenario Strategy

Each language suite should contain **two categories** of scenarios at every difficulty level:

### Shared-concept scenarios

Same bug *pattern* across languages, idiomatic to each runtime. These enable direct cross-language comparison: "Does the agent debug this class of bug better in Python or Node?"

- The conceptual bug is identical (e.g., variable not reset between loops, mutation before read, float precision).
- The code is **not** a literal port — it uses that language's idioms, standard library, and naming conventions.
- Naming convention: use the same suffix across languages. If Python has `python-shadow-variable`, Node has `node-shadow-variable`.

**Target: 1 shared-concept scenario per difficulty level (5 total per language).**

### Language-specific scenarios

Bugs that exploit footguns unique to that language or runtime. These are the scenarios that demonstrate *why* runtime debugging matters for that specific ecosystem.

- The bug cannot exist (or would manifest completely differently) in other languages.
- Examples: Python's mutable default args, JS `var` closure capture, Go goroutine variable capture, Rust use-after-move.
- Naming convention: use a descriptive name specific to the bug pattern (`node-this-binding`, `python-default-mutable`).

**Target: at least 1 language-specific scenario per difficulty level (5+ per language).**

### Suite composition

| Level | Shared | Language-specific | Total per level |
|-------|--------|-------------------|-----------------|
| 1 | 1 | 1+ | 2+ |
| 2 | 1 | 1+ | 2+ |
| 3 | 1 | 1+ | 2+ |
| 4 | 1 | 1+ | 2+ |
| 5 | 1 | 1+ (plus showcase/contrived) | 2+ |

Minimum **10 scenarios per language** (5 shared + 5 specific). Showcase and contrived Level 5 variants are language-specific — they should exercise that runtime's debugging tools on problems unique to its ecosystem.

---

## Scenario Anatomy Checklist

Every scenario, regardless of language, must have:

```
scenarios/<name>/
  scenario.json       # name, language, timeout, budget, test commands
  prompt.md           # natural language bug description
  src/                # buggy source + visible failing test
  hidden/             # oracle validation test the agent never sees
```

### `scenario.json`

```json
{
  "scenario": {
    "name": "<name>",
    "language": "<python|node|typescript|go|rust|cpp|java>",
    "description": "<one-line description of the bug>",
    "timeout_seconds": 120,
    "max_budget_usd": 0.50
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

### Timeout / Budget scaling

| Level | Timeout | Budget |
|-------|---------|--------|
| 1-2 | 120s | $0.50 |
| 3 | 180s | $0.75 |
| 4 | 240s | $1.00 |
| 5 | 300s | $1.50 |
| 5 showcase/contrived | 360s | $2.00 |

### Prompt rules

- Describe the **symptom**, not the cause: *"gold customers get 100% discount"* not *"the multiplier is wrong"*
- Name the files involved so the agent knows where to start
- Keep it to 2-3 sentences — the agent has the skill file for debugging strategy
- Never mention agent-lens, debugging tools, breakpoints, or stepping

### Test rules

- **Visible test:** should fail before the fix, pass after. Must be runnable with a single command.
- **Hidden test:** should validate the fix more thoroughly than the visible test. Test edge cases the visible test doesn't cover. Import from the same modules the agent is expected to fix.
- Both tests must be independent — hidden test must not depend on visible test state.

### Source code rules

- Code should look realistic — not a toy example wrapped in a function
- Include enough surrounding code that the bug isn't the only interesting thing in the file
- Variable names, function names, and structure should look like real production code
- For Level 3+, include some correct-but-suspicious code to create false leads

---

## Supported Languages

| Language | `language` value | Runtime | Notes |
|----------|-----------------|---------|-------|
| Python | `python` | CPython 3.10+ | debugpy adapter |
| JavaScript (Node) | `node` | Node.js 20+ | js-debug adapter, plain `.js` with ES modules |
| TypeScript | `typescript` | Node.js 20+ / tsx | Separate suite from `node` — see below |
| Go | `go` | Go 1.21+ | Delve adapter |

### JavaScript vs TypeScript

JavaScript (`node`) and TypeScript (`typescript`) are **separate language suites** with independent scenario sets. They share a runtime but the debugging experience differs significantly:

- **Type annotations** give agents additional signals about expected shapes, narrowing the search space. A bug that requires runtime inspection in JS might be diagnosable from type mismatches in TS.
- **Compile-time contracts** (interfaces, generics, strict null checks) change which bugs are even *possible*. Many JS footguns (`this` binding on untyped callbacks, implicit coercion) are caught or surfaced differently in strict TS.
- **TS-specific bugs** include incorrect type assertions (`as`), unsound generics, `any` escape hatches hiding real types, and declaration files that don't match runtime behavior.
- **Debugging TS** involves source maps, which adds a layer of indirection the agent must navigate.

The `node` suite (plain JS) comes first. A future `typescript` suite should have its own shared-concept scenarios and TS-specific scenarios (e.g., wrong `as` cast, `any` masking a type error, generic constraint mismatch).
