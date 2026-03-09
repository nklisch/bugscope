# Agent Lens

**Runtime debugging for AI coding agents.**

Agent Lens is an MCP server and CLI that gives AI coding agents the ability to set breakpoints, step through code, and inspect runtime state. It bridges the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) to the [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) (DAP), wrapping raw debugger state in a compact viewport optimized for LLM consumption.

## Supported Languages

| Language | Debugger | Adapter | Status |
|----------|----------|---------|--------|
| Python | debugpy | TCP | Stable |
| Node.js | js-debug | TCP | Stable |
| Go | Delve | TCP | Stable |
| Rust | CodeLLDB | TCP | Stable |
| Java | java-debug-adapter | TCP | Stable |
| C/C++ | GDB 14+ / lldb-dap | stdio | Stable |

## Quick Start

### MCP Server

Add to your agent's MCP config (e.g. Claude Code `settings.json`):

```json
{
  "mcpServers": {
    "agent-lens": {
      "command": "bunx",
      "args": ["agent-lens", "--mcp"]
    }
  }
}
```

### CLI

```bash
# Launch a program and break at a specific line
agent-lens launch "python app.py" --break order.py:147

# Step through and inspect
agent-lens step over
agent-lens eval "discount"
agent-lens vars --scope local

# Continue and stop
agent-lens continue
agent-lens stop
```

### Skill File

Install the agent skill for CLI-based workflows:

```bash
agent-lens skill          # Print skill to stdout
skilltap install ./skill  # Or install via skilltap
```

## MCP Tools

Agent Lens exposes 18 tools over MCP, each with a matching CLI command:

| Tool | Description |
|------|-------------|
| `debug_launch` | Launch a program with initial breakpoints |
| `debug_attach` | Attach to a running process |
| `debug_stop` | Terminate the debug session |
| `debug_status` | Query session state and capabilities |
| `debug_continue` | Resume execution until next breakpoint |
| `debug_step` | Step over, into, or out |
| `debug_run_to` | Run to a specific line |
| `debug_set_breakpoints` | Set breakpoints with conditions, hit counts, logpoints |
| `debug_set_exception_breakpoints` | Filter by exception type |
| `debug_list_breakpoints` | List all active breakpoints |
| `debug_evaluate` | Evaluate an expression in the current frame |
| `debug_variables` | Inspect variables by scope with regex filtering |
| `debug_stack_trace` | Get the full call stack |
| `debug_source` | Read source code around a location |
| `debug_watch` | Add/remove persistent watch expressions |
| `debug_action_log` | Review the investigation log |
| `debug_output` | Capture stdout/stderr |
| `debug_threads` | List threads, goroutines, etc. |

## Features

- **Compact viewport** — debugger state rendered in ~400 tokens per stop, optimized for LLM context windows
- **Drill-down on demand** — agents expand only what they need (variables, stack frames, source)
- **Conditional breakpoints** — `order.py:147 when discount < 0`, hit counts (`>=100`), logpoints
- **Watch expressions** — persistent expressions auto-evaluated on every stop
- **Session logging** — full investigation history with compression and diffing
- **Framework detection** — auto-detects pytest, Django, Flask, jest, mocha, go test
- **Attach mode** — connect to running processes (debugpy socket, Node inspector, Delve PID)
- **Multi-threaded** — thread/goroutine listing and selection
- **Output capture** — stdout/stderr with action-based filtering

## Development

```bash
bun install              # Install dependencies
bun run dev              # Run CLI in dev mode
bun run mcp              # Run MCP server
bun run build            # Compile single binary
bun run build:all        # Build for all platforms (Linux, macOS, Windows)
```

### Testing

```bash
bun run test             # All tests
bun run test:unit        # Unit tests (no external deps)
bun run test:integration # Integration tests (needs debuggers)
bun run test:e2e         # E2E tests (full MCP path)
bun run test:agent       # Agent harness scenarios
```

Integration and E2E tests require debuggers to be installed. Run `agent-lens doctor` to check availability. Tests skip cleanly per-adapter when a debugger is not found.

### Agent Harness

The agent harness (`tests/agent-harness/`) is a scenario-based test suite for evaluating how well agents debug with Agent Lens. It contains 35 scenarios across 3 languages at 5 difficulty levels:

- **Python** — 12 scenarios (closure bugs, mutation errors, float accumulation, deep pipelines)
- **Node.js** — 11 scenarios (async races, event loop ordering, regex state, `this` binding)
- **TypeScript** — 12 scenarios (type assertion escapes, generic constraints, runtime registries)

```bash
bun run test:agent          # Run scenarios
bun run test:agent:report   # Generate report with token/cost metrics
```

### Linting

```bash
bun run lint             # Check with Biome
bun run lint:fix         # Auto-fix
```

## Architecture

```
src/
  mcp/          MCP server + 18 tool handlers
  cli/          CLI entry point + commands (citty)
  core/         Session manager, viewport renderer, DAP client, compression
  adapters/     Language-specific debugger adapters (6 languages)
  daemon/       Session persistence over Unix socket
  frameworks/   Auto-detection for test/web frameworks
```

The MCP server and CLI share the same core — the session manager orchestrates DAP communication, the viewport renderer formats state for agents, and adapters handle language-specific debugger setup. The CLI uses a session daemon for state persistence across commands.

## Documentation

| Document | Contents |
|----------|----------|
| [VISION.md](docs/VISION.md) | Problem statement, prior art, roadmap |
| [ARCH.md](docs/ARCH.md) | System layers, data flow, viewport rendering |
| [UX.md](docs/UX.md) | Viewport abstraction, agent interaction patterns |
| [SPEC.md](docs/SPEC.md) | Adapter contract, type definitions |
| [INTERFACE.md](docs/INTERFACE.md) | MCP tool + CLI command reference |
| [TESTING.md](docs/TESTING.md) | Testing philosophy and tiers |

## License

MIT
