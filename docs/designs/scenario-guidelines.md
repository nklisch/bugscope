# Scenario Design Guidelines

Cross-language guidelines for creating agent test harness scenarios. Each level requires progressively deeper investigation, more files, and — at higher levels — multiple interacting bugs that demand runtime debugging.

## Level Design Framework

### Level 1 — Subtle Single Bug
**Goal:** The code looks correct on a read-through. The bug is in an edge case, precision issue, or language footgun. An experienced human could find it by reading, but it takes effort.

**Design rules:**
- 2-4 files, ~200-300 lines total
- One bug involving edge cases, precision, or language-specific footguns
- Code looks plausible — the bug isn't visible in a quick scan
- The "aha" requires understanding a runtime value that doesn't match expectations
- Solvable by reading + running tests, but debugging is faster

**Examples:** float accumulation errors, regex statefulness, class vs instance attribute sharing, generator exhaustion, closure late-binding

### Level 2 — Two Bugs, Interacting
**Goal:** Two bugs that interact or mask each other. Fixing only one still leaves tests failing or produces a different failure.

**Design rules:**
- 4-6 files, ~400-600 lines total
- Two bugs that are causally related or mask each other
- Fixing bug A changes the failure mode, revealing bug B
- At least one bug requires runtime inspection to find — it's not visible from source
- Include at least one false lead: suspicious-looking code that is actually correct
- Agent must diagnose and fix both to pass validation

**Interaction patterns:**
- Bug A masks bug B: fixing A causes a different test failure from B
- Bug A and B compound: each causes a small error, together they exceed the threshold
- Bug A is upstream: wrong value flows into code that has its own independent bug

### Level 3 — Multi-Bug Realistic Codebase
**Goal:** A realistic codebase with 2-3 bugs scattered across subsystems. No single file read reveals the full picture.

**Design rules:**
- 6-8 files, ~600-1000 lines total
- 2-3 bugs in different subsystems (e.g., data parsing, business logic, output formatting)
- The visible test catches 1-2 bugs; the hidden validation catches all
- Red herrings: TODO comments near correct code, suspicious-but-valid patterns
- At least one bug only manifests under specific inputs (the hidden test exercises these)
- Multiple plausible fix locations — agent must verify which is actually wrong

**Structural patterns:**
- Layered: API handler → service → data access, bugs at different layers
- Pipeline: transform → validate → aggregate, bugs at different stages
- Event-driven: publisher → subscriber → handler, ordering/timing bugs

### Level 4 — Large Codebase, Deep Investigation Required
**Goal:** A substantial codebase where the agent cannot hold the full context from reading alone. Multiple bugs require tracing execution flow across module boundaries.

**Design rules:**
- 8-12 files, ~1000-1500 lines total
- 3 bugs scattered across the codebase
- At least one bug is in the interaction *between* modules, not in any single file
- At least one bug requires evaluating runtime expressions to discover (computed values, registries, encoded data)
- Significant noise: helper modules, config objects, utility functions that are correct
- The call graph is deep enough that mental simulation is impractical
- At least 2 bugs require runtime inspection

