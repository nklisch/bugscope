# Using Krometrail with OpenAI Codex

Krometrail gives Codex runtime debugging via the CLI. Include the skill file in the system prompt so Codex knows the available commands.

## Installation

```bash
npm install -g krometrail
# or
npx krometrail doctor  # check without installing globally
```

## Setup: System Prompt

Include the krometrail skill file in the system prompt:

```bash
# Print the skill file content
krometrail skill
```

Copy the output into your Codex system prompt. This gives Codex the exact command syntax and debugging strategy.

Alternatively, add a shorter reference:

```
You have access to `krometrail` for runtime debugging. Available commands:
- krometrail launch "<command>" [-b file:line]  # start debug session
- krometrail continue / step over|into|out      # control execution
- krometrail eval "<expression>"                # inspect values
- krometrail vars [--scope local|global]        # list variables
- krometrail break <file:line> [when <cond>]    # set breakpoints
- krometrail stop                               # end session
```

## Example Workflow

System prompt includes the skill file. User says:

> The `calculate_discount` function returns wrong values for gold tier customers. Debug it.

Codex will:

1. `krometrail launch "python3 -m pytest tests/ -k test_gold" -b discount.py:42`
2. `krometrail continue`
3. `krometrail eval "tier"`
4. `krometrail eval "tier_multipliers['gold']"`
5. `krometrail step into`
6. Identify the bug and explain it

## Tips for Codex

- **Parallel tool use**: Codex can run multiple `krometrail` commands in parallel using bash. For example, evaluate multiple expressions simultaneously.
- **Context management**: The viewport output is compact by design. Each stop shows ~400 tokens of context including source, locals, and stack.
- **Session persistence**: Sessions are managed by a background daemon. Codex can start a session and continue working in multiple turns.
- **Multiple sessions**: Use `--session <id>` to target a specific session when multiple are active.

## Verifying Setup

```bash
krometrail doctor
```

This checks which language adapters are installed. Codex should run this first when debugging a project to understand what languages are supported.
