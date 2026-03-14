> **LEGACY — This document is outdated.** All phases described here are complete. See `docs/agents.md` for navigation guidance.

# Krometrail — Roadmap

Each phase is a self-contained deliverable with a clear "done" state. Phases are ordered by dependency — each builds on the previous. Steps within a phase can often be parallelized.

References to existing design docs are marked with `→ DOC.md#Section`.

---

## What Exists Today

The project scaffold is in place:
- **Complete:** Types + Zod schemas (`core/types.ts`), adapter interface (`adapters/base.ts`), adapter registry (`adapters/registry.ts`), DAP client with stream framing (`core/dap-client.ts`), viewport renderer (`core/viewport.ts`), MCP server entry with 2 stub tools (`mcp/`), CLI entry with `launch` command stub (`cli/`), vitest config, biome config, test fixtures
- **Stub only:** Python adapter, session manager, value renderer, remaining MCP tools, remaining CLI commands

---

## Phase 1: Core Debug Loop

**Goal:** An agent can launch a Python script via MCP, hit a breakpoint, see a viewport, step, evaluate expressions, and stop. The full debug loop works end-to-end against real debugpy.

**Design focus:** DAP session lifecycle, debugpy launch protocol, viewport construction from real DAP state, error handling for crashed/hung debugees.

### 1.1 — DAP Client Hardening

The DAP client (`core/dap-client.ts`) handles stream framing and request/response correlation. It needs:

- **Timeout support.** Requests should reject after a configurable timeout. A hung debugger should not block the agent forever.
- **Connection lifecycle.** Methods for `connect(host, port)`, `disconnect()`, and connection state tracking. Currently assumes streams are provided externally.
- **Initialization handshake.** Implement the DAP initialize → initialized → configurationDone sequence as a single `initialize()` method. The client should negotiate capabilities and store the server's `Capabilities` response.
- **Typed request helpers.** Convenience methods for the DAP requests we use: `setBreakpoints`, `configurationDone`, `continue`, `next`, `stepIn`, `stepOut`, `stackTrace`, `scopes`, `variables`, `evaluate`, `disconnect`, `terminate`. Each wraps `send()` with the correct command name and typed arguments.
- **Event promise helpers.** `waitForStop()` that returns a promise resolving on the next `stopped` or `terminated` event, with timeout. This is the core blocking primitive — the agent calls a tool, we issue a DAP command, then wait for the stop.

→ PRIOR_ART.md: mcp-dap-server's approach (simple message loop with event filtering) is the right model. Avoid mcp-debugger's proxy complexity.

**Tests:** Unit tests with a mock DAP server (in-memory stream pair). Test timeout, malformed messages, out-of-order responses, connection drops.

### 1.2 — Python Adapter

Implement `PythonAdapter` against real debugpy. → SPEC.md#Reference Adapters

- **`checkPrerequisites()`** — Spawn `python3 -m debugpy --version`, parse output. Return `installHint: "pip install debugpy"` if missing.
- **`launch(config)`** — Allocate a free port. Spawn `python3 -m debugpy --listen 0:{port} --wait-for-client {script} {args}`. Wait for debugpy's "listening" output on stderr. Return a `DAPConnection` with a TCP socket to `localhost:{port}`.
- **Port allocation** — Use port 0 (OS-assigned) and parse the actual port from debugpy's stderr output, or bind a temporary socket to get a free port then close it.
- **Process cleanup** — Track the child process. `dispose()` kills it. Handle SIGTERM/SIGINT to clean up on server shutdown.
- **Stderr capture** — Capture debugpy's own stderr (distinct from the debugee's stdout/stderr) for diagnostics.

**Tests:** Integration tests against real debugpy.
- Launch a simple Python script, verify DAP connection established.
- Set a breakpoint, continue, verify `stopped` event received.
- Get stack trace and variables, verify they match expected values.
- Evaluate an expression, verify result.
- Kill session, verify process cleaned up.
- Test with missing debugpy (should return clear error).

### 1.3 — Session Manager

The session manager orchestrates the debug lifecycle. → INTERFACE.md#Session Lifecycle, SPEC.md#Resource Limits

- **Session creation.** `launch()` selects an adapter (from registry by language or file extension), calls `adapter.launch()`, connects the DAP client, runs the initialization handshake, sets initial breakpoints, issues `configurationDone`, and optionally waits for `stop_on_entry`.
- **Session state machine.** States: `launching` → `running` ↔ `stopped` → `terminated`/`error`. Each tool call validates the session is in an appropriate state.
- **Action tracking.** Increment an action counter on every tool call. Enforce `max_actions_per_session`.
- **Timeout enforcement.** Session-level wall-clock timeout (`session_timeout_ms`). Per-step timeout (`step_timeout_ms`). Timer starts on launch, resets considerations on each action.
- **Viewport construction.** On every `stopped` event, build a `ViewportSnapshot` by querying DAP for stack trace, scopes, variables, and source. Pass to viewport renderer.
- **Source reading.** Read source files from disk to populate the viewport's source context. Cache file contents per session.
- **Multi-session support.** Map of `sessionId → DebugSession`. Generate unique session IDs. Enforce `max_concurrent_sessions`.
- **Cleanup.** `stop()` sends DAP `disconnect`/`terminate`, kills the debugee process, removes from session map. Cleanup on server shutdown for all active sessions.