**Misdirection techniques:**
- A commented `# BUG?` or `# TODO: check this` near correct code
- A function with a subtle name suggesting it might be wrong (it isn't)
- An unused import or variable that looks suspicious
- A complex-but-correct algorithm next to a simple-but-wrong one

### Level 5 — Multiple Interacting Bugs, Runtime-Only Discovery
**Goal:** A realistic system with bugs that are impossible or near-impossible to find without runtime debugging. The source code alone doesn't contain enough information.

**Design rules:**
- 10-15 files, ~1500-2500 lines total
- 3-4 bugs, at least 2 requiring runtime inspection
- At least one value is derived from: encoded data, environment variables, computed registries, or dynamic dispatch
- At least one bug is a cross-module interaction that produces no error, just wrong output
- Significant misdirection: the most suspicious-looking code is correct
- Tests have non-obvious failure messages that don't point directly to the bug
- Essentially a mini real-world debugging session

**Required elements:**
- Runtime-computed values that can't be determined from source
- At least one intermediary transform that obscures the data flow
- A configuration or registry pattern where the registered values are constructed dynamically
- At least one "silent wrong" — a function returns the wrong value without any error

### Level 6 — Adversarial, Multi-System, Full Investigation
**Goal:** The hardest possible debugging challenge. A production-like system with interacting components, multiple bugs across different concern areas, and deliberate misdirection. Only solvable through systematic runtime investigation.

**Design rules:**
- 15-25 files, ~2500-4000 lines total
- 4-5 bugs across different concern areas (data layer, business logic, integration, output formatting, configuration)
- At least 3 bugs require runtime inspection — they cannot be found by reading source
- At least one bug is a *concurrency* or *ordering* issue (async races, event ordering, callback sequencing)
- At least one bug involves data flowing through 4+ function calls / 3+ files before manifesting
- At least one bug only triggers on specific input combinations (edge case intersection)
- The visible test exposes only 1-2 symptoms; the hidden validation has 10+ assertions
- Code includes realistic patterns: logging, error handling, config management, caching — some correct, some buggy
- Multiple plausible root causes for each symptom

**Required elements:**
- A realistic project structure with clear separation of concerns
- Runtime-computed values at multiple levels (not just one encoded config)
- At least one "ghost bug" — a bug whose symptom disappears if you add print/log statements (timing-dependent)
- Red herring modules that look complex and suspicious but work correctly
- A data flow that crosses at least 4 module boundaries
- Comments and naming that subtly mislead about the code's behavior

**What makes L6 different from L5:**
- Scale: nearly double the codebase size
- Bug count: 4-5 vs 3-4
- Interaction complexity: bugs compound and mask each other
- Misdirection: active (misleading comments, suspicious-but-correct code) vs passive (just large codebase)
- At least one concurrency/timing bug that resists static analysis
- The visible test catches fewer of the total bugs (1-2 out of 4-5)

---

## Timeout Scaling

| Level | Timeout | Files | Lines | Bugs |
|-------|---------|-------|-------|------|
| 1 | 300s | 2-4 | 200-300 | 1 |
| 2 | 360s | 4-6 | 400-600 | 2 |
| 3 | 420s | 6-8 | 600-1000 | 2-3 |
| 4 | 480s | 8-12 | 1000-1500 | 3 |
| 5 | 600s | 10-15 | 1500-2500 | 3-4 |
| 6 | 900s | 15-25 | 2500-4000 | 4-5 |
| 7 | 1500s | 25-40 | 4000-7000 | 5-7 (cross-language) |

---

## Cross-Language Scenario Strategy

Each language suite should have scenarios at every level. At higher levels (3+), scenarios become increasingly language-specific because the bugs exploit language-specific runtime behaviors.

### Shared-concept scenarios
Same bug *pattern* across languages, idiomatic to each runtime. Enable direct cross-language comparison.

- The conceptual bug pattern is identical (e.g., float precision, mutation before read)
- The code uses that language's idioms, standard library, and naming conventions
- Naming convention: use the same suffix across languages

### Language-specific scenarios
Bugs that exploit footguns unique to that language or runtime.

- The bug cannot exist (or would manifest completely differently) in other languages
- Higher levels (3+) are naturally more language-specific due to runtime interaction complexity

### Suite composition

| Level | Per language |
|-------|-------------|
| 1 | 2-3 scenarios |
| 2 | 2-3 scenarios |
| 3 | 2-3 scenarios |
| 4 | 1-2 scenarios |
| 5 | 1-2 scenarios |
| 6 | 1 scenario |

---

## Scenario Anatomy Checklist

Every scenario must have:

```
scenarios/<name>/
  scenario.json       # name, language, timeout, test commands, level
  prompt.md           # natural-language bug report — the agent's only evidence
  src/                # buggy source, CLAUDE.md, and a visible test that passes
  hidden/             # oracle validation test the agent never sees
```

### `scenario.json`

```json
{
  "scenario": {
    "name": "<name>",
    "language": "<python|node|typescript|go|rust|cpp|java>",
    "description": "<one-line description of the bug(s)>",
    "timeout_seconds": 300,
    "level": 1
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

### `src/CLAUDE.md`

Every scenario workspace must include a `CLAUDE.md` at `src/CLAUDE.md` (which lands at the workspace root after the harness copies `src/`). This is how the agent discovers the project — the same mechanism used in real projects.

It should contain:
- One-sentence description of what the system does
- List of files with a brief description of each
- How to run the tests (single command)

Keep it factual and structural. Do not describe what's broken, expected behavior, or anything that belongs in `prompt.md`.

**Example:**

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

### Prompt rules

The prompt is a **natural-language bug report**, written in the voice of whoever discovered the issue — a customer, an engineer, a product manager. It is the agent's only source of truth about what's wrong.

**Rules:**
- Write in plain, natural language — like a Slack message or support ticket, not documentation
- State what was expected and what actually happened, with concrete values where relevant: *"Alice's total should be $428.40 but shows $766.08"*
- Do not name files, entry points, or suggest where to look — let the agent read `CLAUDE.md` and explore
- Do not mention tests, test commands, or whether tests pass or fail
- Do not mention agent-lens, debugging tools, breakpoints, or any investigation strategy
- For multi-bug scenarios (L2+), describe the observable symptoms — not the number or nature of bugs
- 1-4 sentences is enough; more detail can make the task easier rather than more realistic

**Good example (L1):**
> Customers are complaining that their bill splits don't add up. When someone splits a $47.00 bill three ways with an 18% tip, the function gives everyone $18.49 but then reports the total as $55.46 — which is $0.01 less than the $55.47 the shares actually sum to.

**Bad example (tells the agent where to look and what to do):**
> The `split_bill` function in `bill.py` has a rounding bug. Set a breakpoint inside the function and inspect the intermediate values for a $47.00 / 3-person split. Run `python3 -m pytest test_bill.py -v` to verify your fix.

### Visible test rules

The visible test **must pass with the buggy code**. It cannot be used by the agent to find or confirm the bug. Its only role is to verify the agent didn't break unrelated functionality.

- Test paths or inputs that are **not affected** by the bug (different inputs, different code paths, structural/shape assertions)
- Must be runnable with a single command and pass before the agent runs (`visibleTestBefore` should always be `true`)
- Keep it minimal — one or two assertions is enough; this is a safety net, not a test suite

### Hidden test rules

- Validates ALL bugs are fixed with specific, tight assertions
- For multi-bug scenarios, has separate assertions per bug
- Must not depend on visible test state
- For L2+: should catch bugs the visible test's inputs would never exercise

### Source code rules

- Code should look realistic — not a toy example wrapped in a function
- Include enough surrounding code that bugs aren't the only interesting things in the file
- Variable names, function names, and structure should look like real production code
- For L2+, include correct-but-suspicious code as false leads
- For L4+, include realistic infrastructure: logging, config, error handling
- For L6, include a realistic project structure with multiple subsystems

---

## Supported Languages

| Language | `language` value | Runtime | Notes |
|----------|-----------------|---------|-------|
| Python | `python` | CPython 3.10+ | debugpy adapter |
| JavaScript (Node) | `node` | Node.js 20+ | js-debug adapter, plain `.js` with ES modules |
| TypeScript | `typescript` | Node.js 20+ / tsx | Separate suite from `node` |
| Go | `go` | Go 1.21+ | Delve adapter |
