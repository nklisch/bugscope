# Refactor Plan: Deduplication & Missing Abstractions

## Summary

The codebase has grown through three implementation phases and accumulated several patterns of duplicated logic. The two highest-impact areas are:

1. **CLI commands** — 16 commands repeat an identical try/catch/finally boilerplate pattern (~300 lines of mechanical repetition)
2. **Breakpoint mapping** — the same `Breakpoint -> DebugProtocol.SourceBreakpoint` transformation is written out 4 times in session-manager.ts

Secondary opportunities include consolidating the watch/unwatch CLI commands and extracting a reusable `withSession` guard in session-manager.ts.

## Refactor Steps

### Step 1: Extract `toSourceBreakpoints` helper

**Priority**: High
**Risk**: Low
**Files**: `src/core/session-manager.ts`

**Current State**: The mapping `(bp) => ({ line: bp.line, condition: bp.condition, hitCondition: bp.hitCondition, logMessage: bp.logMessage })` appears at lines 155-160, 354, 368, and 383-388. Any field added to the Breakpoint type must be updated in all 4 locations.

**Target State**: A single `toSourceBreakpoints(bps: Breakpoint[]): DebugProtocol.SourceBreakpoint[]` function defined at the top of the file (or in `src/core/types.ts`), called from all 4 locations.

**Approach**:
1. Add the helper function near the top of `session-manager.ts`
2. Replace all 4 inline `.map()` calls with `toSourceBreakpoints()`
3. Run tests

**Verification**:
- `bun run test:unit` passes
- `bun run lint` passes
- Grep confirms no remaining inline breakpoint mapping patterns

---

### Step 2: Extract CLI command runner wrapper

**Priority**: High
**Risk**: Low
**Files**: `src/cli/commands/index.ts`

**Current State**: Every CLI command (16 total) repeats this boilerplate:
```typescript
async run({ args }) {
    const mode = resolveOutputMode(args);
    const client = await getClient();
    try {
        const sessionId = await resolveSessionId(client, args.session);
        // ... 3-10 lines of actual logic ...
    } catch (err) {
        process.stderr.write(`${formatError(err as Error, mode)}\n`);
        process.exit(1);
    } finally {
        client.dispose();
    }
}
```

This is ~10 lines of boilerplate per command, totaling ~160 lines of pure repetition.

**Target State**: A `runCommand` helper that handles mode resolution, client lifecycle, session resolution, error formatting, and cleanup. Each command provides only its unique logic:

```typescript
async run({ args }) {
    await runCommand(args, async (client, sessionId, mode) => {
        const result = await client.call<ViewportPayload>("session.continue", { sessionId });
        process.stdout.write(`${formatViewport(result.viewport, mode)}\n`);
    });
}
```

An optional `{ needsSession: false }` flag for commands like `launch` that don't resolve a session ID upfront.

**Approach**:
1. Define `runCommand(args, handler, opts?)` in `commands/index.ts` (or a new `commands/runner.ts`)
2. Migrate 2-3 simple commands first (e.g., `status`, `continue`, `breakpoints`) to validate the pattern
3. Migrate remaining commands
4. Run all tests

**Verification**:
- `bun run test` passes (unit + integration + e2e)
- `bun run lint` passes
- Each command's `run` body is reduced to its unique logic (3-10 lines)
- Error handling behavior is unchanged (same stderr output, same exit code)

---

### Step 3: Consolidate watch/unwatch CLI commands

**Priority**: Medium
**Risk**: Low
**Files**: `src/cli/commands/index.ts`

**Current State**: `watchCommand` (lines 497-534) and `unwatchCommand` (lines 536-572) are near-identical — same arg parsing, same expression collection from `args._`, same output formatting. The only difference is the RPC method name (`session.watch` vs `session.unwatch`).

**Target State**: A single factory function `createWatchCommand(action: "watch" | "unwatch")` that returns the command definition, or a shared `runWatchAction` helper called by both.

**Approach**:
1. Extract shared logic into a helper
2. Reduce both commands to thin wrappers
3. Run tests

**Verification**:
- `bun run test` passes
- `bun run lint` passes
- Both `agent-lens watch` and `agent-lens unwatch` produce identical output as before

---

### Step 4: Extract `withSession` guard in SessionManager

**Priority**: Medium
**Risk**: Low
**Files**: `src/core/session-manager.ts`

**Current State**: 6 methods repeat the same 3-line preamble:
```typescript
const session = this.getSession(sessionId);
this.assertState(session, "stopped");
this.checkAndIncrementAction(session, "tool_name");
```

Lines: 295-297, 311-312 (partially), 342-344, 418-420, 453-455, 498-500.

**Target State**: A private `withStoppedSession(sessionId, toolName, fn)` method that encapsulates the guard and passes the session to the callback. Methods that need different state guards (e.g., `setBreakpoints` doesn't require "stopped") continue to use `getSession` directly.

**Approach**:
1. Add the helper method to `SessionManager`
2. Refactor `continue`, `runTo`, `evaluate`, `getVariables`, `getStackTrace` to use it
3. Leave `step` as-is since it has a loop structure that doesn't fit the pattern cleanly
4. Run tests

**Verification**:
- `bun run test:unit` passes
- `bun run lint` passes
- No behavioral changes — same errors thrown for wrong states, same action counting

---

### Step 5: Extract `threadId` accessor

**Priority**: Low
**Risk**: Low
**Files**: `src/core/session-manager.ts`

**Current State**: `session.lastStoppedThreadId ?? 1` appears at lines 299, 317, 358, 502, 648, 864. The fallback to `1` is a DAP convention (single-threaded programs) that should be documented in one place.

**Target State**: A private `getThreadId(session)` method or a getter on the session, with a comment explaining the DAP convention.

**Approach**:
1. Add `private getThreadId(session: DebugSession): number` method
2. Replace all 6 inline expressions
3. Run tests

**Verification**:
- `bun run test:unit` passes
- `bun run lint` passes

---

## Out of Scope

The following were considered but deferred:

- **MCP tool try/catch pattern**: The 16 MCP tools all wrap with `try { ... } catch (err) { return errorResponse(err); }`. This is mechanical but each tool's happy path is unique enough that extracting a wrapper adds indirection without much line savings. The `errorResponse` helper already centralizes the error formatting. Revisit if tool count grows significantly.

- **Socket connection utilities**: The Python adapter and daemon server have similar TCP connection patterns, but they differ enough in error handling and retry logic that a shared abstraction would be forced. Better to leave as-is until a second adapter (Node.js) is implemented and the pattern stabilizes.

- **Text column formatting**: `Math.max(...items.map(v => v.name.length), minWidth)` + `padEnd()` appears ~5 times across viewport.ts and session-manager.ts. This is idiomatic and extracting it into a utility adds more code than it saves.