→ PRIOR_ART.md: mcp-dap-server uses a single-session model for simplicity. We support multi-session from day one — agents may want to debug multiple test files concurrently. Their `getFullContext` pattern (query stack → scopes → variables in a single sweep after every stop) is the right model for viewport construction.

→ PRIOR_ART.md: debugger-mcp's `debugger_wait_for_stop` demonstrates the blocking event delivery model — the agent calls a tool, we block until the debugee stops. This is the synchronous approach we adopt (VISION.md Open Question #1).

**Tests:** Integration tests using the Python adapter.
- Full launch → breakpoint → step → evaluate → stop sequence.
- Session timeout triggers clean termination.
- Action limit triggers clean termination.
- Concurrent session limit enforced.
- Crash recovery: debugee segfaults, session transitions to `error`.

### 1.4 — Value Renderer

Transform raw DAP variable values into the compact viewport format. → UX.md#Value Rendering

- **Primitives.** Numbers, booleans, null/None rendered as-is.
- **Strings.** Quoted, truncated to `string_truncate_length` with `...` suffix.
- **Collections.** Type and length with preview: `[1, 2, 3, ... (47 items)]`. Preview first `collection_preview_items` elements.
- **Objects.** Type name with key fields: `<User: id=482, tier="gold">`. Render at configurable depth (`locals_max_depth`).
- **Nested rendering.** Recursive with depth tracking. At max depth, show type summary only.
- **DAP variable mapping.** DAP variables have `name`, `value` (string), `type` (string), `variablesReference` (int, >0 means expandable). Map `variablesReference > 0` to the expandable marker.
- **Special variable filtering.** Exclude language internals (`__builtins__`, `__proto__`, `__doc__`, etc.) from the default viewport. Keep them accessible via `debug_variables` with explicit scope.

→ PRIOR_ART.md: mcp-dap-server's `getFullContext` dumps ALL variables from ALL scopes with no truncation — this blows up token consumption on real programs. mcp-debugger's `get_local_variables` adds an `includeSpecial` flag to filter `__builtins__` and `__proto__`. We should filter by default and render compactly.

**Tests:** Unit tests with various DAP variable shapes — flat locals, nested objects, long strings, large arrays, deeply nested structures. Verify token count stays within budget.

### 1.5 — MCP Tool Implementation

Register all tools from INTERFACE.md and wire them to the session manager. → INTERFACE.md#MCP Tool Interface

Tools to implement (15 total):

**Session lifecycle (3):**
- `debug_launch` — Validate with Zod, delegate to session manager, return viewport or running status.
- `debug_stop` — Terminate session, return summary.
- `debug_status` — Return current state and viewport if stopped.

**Execution control (3):**
- `debug_continue` — DAP `continue`, wait for stop, return viewport.
- `debug_step` — DAP `next`/`stepIn`/`stepOut` based on `direction`, wait for stop, return viewport. Support `count` parameter (loop N steps).
- `debug_run_to` — Set temporary breakpoint at target location, continue, remove temp breakpoint on hit. Return viewport.

**Breakpoints (3):**
- `debug_set_breakpoints` — DAP `setBreakpoints` (replaces all in file). Support conditions, hit counts, log messages.
- `debug_set_exception_breakpoints` — DAP `setExceptionBreakpoints` with filter IDs.
- `debug_list_breakpoints` — Return all breakpoints across all files with hit counts.

**State inspection (4):**
- `debug_evaluate` — DAP `evaluate` in specified frame. Render result with value renderer.
- `debug_variables` — DAP `scopes` + `variables` for requested scope/frame. Filter by regex.
- `debug_stack_trace` — Full stack trace with optional source context per frame.
- `debug_source` — Read source file from disk, return numbered lines.

**Session intelligence (2, stubs for Phase 3):**
- `debug_watch` — Store expressions in session, evaluate on each stop. Stub: just store the list.
- `debug_action_log` — Return action history. Stub: return raw action list.

