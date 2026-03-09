---
name: agent-lens
description: >
  Agent Lens MCP tool reference. LOAD THIS SKILL before invoking any mcp__agent-lens__* tool.
  Covers the three tool namespaces (debug_*, browser_*, session_*), when to use each,
  common workflows, and pitfalls that cause wasted sessions or confusing errors.
---

# Agent Lens MCP Reference

**Load this skill before invoking any `mcp__agent-lens__*` tool.**

Agent Lens provides runtime debugging and browser recording via MCP. There are three distinct tool namespaces — picking the wrong one wastes time.

---

## Tool Namespaces

### `debug_*` — Code debugger (DAP)
Attaches a language debugger to a running process. Lets you set breakpoints, step through code, and inspect variables.

**Use when:** You want to debug Python, Node.js, Go, TypeScript, etc. — i.e., you have source code and want to step through it.

Tools: `debug_launch`, `debug_attach`, `debug_status`, `debug_continue`, `debug_step`, `debug_run_to`, `debug_set_breakpoints`, `debug_set_exception_breakpoints`, `debug_list_breakpoints`, `debug_evaluate`, `debug_variables`, `debug_stack_trace`, `debug_source`, `debug_output`, `debug_session_log`, `debug_watch`, `debug_threads`, `debug_stop`

**Do NOT use for:** Opening URLs in a browser. `debug_launch` runs shell commands — passing a URL will run it as a shell command and fail or produce garbage.

---

### `browser_*` — Browser recording (CDP)
Launches Chrome and passively records all browser events: navigation, network requests/responses, console output, user input, errors, and screenshots.

**Use when:** You want to observe what a web app does in a browser — reproduce a bug, record a user flow, capture network traffic.

Tools: `browser_start`, `browser_status`, `browser_mark`, `browser_stop`

**Do NOT use for:** Stepping through JavaScript source. For JS debugging, use `debug_attach` with Node.js/Chrome inspector.

---

### `session_*` — Browser session investigation (read-only)
Queries previously recorded browser sessions stored in the local database. All tools are read-only — they work on completed or active sessions.

**Use when:** Investigating what happened in a browser recording — finding errors, replaying events, diffing state, generating reproduction steps.

Tools: `session_list`, `session_overview`, `session_search`, `session_inspect`, `session_diff`, `session_replay_context`

---

## Common Workflows

### Record a browser interaction and investigate it

```
1. browser_start(url: 'http://localhost:3000', profile: 'agent-lens')
2. [user/agent does things in the browser]
3. browser_mark(label: 'saw the error')
4. browser_stop()
5. session_list()                          → find the session ID
6. session_overview(session_id: '...')    → timeline + errors
7. session_search(session_id: '...', status_codes: [422, 500])  → find bad requests
8. session_inspect(session_id: '...', event_id: '...')          → full detail
```

### Debug a Python/Node/Go program

```
1. debug_launch(command: 'python app.py', breakpoints: [{file: 'app.py', breakpoints: [{line: 42}]}])
2. debug_variables(session_id: '...')
3. debug_step(session_id: '...', direction: 'over')
4. debug_evaluate(session_id: '...', expression: 'my_var')
5. debug_stop(session_id: '...')
```

---

## Pitfalls

### 1. Don't pass URLs to `debug_launch`
`debug_launch(command: 'https://...')` will try to execute the URL as a shell command. Use `browser_start` for URLs.

### 2. Chrome conflict — existing instance without debug port
If Chrome is already running normally (no `--remote-debugging-port`), `browser_start()` without a `profile` may fail with a CDP connection error.

**Fix:** Always pass a `profile` to get an isolated instance:
```
browser_start(profile: 'agent-lens', url: 'http://localhost:3000')
```
This creates a separate Chrome with its own user-data-dir — no conflict with your regular browser.

Alternative (attach to existing Chrome):
```sh
# Kill existing Chrome, start fresh with debug port
pkill -f chrome
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/cdp-chrome
```
Then: `browser_start(attach: true)`

### 3. `browser_start` launches Chrome — no window visible in headless environments
If there's no display, Chrome will fail to start. Set `DISPLAY=:0` or use a virtual framebuffer (`Xvfb`) before calling `browser_start`. Alternatively, pass `attach: true` and start Chrome manually with `--headless=new`.

### 4. `session_*` tools require a recorded session
`session_list()` returns nothing if no sessions have been recorded yet. Run `browser_start` → interact → `browser_stop` first.

---

## Key Parameters

### `browser_start`
| Param | Default | Notes |
|-------|---------|-------|
| `url` | — | Open this URL when launching |
| `profile` | — | Isolated Chrome profile name. **Recommended to always set** to avoid conflicts |
| `attach` | `false` | Attach to existing Chrome (must have `--remote-debugging-port`) |
| `port` | `9222` | CDP port |
| `all_tabs` | `false` | Record all tabs (default: active tab only) |

### `debug_launch`
| Param | Default | Notes |
|-------|---------|-------|
| `command` | required | Shell command to run — NOT a URL |
| `language` | auto-detected | `python`, `node`, `go`, `typescript`, etc. |
| `breakpoints` | — | Set before execution starts |
| `stop_on_entry` | `false` | Pause on first line |

---

## After a CDP connection error from `browser_start`

The error response includes three fix options. In short:
- **Recommended:** `browser_start(profile: 'agent-lens')` — isolated instance, no conflicts
- **Manual:** `pkill -f chrome && google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/...`
- **Attach:** Start Chrome with the debug port, then `browser_start(attach: true)`
