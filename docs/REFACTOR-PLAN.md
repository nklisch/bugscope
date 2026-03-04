# Refactor Plan: Post-Phase 5 Consolidation

## Summary

After five implementation phases, the codebase has accumulated structural duplication concentrated in three areas:

1. **Adapter layer** — All three adapters (Python, Node, Go) duplicate identical `dispose()` cleanup logic and similar `checkPrerequisites()` patterns. The Node adapter hand-rolls readiness detection that Go already uses via `spawnAndWait()`.
2. **Entry points** — Three entry points (MCP, daemon entry, daemon server) repeat identical adapter registration and session manager initialization.
3. **MCP tools** — The viewport config snake_case→camelCase mapping is duplicated between `debug_launch` and `debug_attach`, and the breakpoint schema is defined separately in both `mcp/tools/index.ts` and `daemon/protocol.ts`.

Previous refactor plan items (Steps 1–5) have all been completed: `toSourceBreakpoints`, `runCommand` wrapper, `withStoppedSession`, and `getThreadId` are in place.

## Refactor Steps

### Step 1: Extract `gracefulDispose` helper for adapters

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/python.ts`, `src/adapters/node.ts`, `src/adapters/go.ts`

**Current State**: All three adapters have identical `dispose()` bodies (~19 lines each, ~57 lines total):
```typescript
if (this.socket) { this.socket.destroy(); this.socket = null; }
if (this.process) {
    const proc = this.process;
    this.process = null;
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 2_000);
        proc.once("close", () => { clearTimeout(timeout); resolve(); });
    });
}
```
The only difference is the process field name (`process`, `adapterProcess`, `dlvProcess`).

**Target State**: A `gracefulDispose(socket, process)` function in `helpers.ts`. Each adapter's `dispose()` becomes a one-liner.

**Approach**:
1. Add `gracefulDispose(socket: Socket | null, process: ChildProcess | null): Promise<void>` to `helpers.ts`
2. Replace all three `dispose()` bodies with calls to it
3. Run tests

**Verification**:
- `bun run test:unit` passes
- `bun run test:integration` passes (these exercise real debugger cleanup)
- `bun run lint` passes

---

### Step 2: Migrate Node adapter to use `spawnAndWait`

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/node.ts`, `src/adapters/helpers.ts`

**Current State**: The Node adapter hand-rolls readiness detection in both `launch()` (lines 80-112) and `attach()` (lines 146-163) — manually listening for `/listening/i` on stdout/stderr with timeout logic. The Go adapter already uses the shared `spawnAndWait()` helper for the same pattern.

**Target State**: Node adapter's `launch()` and `attach()` use `spawnAndWait()` with `readyPattern: /listening/i`, matching Go's pattern. The Python adapter uses a different flow (earlyError detection + TCP polling) so it stays as-is.

**Approach**:
1. Replace Node `launch()` readiness detection with `spawnAndWait({ cmd: "node", args: [dapAdapterPath, ...], readyPattern: /listening/i, ... })`
2. Replace Node `attach()` readiness detection similarly
3. Run integration tests with Node adapter

**Verification**:
- `bun run test:integration` passes (Node-specific tests)
- `bun run lint` passes
- Node adapter `launch()` and `attach()` reduced by ~30 lines combined

---

### Step 3: Extract `registerAllAdapters` and `createSessionManager`

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/registry.ts`, `src/core/session-manager.ts`, `src/mcp/index.ts`, `src/daemon/entry.ts`, `src/daemon/server.ts`

**Current State**: Three entry points repeat identical setup:
```typescript
registerAdapter(new PythonAdapter());
registerAdapter(new NodeAdapter());
registerAdapter(new GoAdapter());
const limits = ResourceLimitsSchema.parse({});
const sessionManager = new SessionManager(limits);
```

**Target State**: `registerAllAdapters()` in `src/adapters/registry.ts` and `createSessionManager()` in `src/core/session-manager.ts`. Each entry point calls these instead.

**Approach**:
1. Add `registerAllAdapters()` to `registry.ts` (imports the three adapters, registers them)
2. Add static `createSessionManager()` factory to session-manager.ts
3. Update `mcp/index.ts`, `daemon/entry.ts` to use both
4. `daemon/server.ts:startDaemon()` if it has a copy too
5. Update `cli/commands/doctor.ts` to use `registerAllAdapters()` if applicable
6. Run tests

**Verification**:
- `bun run test` passes
- `bun run lint` passes
- Grep confirms no remaining `registerAdapter(new ...)` calls outside `registerAllAdapters()`

---

### Step 4: Extract `mapViewportConfig` for MCP tools

**Priority**: Medium
**Risk**: Low
**Files**: `src/mcp/tools/index.ts`

**Current State**: The snake_case→camelCase viewport config mapping appears identically in `debug_launch` (lines 59-68) and `debug_attach` (lines 518-527):
```typescript
const viewportConfig = viewport_config
    ? {
        sourceContextLines: viewport_config.source_context_lines,
        stackDepth: viewport_config.stack_depth,
        // ... 4 more fields
    }
    : undefined;