Each tool should:
- Validate inputs with Zod schemas
- Check session state (return clear error if session isn't in valid state for the operation)
- Include descriptive tool descriptions that guide agent usage
- Return viewport as plain text in the MCP `TextContent` response

→ PRIOR_ART.md: mcp-dap-server's key insight — `step` and `continue` automatically return full context on stop, eliminating separate `context` calls. We follow this pattern: every execution control tool returns the viewport.

→ PRIOR_ART.md: mcp-debugger's `set_breakpoint` description warns about non-executable lines: *"Setting breakpoints on structural, declarative lines may lead to unexpected behavior."* This kind of agent-facing guidance in tool descriptions is valuable. Include similar guidance in our tool descriptions.

→ PRIOR_ART.md: mcp-debugger exposes 19 tools, many requiring agents to understand DAP internals (`variablesReference`, `frameId`, scope hierarchies). Our 15-tool interface hides these concepts behind the viewport abstraction — the agent never needs to know about variablesReference.

**Tests:** E2E tests for each tool via MCP client. Use `@modelcontextprotocol/sdk` client to call tools against the running server. Verify viewport output format.

### 1.6 — Output Capture

Capture debugee stdout/stderr for `debug_output`. → INTERFACE.md#`debug_output`

- **Stream capture.** Intercept DAP `output` events (category: `stdout`, `stderr`, `console`). Buffer in session up to `max_output_bytes`.
- **`debug_output` tool.** Return captured output, filtered by stream and `since_action`.
- **Truncation.** When buffer exceeds limit, keep the tail (most recent output is most useful).

**Tests:** Launch a script that prints output, verify capture. Verify truncation at limit.

### 1.7 — Integration Test Suite

End-to-end tests proving the full MCP path works. → TESTING.md

- **Discount bug scenario.** Reproduce the canonical example from Appendix B — launch pytest, hit breakpoint, inspect locals, step into function, evaluate expression, identify root cause.
- **Exception tracing.** Script that raises an exception. Set exception breakpoint, catch it, inspect state.
- **Multi-step navigation.** Step over a loop, verify variables change on each iteration.
- **Session limits.** Verify timeout and action limit enforcement.
- **Error cases.** Launch with bad command, set breakpoint in nonexistent file, evaluate invalid expression.

**Done when:** An agent (or test harness acting as one) can debug the discount-bug fixture through to root cause identification using only MCP tool calls.

---

## Phase 2: CLI & Distribution

**Goal:** The CLI is a first-class interface with full command parity. An agent with bash access and the skill file can debug as effectively as one using MCP. Binary distribution works on Linux, macOS, and Windows.

**Design focus:** Session daemon architecture, CLI-to-daemon protocol, compiled binary concerns (Bun compile edge cases), skill file optimization.

### 2.1 — Session Daemon

The daemon persists debug sessions across sequential CLI commands. → INTERFACE.md#Session Daemon

- **Auto-start.** First `krometrail launch` starts the daemon if not running. The daemon is a background process running the same core as the MCP server.
- **Unix domain socket.** Listen on `$XDG_RUNTIME_DIR/krometrail.sock` (fallback: `~/.krometrail/krometrail.sock`). Simple JSON-RPC protocol over the socket (same message format as MCP tool calls).
- **Idle shutdown.** Daemon exits after configurable idle timeout (default: 60s) with no active sessions.
- **PID file.** Write PID to socket path + `.pid`. CLI checks PID file to detect stale daemons.
- **Health check.** CLI sends a ping before each command. If daemon is dead (stale PID), restart it.
- **Lifecycle logging.** Daemon logs to `~/.krometrail/daemon.log` for diagnostics.

### 2.2 — CLI Commands

Implement all CLI commands via citty, each calling the daemon over the socket. → INTERFACE.md#Command Reference

**Session lifecycle:**
- `krometrail launch "<command>" --break <file>:<line> [--stop-on-entry] [--language <lang>]`
- `krometrail stop [--session <id>]`
- `krometrail status [--session <id>]`

**Execution control:**
- `krometrail continue [--timeout <ms>]`
- `krometrail step over|into|out [--count <n>]`
- `krometrail run-to <file>:<line> [--timeout <ms>]`

**Breakpoints:**
- `krometrail break <file>:<line>[,<line>,...] [when <condition>] [hit <condition>] [log '<message>']`
- `krometrail break --exceptions <filter>`
- `krometrail break --clear <file>`
- `krometrail breakpoints`

**State inspection:**
- `krometrail eval "<expression>" [--frame <n>] [--depth <n>]`
- `krometrail vars [--scope local|global|closure|all] [--filter "<regex>"]`
- `krometrail stack [--frames <n>] [--source]`
- `krometrail source <file>[:<start>-<end>]`

**Session intelligence:**
- `krometrail watch "<expr>" ["<expr>" ...]`
- `krometrail log [--detailed]`
- `krometrail output [--stderr|--stdout] [--since-action <n>]`

**Utility:**
- `krometrail doctor` — Check installed debuggers, report versions and status.
- `krometrail --version`

**Flags available on all commands:**
- `--json` — Output structured JSON instead of viewport text.
- `--quiet` — Viewport only, no banners or session IDs.
- `--session <id>` — Target a specific session (required when multiple active).

**Breakpoint syntax parsing.** The CLI uses a compact string format for breakpoints: `"file:line when condition"`, `"file:line hit >=N"`, `"file:line log 'message'"`. Parse this into the structured `Breakpoint` type.

### 2.3 — Output Formatting

- **Viewport text mode.** Default output — the same plain text viewport from UX.md. Applied to all commands that return a viewport.
- **JSON mode.** `--json` flag outputs the structured JSON from INTERFACE.md#Output Formats. Every command returns the same JSON shape.
- **Quiet mode.** `--quiet` suppresses banners, session IDs, hints. Just the viewport or result.
- **Exit codes.** 0 = success, 1 = error, 2 = timeout. Consistent across all commands.

### 2.4 — Skill File

Ship `krometrail-skill.md` as a file agents can load. → UX.md#Agent Skill File

- Include in the npm package at a known path (`node_modules/krometrail/skill.md` or similar).
- `krometrail skill` command prints the skill file to stdout for easy piping.
- Test with Claude Code: load as a custom instruction, verify the agent can use the CLI effectively.

### 2.5 — Binary Distribution

- **`bun build --compile`** — Build single-file binaries for Linux (x64, arm64), macOS (x64, arm64), Windows (x64).
- **GitHub Releases.** CI workflow builds binaries on tag push, uploads to GitHub release.
- **npm publish.** `npx krometrail` and `bunx krometrail` work.
- **Version command.** `krometrail --version` prints version, Bun version, platform, and available adapters.

### 2.6 — Doctor Command

`krometrail doctor` checks the system for debugger availability.

- Run `checkPrerequisites()` on every registered adapter.
- Report: adapter name, status (available/missing), version if available, install hint if missing.
- Check Bun version, platform compatibility.
- Return exit code 0 if at least one adapter is available, 1 if none.

### 2.7 — CLI Test Suite

- **Command parsing tests.** Verify breakpoint syntax parsing, flag combinations.
- **Daemon lifecycle tests.** Start, idle shutdown, stale PID recovery, concurrent access.
- **E2E CLI tests.** Run the Appendix C scenario (INTERFACE.md) as an automated test: sequential shell commands against a real Python script.
- **Output format tests.** Verify `--json` produces valid JSON matching the schema. Verify `--quiet` omits banners.

**Done when:** The Appendix C CLI session (INTERFACE.md) can be reproduced as an automated test, and `bun build --compile` produces a working binary.

---

## Phase 3: Viewport Intelligence

**Goal:** The viewport becomes the primary differentiator — session logging, watch expressions, viewport diffing, and progressive compression make long debug sessions sustainable within agent context windows.

**Design focus:** Session log data model, diff algorithm for consecutive viewports, compression heuristics, watch expression lifecycle.

→ PRIOR_ART.md: No existing project implements watch expressions, session logging, viewport diffing, or progressive compression. These features are unique to Krometrail and represent the core differentiation (PRIOR_ART.md lesson #8: "no one has solved the token problem").

### 3.1 — Watch Expressions

Upgrade the stub from Phase 1 to full implementation. → UX.md#Watch Expressions in Viewport

- **`debug_watch` tool.** Add/remove expressions from the watch list. Persist per session.
- **Automatic evaluation.** On every stop, evaluate all watch expressions in the current frame via DAP `evaluate`. Include results in the viewport after locals.
- **Error handling.** If a watch expression fails to evaluate (out of scope, syntax error), show `<error: ...>` in the viewport rather than failing the entire stop.
- **`debug_unwatch` tool or parameter.** Allow removing expressions. Could be a separate tool or an `action: "add" | "remove"` parameter on `debug_watch`.

### 3.2 — Session Logging

The investigation log summarizes the debug session. → INTERFACE.md#`debug_action_log`, ARCH.md#Context Compression

- **Action recording.** On every tool call, record: action number, tool name, key parameters, timestamp, and a one-line summary of the result (e.g., "BP hit at order.py:147, discount=-149.97").
- **Key observation extraction.** When a viewport is returned, extract "interesting" observations: unexpected values (negative when positive expected?), variable changes since last stop, new stack frames.
- **Summary format.** Numbered list of actions with observations. → INTERFACE.md example log format.
- **Detailed format.** Includes full viewport snapshots for each action (for agents that want to re-derive context).
- **Periodic compression.** After every 10 actions, generate a compressed summary paragraph. Earlier entries collapse into the summary.

### 3.3 — Viewport Diffing

When consecutive stops are in the same function, show only what changed. → ARCH.md#Context Compression

- **Diff detection.** Compare current viewport to previous: same file, same function, same stack depth → eligible for diff mode.
- **Variable diffing.** Show only variables whose value changed. Report count of unchanged variables.
- **Stack diffing.** Show only new or removed frames.
- **Source diffing.** If the current line moved, shift the source window. If in the same range, omit source entirely.
- **Diff format.** The compact format from ARCH.md: `── STEP at order.py:148 (same frame) ──` with only changed variables.
- **Session config.** `diff_mode: boolean` on session. Default off for Phase 3, flip to default on after validation.

### 3.4 — Progressive Compression

As action count increases, automatically reduce viewport detail. → ARCH.md#Context Compression

- **Compression tiers.** Define thresholds:
  - Actions 1–20: Full viewport (default config).
  - Actions 21–50: Reduce `stack_depth` to 3, `string_truncate_length` to 80, `collection_preview_items` to 3.
  - Actions 51–100: Further reduce. Enable diff mode automatically.
  - Actions 100+: Minimal viewport — current location, changed variables only, watch expressions.
- **Override.** Agents can always use drill-down tools (`debug_variables`, `debug_evaluate`, `debug_stack_trace`) to get full detail regardless of compression level.
- **Transparency.** When compression kicks in, include a note in the viewport: `(compressed: action 35/200, use debug_variables for full locals)`.

### 3.5 — Token Budget Estimation

Not the full token-budget-awareness from the open questions, but a practical version:

- **Viewport token counter.** Estimate token count for each viewport (rough: chars / 4). Track cumulative tokens consumed by viewports in the session.
- **Include in session log.** `debug_action_log` reports total viewport tokens consumed. Helps agents reason about their remaining budget.
- **Include in `debug_status`.** Report `viewport_tokens_consumed` alongside action count and elapsed time.

**Done when:** A 50-action debug session produces compressed viewports that stay under token budget, and the session log accurately summarizes the investigation chain.

---

## Phase 4: Multi-Language

**Goal:** Node.js and Go adapters prove the adapter contract works for real. Cross-adapter tests verify that the viewport, session management, and all tools work identically regardless of language.

**Design focus:** Adapter-specific launch protocols, DAP dialect differences between debuggers, cross-language test matrix.

### 4.1 — Node.js Adapter

→ SPEC.md#Reference Adapters

→ PRIOR_ART.md: mcp-debugger vendors Microsoft's vscode-js-debug adapter (downloaded during install). Their Node.js support is alpha-quality. We use Node's built-in `--inspect-brk` which is simpler and doesn't require vendoring a separate adapter binary.

- **Launch protocol.** `node --inspect-brk={port} script.js`. Node's built-in inspector speaks DAP natively.
- **TypeScript support.** For `.ts` files, detect if `tsx`, `ts-node`, or `bun` should be used. Initially support `node --import tsx` or `bun run`.
- **Source maps.** Node inspector provides source-mapped locations. The adapter should handle the mapping transparently — viewport shows TypeScript source, not compiled JS.
- **Prerequisites.** Check `node --version`. Node 18+ required for stable inspector protocol.

**Tests:**
- Integration tests with `tests/fixtures/node/simple-loop.js`.
- Async/await debugging — verify stack trace is readable.
- TypeScript source maps — verify viewport shows `.ts` source.

### 4.2 — Go Adapter

→ SPEC.md#Reference Adapters

- **Launch protocol.** Start `dlv dap --listen :{port}` as a subprocess. Wait for "DAP server listening" on stderr. Connect TCP to the port. Send DAP `launch` request with `mode: "debug"` and program path.
- **Build step.** Go requires compilation. Delve handles this via `mode: "debug"` (compile and debug) vs `mode: "exec"` (pre-compiled binary). Support both.
- **Goroutine awareness.** Delve exposes goroutines as threads. Store thread metadata for future multi-threading support (Phase 5).
- **Prerequisites.** Check `dlv version`. Provide install hint: `go install github.com/go-delve/delve/cmd/dlv@latest`.

→ PRIOR_ART.md: mcp-dap-server's implementation is the reference for Delve integration. Their `debug` function shows the exact launch sequence.

**Tests:**
- Integration tests with `tests/fixtures/go/simple-loop.go`.
- Verify `dlv` builds and launches the program.
- Verify variables show Go types correctly.

### 4.3 — Cross-Adapter Test Matrix

Verify every MCP tool and CLI command produces equivalent behavior across all adapters.

- **Shared test scenarios.** Write fixture programs in Python, Node.js, and Go that have identical logic (simple loop, function calls, variable inspection). Run the same test sequence against each.
- **Viewport consistency.** Same program logic → same viewport structure (different type names/syntax, but same layout).
- **Breakpoint behavior.** Verify conditional breakpoints work across all adapters (this is a known pain point — not all debuggers support all condition types).

→ PRIOR_ART.md: debugger-mcp's 5 languages × 2 agents = 10 test matrix is the model. Our cross-adapter matrix tests the same scenarios against Python, Node.js, and Go to verify viewport consistency.

**Done when:** The same 10 e2e test scenarios pass against Python, Node.js, and Go adapters with consistent viewport output.

---

## Phase 5: Advanced Debugging

**Goal:** Conditional breakpoints, exception breakpoints, logpoints, attach mode, and multi-threaded debugging. These are features human debuggers use daily that make the agent significantly more capable.

**Design focus:** DAP capability negotiation (not all debuggers support all features), thread selection UX in viewport, attach discovery mechanism.

### 5.1 — Conditional Breakpoints & Logpoints

→ SPEC.md#Breakpoint Type

→ PRIOR_ART.md: mcp-debugger lists conditional breakpoints and expression evaluation as "in progress" — these are harder than they look. mcp-dap-server's capability-gating pattern is useful here: only advertise features the underlying debugger actually supports.

- **Conditional breakpoints.** `condition` field on breakpoints. Verify behavior across all adapters (debugpy, node inspector, delve). Document which adapters support which condition syntax.
- **Hit count breakpoints.** `hit_condition` field. Break after N hits. Useful for loop debugging.
- **Logpoints.** `log_message` field. Log to output without breaking. Supports `{expression}` interpolation. Captured by `debug_output`.
- **Verification.** DAP may adjust breakpoint lines or reject conditions. Report verified vs requested in `debug_set_breakpoints` response.

### 5.2 — Exception Breakpoints

→ INTERFACE.md#`debug_set_exception_breakpoints`

- **Filter discovery.** On adapter initialization, query DAP for supported exception filters via `exceptionBreakpointFilters` capability.
- **Python:** `raised` (all exceptions), `uncaught` (unhandled only), `userUnhandled`.
- **Node.js:** `all`, `uncaught`.
- **Go:** Delve's exception support is limited; document constraints.
- **Viewport on exception.** When stopped on an exception, include exception type and message in the viewport header.

### 5.3 — Attach Mode

→ SPEC.md#AttachConfig

→ PRIOR_ART.md: mcp-debugger has `attach_to_process` and `detach_from_process` as separate tools. mcp-dap-server supports attach via the unified `debug` tool's `mode: "attach"` parameter. dap-mcp uses config-driven attach via the JSON config file. We follow mcp-dap-server's approach: attach is a mode of `debug_launch`, not a separate tool.

- **Attach by PID.** `debug_launch` with `attach: { pid: 12345 }` instead of `command`.
- **Attach by port.** Connect to an already-listening debug server.
- **Python attach.** debugpy supports `attach` request with `processId` or `connect` with host/port.
- **Node.js attach.** `node --inspect={port}` (without `--brk`) starts a debug-ready process. Attach via DAP.
- **Go attach.** `dlv attach {pid}` or `dlv connect {addr}`.
- **CLI syntax.** `krometrail attach --pid 12345` or `krometrail attach --port 5678`.

### 5.4 — Multi-Threaded Debugging

→ VISION.md#Open Questions (question 2)

→ PRIOR_ART.md: mcp-dap-server exposes `threadId` parameters on `step`, `continue`, `pause`, and `evaluate`. Their approach is straightforward — thread selection is a parameter, not a separate tool. We adopt this but add a `debug_threads` listing tool for discoverability.

- **Thread listing.** New `debug_threads` tool returns all threads with IDs and names.
- **Thread selection.** `thread_id` parameter on `debug_step`, `debug_continue`, `debug_evaluate`. Defaults to the stopped thread.
- **Viewport thread indicator.** When multiple threads exist, show active thread in viewport header: `── STOPPED at order.py:147 (process_order) [Thread 1 of 4] ──`.
- **All-threads-stopped mode.** When one thread hits a breakpoint, show which threads are running vs stopped.

**Done when:** Conditional breakpoints, exception breakpoints, and logpoints work across all adapters. Attach mode works for Python and Node.js. Multi-threaded debugging works for Go (goroutines).

---

## Phase 6: Framework Detection

**Goal:** Agents can debug test failures and web requests without manually configuring the debugger. `krometrail launch "pytest tests/"` just works.

**Design focus:** Detection heuristics, framework-specific configuration injection, test isolation.

### 6.1 — Test Framework Detection

→ PRIOR_ART.md: AIDB's framework auto-detection

Detect and configure test frameworks automatically when the command includes a test runner:

- **pytest.** Detect `pytest` or `python -m pytest` in command. Configure debugpy to work with pytest's process model (pytest may spawn subprocesses). Handle `--forked` and `xdist` modes.
- **jest.** Detect `jest` or `npx jest`. Configure node inspector to work with Jest's worker processes. Handle `--runInBand` (single process) vs default (workers).
- **go test.** Detect `go test`. Configure Delve to build and debug the test binary.
- **mocha.** Detect `mocha` or `npx mocha`. Launch with `--inspect-brk`.

### 6.2 — Web Framework Detection

Detect web frameworks and configure attach-friendly debug sessions:

- **Django.** Detect `manage.py runserver`. Configure debugpy attach.
- **Flask.** Detect `flask run`. Configure debugpy with `use_reloader=False` (debugpy and Flask's reloader conflict).
- **Express/Fastify.** Detect common entry patterns. Launch with `--inspect`.

### 6.3 — Framework Configuration API

- **`debug_launch` enhancement.** New optional `framework` parameter for explicit framework selection.
- **Auto-detection as default.** When no `framework` is specified, analyze the command string and working directory to detect the framework.
- **Override mechanism.** Agents can disable auto-detection with `framework: "none"`.

**Done when:** `krometrail launch "pytest tests/test_order.py -x" --break order.py:147` works without any framework-specific agent configuration.

---

## Phase 7: Ecosystem & Polish

**Goal:** External contributors can add language adapters. Performance is measured and optimized. The project is well-documented and easy to adopt.

### 7.1 — Adapter SDK

- **`create-krometrail-adapter` scaffold.** CLI command or template repo that generates a new adapter project with the interface, build config, and test harness.
- **Adapter test harness.** A shared test suite that any adapter can run to verify conformance. Provides fixture programs and expected behaviors.
- **Adapter documentation.** Step-by-step guide: identify debugger, implement interface, register, test.

### 7.2 — Additional Language Adapters

Community or first-party adapters for:

→ PRIOR_ART.md: mcp-debugger vendors CodeLLDB during install with a dedicated download script. debugger-mcp uses Docker containers with pre-installed debuggers. We should support both: download-on-demand for local dev, Docker for CI.

- **Rust** via CodeLLDB. Requires adapter binary download (similar to mcp-debugger's vendoring approach).
- **Java** via java-debug-adapter. Requires JDK and the debug adapter JAR.
- **C/C++** via GDB's `--interpreter=dap` mode (GDB 14+) or LLDB DAP.

### 7.3 — Performance Benchmarking

- **Tokens per session.** Measure viewport token consumption across different program complexities and step counts.
- **Time to diagnosis.** Benchmark how many actions it takes to reach root cause for known bugs (discount bug, null reference, off-by-one).
- **Latency.** Measure round-trip time for each tool call (launch, step, evaluate). Identify bottlenecks.
- **Comparison.** Run the same scenarios against mcp-debugger and mcp-dap-server. Quantify the token savings from viewport compression.

→ PRIOR_ART.md (lesson #8): Every existing project returns raw DAP state with no token awareness. This benchmark should quantify the difference — how many tokens does a 10-action debug session consume with Krometrail vs raw DAP output?

### 7.4 — Agent Integration Testing

→ PRIOR_ART.md: debugger-mcp's approach (real Claude Code/Codex tests)

- **Claude Code integration test.** Load the skill file, give Claude Code a buggy program, verify it uses krometrail to diagnose the bug.
- **MCP discovery test.** Configure krometrail as an MCP server, verify Claude Code discovers and uses the tools without a skill file.
- **Success criteria.** Agent identifies root cause in the discount-bug fixture within 10 actions, using < 5000 viewport tokens.

### 7.5 — Documentation & Guides

- **Integration guide for Claude Code.** MCP config, skill file setup, example workflow.
- **Integration guide for Codex.** System prompt addition, CLI usage.
- **Integration guide for Cursor/Windsurf.** MCP config for IDE-based agents.
- **Troubleshooting guide.** Common issues: debugger not found, port conflicts, permission errors, timeout tuning.

### 7.6 — launch.json Compatibility

→ PRIOR_ART.md: AIDB's launch.json reuse

- **Import VS Code launch configurations.** Parse `.vscode/launch.json`, translate relevant fields to `debug_launch` parameters.
- **`krometrail launch --config .vscode/launch.json --name "Python: Current File"`** — select a named configuration.
- **Auto-discovery.** If a `.vscode/launch.json` exists in the working directory, `krometrail doctor` reports available configurations.

**Done when:** A new contributor can add a language adapter using the SDK, performance is benchmarked against competitors, and integration guides exist for major agent platforms.

---

## Phase 8: Additional Language Adapters

**Goal:** Ruby, C#, Swift, and Kotlin adapters extend Krometrail to cover the remaining major language ecosystems.

→ designs/phase-8-ruby-csharp-swift-kotlin.md

---

## Phase 9: Browser Lens — CDP Recorder

**Goal:** Krometrail gains passive browser recording. A daemon connects to Chrome via CDP, captures network, console, DOM, and user input events into a rolling buffer, and persists evidence around user-placed markers. The human drives the browser; the system records everything.

**Design focus:** CDP connection lifecycle, event normalization, rolling buffer with marker-triggered persistence, input tracking via minimal page injection, auto-detection of anomalies (4xx/5xx, unhandled exceptions).

→ designs/phase-9-browser-cdp-recorder.md

### 9.1 — CDP Connection Manager
### 9.2 — Event Normalization Pipeline
### 9.3 — Rolling Buffer
### 9.4 — User Input Tracker
### 9.5 — Marker System (CLI + Hotkey + Auto-detect)
### 9.6 — Browser Launch Wrapper
### 9.7 — Integration Test Suite

---

## Phase 10: Browser Lens — Storage & Persistence

**Goal:** Marker-triggered persistence writes browser session evidence to disk. SQLite indexes events for fast investigation queries. Network response bodies and screenshots are stored separately for on-demand loading.

**Design focus:** SQLite schema design, JSONL append-only event storage, byte-offset references for random access, marker-triggered flush pipeline, screenshot capture, token budget utility extraction.

→ designs/phase-10-browser-storage.md

### 10.1 — SQLite Schema & JSONL Storage
### 10.2 — Marker-Triggered Persistence Pipeline
### 10.3 — Network Body Extraction & Storage
### 10.4 — Screenshot Capture
### 10.5 — Retention & Cleanup Policies
### 10.6 — Token Budget Utility Extraction

---

## Phase 11: Browser Lens — Investigation MCP Tools

**Goal:** Agents can investigate recorded browser sessions through 4 MCP tools: list sessions, get overviews, search events, and inspect specific moments. Token-budgeted renderers present evidence compactly.

**Design focus:** MCP tool schemas alongside existing debug_* tools, browser-specific viewport renderers with token budgeting, FTS5 full-text search across event summaries and network bodies, CLI investigation commands.

→ designs/phase-11-browser-investigation-tools.md

### 11.1 — session_list Tool
### 11.2 — session_overview Tool
### 11.3 — session_search Tool
### 11.4 — session_inspect Tool
### 11.5 — Browser Viewport Renderers
### 11.6 — CLI Investigation Commands
### 11.7 — Investigation E2E Tests

---

## Phase 12: Browser Lens — Intelligence

**Goal:** Advanced investigation tools: diff two moments in a session, generate reproduction contexts and test scaffolds, smart auto-detection rules, and HAR export for interop with existing tools.

**Design focus:** Session diff algorithm, reproduction step generation, test scaffold templates (Playwright/Cypress), expanded auto-detection heuristics, SKILL.md for coding agents.

→ designs/phase-12-browser-intelligence.md

### 12.1 — session_diff Tool
### 12.2 — session_replay_context Tool
### 12.3 — Smart Auto-Detection Rules
### 12.4 — Test Scaffold Generation
### 12.5 — HAR Export
### 12.6 — Browser Lens SKILL.md

---

## Phase 14: Framework State — Detection & Infrastructure

**Goal:** Automatically detect React, Vue, Solid, and Svelte on any page. Establish the `FrameworkTracker` class, new event types (`framework_detect`, `framework_state`, `framework_error`), and config-gated injection via `features.frameworkState` on `chrome_start`.

→ framework-state/ROADMAP.md, framework-state/APPROACH.md

### 14.1 — Event Type Extension
### 14.2 — Config Schema Extension
### 14.3 — FrameworkTracker Class
### 14.4 — Framework Detection Script
### 14.5 — Auto-Detection Rule Integration

---

## Phase 15: Framework State — React Observer

**Goal:** Full React state observation — fiber tree walking, hooks linked list parsing, commit diffing, stale closure / infinite re-render / missing cleanup detection.

→ framework-state/react/SPEC.md, INTERFACE.md, ARCH.md

### 15.1 — React Hook Shim
### 15.2 — Fiber Tree Walker
### 15.3 — State Extraction
### 15.4 — Commit Diffing & Event Generation
### 15.5 — React Bug Pattern Detectors
### 15.6 — React E2E Tests

---

## Phase 16: Framework State — Vue Observer

**Goal:** Vue 2 + Vue 3 component lifecycle tracking, reactivity observation, Pinia/Vuex store integration, and reactivity gotcha detection.

→ framework-state/vue/SPEC.md, INTERFACE.md, ARCH.md

### 16.1 — Vue Hook Shim
### 16.2 — Component Tree Walker
### 16.3 — State Extraction
### 16.4 — Store Integration
### 16.5 — Vue Bug Pattern Detectors
### 16.6 — Vue E2E Tests

---

## Phase 17: Framework State — Investigation Integration

**Goal:** Investigation tools understand framework events natively. Search by component name, filter by framework, see framework context in diffs. Completes the React + Vue feature set end-to-end.

→ framework-state/ROADMAP.md#Phase 17

### 17.1 — Query Engine Framework Filters
### 17.2 — Framework-Aware Renderers
### 17.3 — Framework Context in Diffs

---

## Phase 18: Framework State — Solid Observer (Tier 2, future)

**Goal:** Signal and store observation for SolidJS dev-mode builds. Requires DEV hooks access — not available in production. Graceful degradation to DOM observation.

→ framework-state/solid/SPEC.md, INTERFACE.md, ARCH.md

### 18.1 — Solid Detection & DEV Access
### 18.2 — Signal & Store Observation
### 18.3 — Ownership Tree & Component Attribution
### 18.4 — Solid Bug Pattern Detectors

---

## Phase 19: Framework State — Svelte Observer (Tier 3, future)

**Goal:** Svelte 4 observation via `$$invalidate` interception and `$capture_state()`. Svelte 5 fallback to DOM heuristics until sveltejs/svelte#11389 ships devtools hooks.

→ framework-state/svelte/SPEC.md, INTERFACE.md, ARCH.md

### 19.1 — Svelte Detection & Version Branching
### 19.2 — Svelte 4 Observer
### 19.3 — Svelte 5 Fallback
### 19.4 — Svelte Bug Pattern Detectors

---

## Dependency Graph

```
Phase 1: Core Debug Loop
    │
    ├── Phase 2: CLI & Distribution (needs working core)
    │
    └── Phase 3: Viewport Intelligence (needs working sessions)
            │
            └── Phase 4: Multi-Language (needs stable viewport)
                    │
                    ├── Phase 5: Advanced Debugging (needs multi-lang for testing)
                    │
                    ├── Phase 6: Framework Detection (needs multi-lang)
                    │
                    ├── Phase 7: Ecosystem (needs everything stable)
                    │
                    └── Phase 8: Additional Language Adapters
                            │
                            └── Phase 9: Browser CDP Recorder
                                    │
                                    └── Phase 10: Browser Storage
                                            │
                                            └── Phase 11: Browser Investigation Tools
                                                    │
                                                    └── Phase 12: Browser Intelligence
                                                            │
                                                            └── Phase 14: Framework Detection & Infra
                                                                    │
                                                                    ├── Phase 15: React Observer  ─┐
                                                                    │                              ├→ Phase 17: Investigation
                                                                    └── Phase 16: Vue Observer    ─┘
                                                                                                    │
                                                                                                    ├── Phase 18: Solid (Tier 2, future)
                                                                                                    └── Phase 19: Svelte (Tier 3, future)
```

Phases 2 and 3 can run in parallel after Phase 1. Phases 5, 6, 7, and 8 can run in parallel after Phase 4.
Phases 9–12 are sequential (each builds on the previous). Phase 9 can start after Phase 7 (stable ecosystem)
but has no dependency on Phase 8 (additional language adapters).
Phases 15 and 16 can run in parallel after Phase 14. Phase 17 completes the React + Vue feature set.
Phases 18 and 19 are future work — lower priority, can start after Phase 14.

---

## Decision Log

Decisions made during roadmap planning, for reference:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Phase 1 language | Python only | Most common agent debugging target, debugpy is well-documented |
| CLI daemon protocol | JSON-RPC over Unix socket | Simple, no HTTP overhead, familiar pattern |
| Viewport diff trigger | Same file + same function | Conservative — avoids confusing diffs across unrelated frames |
| Progressive compression tiers | 4 tiers at 20/50/100 actions | Matches typical debug session lengths, leaves room for override |
| Framework detection phase | Phase 6 (late) | Nice-to-have, not core. Agents can configure manually until then |
| Adapter SDK phase | Phase 7 (last) | Need stable adapter contract first. Community contributions depend on this |
| Browser Lens integration | Unified Lens (Option A) | Single MCP server with both debug_* and session_* tools. Shared infra, independent lifecycles |
| Browser adapter interface | Separate subsystem, not DebugAdapter | CDP recording is passive timeline, not interactive DAP. Different enough to warrant its own module |
| Browser viewport engine | Separate renderers, shared token-budget utility | Don't generalize renderViewport(). Extract estimateTokens + fitToBudget to core/token-budget.ts |
| Browser storage | SQLite + JSONL with byte-offset references | SQLite for queries, JSONL for raw events, byte offsets for O(1) event lookup |
| Browser data location | ~/.krometrail/browser/ | Lives under krometrail, not separate ~/.browser-lens/ |
| Input tracking approach | console.debug('__BL__', ...) | Piggybacks on Runtime.consoleAPICalled, no separate polling mechanism |
| Framework state: React + Vue first | Tier 1 | Mature global hooks, passive detection, work in production builds |
| Framework state: Solid as Tier 2 | Requires dev builds | DEV hooks stripped in production. No global hook — harder passive detection |
| Framework state: Svelte as Tier 3 | Svelte 5 hooks missing | sveltejs/svelte#11389 unresolved. Svelte 4 doable, Svelte 5 is DOM-only fallback |
| Framework state: same __BL__ channel | Reuse existing pipeline | No new transport. Framework events are new types in the same stream |
| Framework state: config-gated | features.frameworkState | Keeps install lightweight. Agents not debugging frontend skip framework tools |
| Framework state: no new MCP tools | Extend existing search/inspect | Framework events queryable through existing investigation tools. Avoids tool sprawl |