```

**Target State**: A local `mapViewportConfig(config)` function at the top of the file, called from both tools.

**Approach**:
1. Extract the mapping to a function within `mcp/tools/index.ts`
2. Replace both inline blocks
3. Run tests

**Verification**:
- `bun run test:e2e` passes
- `bun run lint` passes

---

### Step 5: Extract shared breakpoint schema

**Priority**: Medium
**Risk**: Low
**Files**: `src/core/types.ts`, `src/daemon/protocol.ts`, `src/mcp/tools/index.ts`

**Current State**: The breakpoint schema `z.object({ line: z.number(), condition: z.string().optional(), hitCondition: z.string().optional(), logMessage: z.string().optional() })` is defined separately in:
- `src/daemon/protocol.ts` (lines 101-107, 153-158, 188-194) — three times within different param schemas
- `src/mcp/tools/index.ts` (lines 26-31, 492-497) — twice within tool schemas

Changes to breakpoint fields require updating 5 locations.

**Target State**: A single `BreakpointSchema` exported from `src/core/types.ts` (where the `Breakpoint` type already lives), used by both protocol.ts and mcp/tools/index.ts.

**Approach**:
1. Export `BreakpointSchema` from `src/core/types.ts`
2. Export `FileBreakpointsSchema` (array of `{ file, breakpoints }`) from the same place
3. Update `daemon/protocol.ts` to use it
4. Update `mcp/tools/index.ts` to use it
5. Run tests

**Verification**:
- `bun run test` passes
- `bun run lint` passes
- Grep confirms no remaining inline breakpoint object schemas outside `types.ts`

---

### Step 6: Consolidate watch/unwatch CLI output formatting

**Priority**: Low
**Risk**: Low
**Files**: `src/cli/commands/index.ts`, `src/cli/format.ts`

**Current State**: `watchCommand` (lines 455-460) and `unwatchCommand` (lines 479-484) have identical output formatting:
```typescript
if (mode === "json") {
    process.stdout.write(`${JSON.stringify({ watchExpressions: result }, null, 2)}\n`);
} else {
    process.stdout.write(`Watch expressions (${result.length} total):\n`);
    for (const expr of result) process.stdout.write(`  ${expr}\n`);
}
```

**Target State**: A `formatWatchExpressions(expressions: string[], mode: OutputMode)` function in `format.ts`, called from both commands.

**Approach**:
1. Add `formatWatchExpressions` to `format.ts`
2. Replace inline formatting in both commands
3. Run tests

**Verification**:
- `bun run test` passes
- `bun run lint` passes

---

### Step 7: Extract `setupGracefulShutdown` utility

**Priority**: Low
**Risk**: Low
**Files**: `src/core/shutdown.ts` (new), `src/mcp/index.ts`, `src/daemon/entry.ts`

**Current State**: Both entry points have identical signal handlers:
```typescript
process.on("SIGINT", async () => { await cleanup(); process.exit(0); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(0); });
```

**Target State**: `setupGracefulShutdown(cleanup: () => Promise<void>)` called from both entry points.

**Approach**:
1. Create `src/core/shutdown.ts` with the utility
2. Update `mcp/index.ts` and `daemon/entry.ts`
3. Run tests

**Verification**:
- `bun run test` passes
- `bun run lint` passes

---

## Out of Scope

The following were considered but deferred:

- **MCP tool try/catch pattern**: The 18 MCP tools all wrap with `try { ... } catch (err) { return errorResponse(err); }`. Each tool's happy path is unique, and the `errorResponse` helper already centralizes error formatting. A wrapper function would add indirection for modest line savings. Revisit if tool count doubles.

- **Daemon dispatch switch statement**: The 143-line switch in `daemon/server.ts::dispatch()` is mechanical but each case is 2-4 lines. A handler map would trade readability for marginally less code. The RPC types in `protocol.ts` already serve as the canonical method registry. Not worth the churn.

- **Session-manager splitting**: At 1322 lines, session-manager.ts is the largest file. However, it's a cohesive unit — the `DebugSession` state and its operations are tightly coupled. Splitting by concern (lifecycle, execution, inspection) would require passing the session map and shared state between modules, adding complexity without measurable benefit. The `withStoppedSession` and `getThreadId` extractions already reduced internal duplication. Revisit only if the file exceeds ~1500 lines.

- **Doctor command version fetching**: The three `get*Version()` functions in `doctor.ts` use the same spawn-collect-output pattern as `checkPrerequisites()`. However, they also do version-specific parsing unique to each tool. A generic wrapper would be marginally shorter but less readable. Low ROI.
