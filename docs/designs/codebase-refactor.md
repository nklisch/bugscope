# Refactor Plan: Full Codebase Consolidation

## Summary

A multi-phase cross-validation audit of `src/adapters/`, `src/mcp/`, `src/core/`, and `src/browser/` identified **59 bare `Error` throws** violating the typed error hierarchy, **~250 lines of duplicated adapter code**, **~55-65 lines of duplicated session manager logic** between `launch()` and `attach()`, **~140 lines of identical injection script code** between React and Vue observers, and inconsistent application of the `toolHandler` wrapper in MCP tools. This plan addresses all validated findings in dependency order, prioritized by deduplication value and risk reduction.

---

## Refactor Steps

### Step 1: Add `checkCommandVersioned` helper to `src/adapters/helpers.ts`

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/node.ts`, `src/adapters/java.ts`, `src/adapters/kotlin.ts`, `src/adapters/cpp.ts`, `src/adapters/bun.ts`, `src/adapters/rust.ts`, `src/adapters/swift.ts`, `src/adapters/csharp.ts`

**Current State**: 8+ adapters manually `spawn()` a command, collect stdout/stderr, parse version output, and compare to a minimum. The existing `checkCommand()` only checks exit codes — it cannot extract version numbers. This gap forces every adapter needing version checks to duplicate ~15-30 lines of spawn-collect-parse boilerplate.

**Target State**: A new `checkCommandVersioned()` helper in `helpers.ts` that accepts `{ cmd, args, env?, versionRegex, minVersion?, missing, installHint }` and returns `PrerequisiteResult` with an optional `version: number` field. Adapters call this instead of rolling their own spawn loops.

**Approach**:
1. Add `checkCommandVersioned()` to `helpers.ts` with version extraction support
2. Migrate `node.ts` checkPrerequisites (lines 23-59) to use it
3. Migrate `kotlin.ts` checkPrerequisites (lines 100-147) — both kotlinc and javac checks
4. Migrate `java.ts` checkPrerequisites — javac check
5. Migrate `cpp.ts` checkGdbVersion (lines 26-45) and checkLldbDap (lines 50-56)
6. Migrate `swift.ts` findLldbDap (line 20-24)
7. Migrate `rust.ts` cargoOk block (lines 168-173)
8. Migrate `bun.ts` checkPrerequisites (lines 21-33)
9. Migrate `csharp.ts` onPath checks (lines 85-89, 139-143)

**Verification**:
- `bun run test:unit` passes
- `bun run test:integration` passes (exercises real adapter prerequisite checks)
- No direct `spawn()` calls remain in adapter `checkPrerequisites()` methods (except for adapters that need non-version checks)

---

### Step 2: Extract shared `parseJavacVersion` to JVM helpers

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/java.ts`, `src/adapters/kotlin.ts`, `src/adapters/helpers.ts`

**Current State**: `parseJavacVersion(output: string): number` is byte-for-byte identical in `java.ts:56-59` and `kotlin.ts:82-85`. Both parse `javac 17.0.8` → `17`.

**Target State**: Single `parseJavacVersion` exported from `helpers.ts` (or a new `jvm-helpers.ts` if preferred), imported by both adapters.

**Approach**:
1. Move function to `helpers.ts` and export it
2. Replace both local copies with imports
3. If Step 1's `checkCommandVersioned` includes the regex, this may become unnecessary — evaluate after Step 1

**Verification**:
- `bun run test:unit` passes
- `grep -r "function parseJavacVersion" src/adapters/` returns exactly one result

---

### Step 3: Unify `runJsDebugParentSession` between Node and Bun adapters

**Priority**: High
**Risk**: Medium
**Files**: `src/adapters/node.ts`, `src/adapters/bun.ts`, `src/adapters/js-debug-adapter.ts`

**Current State**: `node.ts:181-272` (`runJsDebugParentSession`) and `bun.ts:174-264` (`runJsDebugBunParentSession`) share ~65 lines of identical DAP framing code (buffer parser, `sendRequest`, `sendResponse`, `onData`, `initialize` request). Only ~8 lines differ: timeout value (10s vs 15s), trigger condition (`response`+`initialize` vs `event`+`initialized`), and final command (`launch` vs `attach`).

**Target State**: Single `runJsDebugParentSession(socket, options: { timeoutMs, flow: "launch" | "attach", args })` in `js-debug-adapter.ts`. Both adapters call it with their specific flow variant.

**Approach**:
1. Create unified function in `js-debug-adapter.ts` parameterized by flow type
2. Replace `runJsDebugParentSession` in `node.ts` with a call to the shared function
3. Replace `runJsDebugBunParentSession` in `bun.ts` with a call to the shared function
4. Delete both original functions

**Verification**:
- `bun run test:integration` passes (Node and Bun adapter tests exercise the DAP framing)
- `bun run test:e2e` passes
- No `runJsDebugParentSession` or `runJsDebugBunParentSession` functions remain in adapter files

---

### Step 4: Extract `connectOrKill` helper to `src/adapters/helpers.ts`

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/python.ts`, `src/adapters/rust.ts`, `src/adapters/java.ts`, `src/adapters/csharp.ts`

**Current State**: The pattern `connectTCP(...).catch((err) => { proc.kill(); throw new LaunchError(...) })` is repeated 6+ times across 4 adapters (python.ts:67-70, rust.ts:234-237 and 275-278, java.ts:192-195 and 245-248, csharp.ts:111-114 and 163-166).

**Target State**: A `connectOrKill(proc, host, port, retryConfig, label)` helper in `helpers.ts` that wraps `connectTCP` with the kill-on-failure behavior and `LaunchError` throw.

**Approach**:
1. Add `connectOrKill()` to `helpers.ts`
2. Replace all 6+ occurrences across the four adapters

**Verification**:
- `bun run test:integration` passes
- `grep -rn "connectTCP.*\.catch" src/adapters/` returns zero results (all use `connectOrKill` now)

---

### Step 5: Deduplicate launch/attach cache guards in adapters

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/rust.ts`, `src/adapters/java.ts`, `src/adapters/csharp.ts`

**Current State**: Each adapter's `launch()` and `attach()` methods duplicate the "check if cached, else download" block verbatim:
- `rust.ts:203-205` and `rust.ts:258-260` (CodeLLDB)
- `java.ts:172-174` and `java.ts:228-230` (java-debug JAR)
- `csharp.ts:83-95` and `csharp.ts:137-149` (netcoredbg — 13 lines duplicated)

**Target State**: Private `resolveAdapterBinary()` method (or module-level function) in each adapter, called from both `launch()` and `attach()`.

**Approach**:
1. Extract `resolveCodeLLDB()` in `rust.ts`
2. Extract `resolveJavaDebugJar()` in `java.ts`
3. Extract `resolveNetcoredbgBinary()` in `csharp.ts` (this one is 13 lines — biggest win)

**Verification**:
- `bun run test:integration` passes
- No duplicated cache-check blocks within any single adapter file

---

### Step 6: Extract CodeLLDB download logic to `codelldb.ts`

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/rust.ts` → new `src/adapters/codelldb.ts`

**Current State**: `rust.ts:23-101` contains 5 functions for CodeLLDB download, caching, and extraction (`getCodeLLDBCachePath`, `isCodeLLDBCached`, `downloadAndCacheCodeLLDB`, `getVsixUrl`, `getAdapterBinaryPath`). This is inconsistent with the C# adapter, which correctly delegates to a separate `netcoredbg.ts` module, and the Node adapter which delegates to `js-debug-adapter.ts`.

**Target State**: New `codelldb.ts` module following the same pattern as `netcoredbg.ts` and `js-debug-adapter.ts`. `rust.ts` imports from it.

**Approach**:
1. Create `src/adapters/codelldb.ts` with the 5 extracted functions
2. Update `rust.ts` to import from `codelldb.ts`
3. Ensure exports match what integration tests need

**Verification**:
- `bun run test:integration` passes (Rust adapter tests)
- `rust.ts` no longer contains download/cache logic

---

### Step 7: Replace bare `Error` throws with typed `KrometrailError` subclasses

**Priority**: High
**Risk**: Low
**Files**: Multiple across all areas (59 violations total)

**Current State**: 59 `throw new Error(...)` violations exist across `src/`. The worst offenders where typed alternatives already exist but aren't used:
- `daemon/server.ts:405,424` — `BrowserRecorderStateError` exists but plain `Error` is thrown
- `dap-client.ts:56,337` — `DAPConnectionError`/`DAPClientDisposedError` exist
- `database.ts:244,250,256,307` — "not found" errors need typed classes
- `adapters/{java,js-debug-adapter,kotlin,rust,netcoredbg}.ts` — 8 extraction/install errors

**Target State**: All errors at non-trivial throw sites use typed `KrometrailError` subclasses. Prioritize:
1. **Use existing classes** where they fit (daemon, dap-client — ~4 fixes)
2. **Add `AdapterInstallError`** for post-download extraction failures (~8 fixes)
3. **Add `EventNotFoundError`, `MarkerNotFoundError`** for database.ts (~4 fixes)
4. **Add `InvalidLaunchConfigError`** for launch-json.ts (~7 fixes)
5. **Leave CLI throws** — these are user-facing exit conditions where plain Error is acceptable

**Approach**:
1. Add new error classes to `src/core/errors.ts`
2. Fix daemon/server.ts (2 throws, existing class)
3. Fix dap-client.ts (2 throws, existing classes)
4. Fix adapter extraction errors (8 throws, new `AdapterInstallError`)
5. Fix database.ts (4 throws, new error classes)
6. Fix launch-json.ts (7 throws, new `InvalidLaunchConfigError`)
7. Fix session-manager.ts (2 throws)

**Verification**:
- `bun run test` passes (all suites)
- `grep -rn "throw new Error" src/ --include="*.ts" | grep -v "src/cli/" | grep -v "test"` returns only intentional bare throws (if any)

---

### Step 8: Extract shared injection script preamble for framework observers

**Priority**: High
**Risk**: Medium
**Files**: `src/browser/recorder/framework/react-injection.ts`, `src/browser/recorder/framework/vue-injection.ts`, new `src/browser/recorder/framework/injection-helpers.ts`

**Current State**: `react-injection.ts` and `vue-injection.ts` share ~140 identical lines across `blReport()` (5 lines), `queueEvent()` (38 lines), `flushEvents()` (16 lines), and `serialize()` (30 lines). The only differences are framework name strings ('react' vs 'vue') and one phrase ('commit rate' vs 'update rate').

**Target State**: A shared `buildInjectionPreamble(framework: string, config: { maxQueueSize, maxEventsPerSecond })` function in `injection-helpers.ts` that returns the common code block. Both injection builders call it instead of duplicating.

**Approach**:
1. Create `injection-helpers.ts` with `buildInjectionPreamble()`
2. Parameterize framework name and rate-limit description
3. Include `serialize()` in the shared preamble
4. Update `react-injection.ts` and `vue-injection.ts` to use the shared builder
5. Remove duplicated code from both files

**Verification**:
- `bun run test:unit` passes
- `bun run test:e2e` passes (browser recording tests exercise injection)
- Each injection file is ~50% shorter

---

### Step 9: Extract session initialization helpers from `SessionManager`

**Priority**: High
**Risk**: Medium
**Files**: `src/core/session-manager.ts`

**Current State**: `launch()` (226 lines) and `attach()` (148 lines) share ~55-65 lines of identical logic across 6 duplicated blocks:
1. `initializedPromise` construction (7 lines, byte-for-byte identical at lines 249-254 and 479-484)
2. Breakpoint-setting loops (6 lines × 4 occurrences at lines 280-284, 300-303, 500-503, 513-516)
3. `DebugSession` object literal (~22 shared fields at lines 324-352 and 530-558)
4. Timeout timer (8 lines at lines 355-363 and 561-568)
5. Output event handler (23 lines at lines 366-388 and 571-585)
6. DAPClient construction with hardcoded timeout (2 lines at lines 224 and 470)

**Target State**: Private helper methods on `SessionManager`:
- `waitForInitialized(dapClient)` — replaces block 1
- `setInitialBreakpoints(dapClient, breakpoints, cwd, breakpointMap)` — replaces block 2
- `createSession(base)` — factory for block 3
- `registerSessionTimeout(session, sessionId)` — replaces block 4
- `registerOutputHandler(session, dapClient)` — replaces block 5

**Approach**:
1. Extract `waitForInitialized()` (safest, zero behavioral change)
2. Extract `setInitialBreakpoints()` (minor cwd parameterization needed)
3. Extract `registerOutputHandler()`
4. Extract `registerSessionTimeout()`
5. Extract `createSession()` factory
6. Replace hardcoded `requestTimeoutMs: 10_000` with a constant

**Verification**:
- `bun run test` passes (all suites — e2e tests heavily exercise launch/attach)
- `launch()` and `attach()` are each ~40-60 lines shorter
- No behavioral changes (exact same execution flow)

---

### Step 10: Fix unsafe config mutation in `handleStopResult`

**Priority**: High
**Risk**: Low
**Files**: `src/core/session-manager.ts`

**Current State**: Lines 1312-1315 mutate `session.viewportConfig` before an async `buildViewport()` call and restore it afterward — but without `try/finally`. If `buildViewport` throws (e.g., "No stack frames available" at line 1016), the config is left in the wrong state.

**Target State**: Either:
- (a) Pass `effectiveConfig` as a parameter to `buildViewport()` instead of mutating session state, or
- (b) Wrap in `try/finally` to guarantee restoration

Option (a) is cleaner and eliminates the mutation entirely.

**Approach**:
1. Add an optional `configOverride` parameter to `buildViewport()`
2. Use `configOverride ?? session.viewportConfig` inside the method
3. Remove the mutation in `handleStopResult`

**Verification**:
- `bun run test` passes
- No `savedConfig` / temporary swap pattern remains

---

### Step 11: Extract `renderAlignedVariables` helper in viewport rendering

**Priority**: Medium
**Risk**: Low
**Files**: `src/core/viewport.ts`, `src/core/session-manager.ts`

**Current State**: The `Math.max(...items.map(v => v.name.length), N)` + `.padEnd(maxName)` pattern appears 5 times:
- `viewport.ts:47-50` (locals, min width 8)
- `viewport.ts:61-64` (watches, min width 8)
- `viewport.ts:162-164` (changed vars, min width 4)
- `viewport.ts:174-177` (watches in diff, min width 8)
- `session-manager.ts:845-847` (getVariables, min width 4)

**Target State**: A single `renderAlignedVariables(items: Array<{name, value}>, minWidth: number): string[]` helper in `viewport.ts`, used by all 5 call sites.

**Approach**:
1. Create the helper in `viewport.ts`
2. Replace all 5 occurrences
3. Export for use by `session-manager.ts`

**Verification**:
- `bun run test:unit` passes (viewport unit tests)
- `bun run test:e2e` passes (viewport output format is the contract)
- `grep -n "padEnd(max" src/core/` returns only the helper definition

---

### Step 12: Derive `ViewportConfigPartialSchema` from `ViewportConfigSchema`

**Priority**: Medium
**Risk**: Low
**Files**: `src/core/enums.ts`, `src/core/types.ts`

**Current State**: `enums.ts:124-131` manually declares `ViewportConfigPartialSchema` with the same 6 fields as `ViewportConfigSchema` in `types.ts:8-15`, but with `.optional()` instead of `.default(N)`. These are maintained separately and can drift.

**Target State**: `ViewportConfigPartialSchema = ViewportConfigSchema.partial()` — derived automatically.

**Approach**:
1. Import `ViewportConfigSchema` in `enums.ts`
2. Replace manual schema with `.partial()` derivation
3. Verify inferred types match

**Verification**:
- `bun run test` passes
- `bun run build` passes (type-check)

---

### Step 13: Standardize MCP tool handlers to use `toolHandler` wrapper

**Priority**: Medium
**Risk**: Low
**Files**: `src/mcp/tools/index.ts`, `src/mcp/tools/browser.ts`, `src/mcp/tools/utils.ts`

**Current State**: ~12 tool handlers use manual try/catch instead of `toolHandler()`. Additionally, `debug_launch` returns `textResponse("Error: ...")` for 6 error conditions instead of `errorResponse()`, meaning MCP clients don't see these as errors.

**Target State**:
1. All simple handlers use `toolHandler()`
2. Complex handlers (debug_launch, debug_status, debug_set_breakpoints) extract their multi-step logic into private functions wrapped by `toolHandler()`
3. All error conditions use `errorResponse()`, not `textResponse("Error: ...")`
4. `ToolResult` exported from `utils.ts` (eliminates re-declaration in `browser.ts:19`)

**Approach**:
1. Export `ToolResult` from `utils.ts`
2. Remove local `ToolResult` from `browser.ts`
3. Convert simple handlers: `debug_stop`, `debug_set_exception_breakpoints`, `debug_watch`, `debug_attach`, `session_overview`, `session_search`
4. Fix `debug_launch` error responses: change 6 `textResponse("Error: ...")` to `errorResponse(new Error(...))`
5. Rename `registerTools` → `registerDebugTools` for consistency with `registerBrowserTools`

**Verification**:
- `bun run test:e2e` passes
- `grep -n "textResponse.*Error:" src/mcp/` returns zero results
- `grep -c "toolHandler" src/mcp/tools/index.ts` shows increased count

---

### Step 14: Extract shared `TimeRangeSchema` and `parseTimeRange` in browser tools

**Priority**: Medium
**Risk**: Low
**Files**: `src/mcp/tools/browser.ts`

**Current State**: The `time_range` Zod schema is defined inline 3 times (lines 205-211, 239-245, 338-344) and the `new Date(time_range.start).getTime()` conversion is repeated 3 times (lines 219, 263, 353).

**Target State**: A `TimeRangeSchema` constant and `parseTimeRange(tr)` helper, both at file top or in `utils.ts`.

**Approach**:
1. Define `TimeRangeSchema` constant
2. Define `parseTimeRange()` helper
3. Replace all 3 inline schemas and 3 inline conversions

**Verification**:
- `bun run test:e2e` passes
- `grep -c "z.object.*start.*z.string" src/mcp/tools/browser.ts` returns 1 (the shared constant)

---

### Step 15: Extract shared `isErrorEvent` predicate for browser investigation

**Priority**: Medium
**Risk**: Low
**Files**: `src/browser/investigation/query-engine.ts`, `src/browser/investigation/replay-context.ts`

**Current State**: `QueryEngine.isErrorEvent()` is private (lines 365-373). `replay-context.ts` duplicates the logic inline in 2-3 places, with one variant that omits the console `[error]` check.

**Target State**: Shared exported `isErrorEvent(e: EventRow): boolean` function in a new `investigation/predicates.ts` (or added to an existing shared module). `ReplayContextGenerator` uses the shared function.

**Approach**:
1. Extract `isErrorEvent` to a shared location
2. Update `QueryEngine` to call the shared function
3. Update `ReplayContextGenerator` to call the shared function
4. Fix the inconsistent variant in `replay-context.ts:103` that omits console errors — decide if this is intentional

**Verification**:
- `bun run test:unit` passes
- `bun run test:e2e` passes

---

### Step 16: Extract shared `formatTime` and marker window constants

**Priority**: Low
**Risk**: Low
**Files**: `src/browser/investigation/renderers.ts`, `src/browser/investigation/replay-context.ts`, `src/browser/investigation/query-engine.ts`

**Current State**:
- `formatTime(ts)` is identical in `renderers.ts:373-374` and `replay-context.ts:238-240`
- Marker time window constants (120_000ms before, 30_000ms after) are hardcoded in `query-engine.ts:118` and `replay-context.ts:215-216`

**Target State**: Shared `formatTime` and `MARKER_LOOKBACK_MS` / `MARKER_LOOKAHEAD_MS` constants in a shared investigation helpers module.

**Approach**:
1. Create `investigation/format-helpers.ts` with `formatTime` and marker constants
2. Update all consumers

**Verification**:
- `bun run test` passes
- `grep -rn "function formatTime" src/browser/investigation/` returns one result

---

### Step 17: Centralize `~/.krometrail` base path

**Priority**: Low
**Risk**: Low
**Files**: `src/core/paths.ts` (new), `src/adapters/helpers.ts`, `src/core/auto-update.ts`, `src/daemon/protocol.ts`, `src/daemon/server.ts`, `src/browser/recorder/chrome-launcher.ts`, `src/browser/storage/persistence.ts`

**Current State**: `join(homedir(), ".krometrail", ...)` is computed inline in 7+ places across 5 areas with no shared constant.

**Target State**: A `src/core/paths.ts` module exporting `getKrometrailDir()` and convenience subdirectory helpers. All 7+ call sites import from it.

**Approach**:
1. Create `src/core/paths.ts` with `getKrometrailDir()` and `getKrometrailSubdir(name)`
2. Update `adapters/helpers.ts` `getAdapterCacheDir` to use it
3. Update all other inline `homedir()` + `.krometrail` calls

**Verification**:
- `bun run test` passes
- `grep -rn "\.krometrail" src/ | grep -v "paths.ts"` returns zero results (all go through the shared module)

---

### Step 18: Convert FrameworkTracker dispatch to registry pattern

**Priority**: Low
**Risk**: Medium
**Files**: `src/browser/recorder/framework/index.ts`

**Current State**: `FrameworkTracker.getInjectionScripts()` (lines 50-59) uses hardcoded `if (includes("react"))` / `if (includes("vue"))` blocks. Adding a new framework (Solid, Svelte) requires editing this method.

**Target State**: A `Map<string, () => FrameworkObserver>` registry in the framework module. `getInjectionScripts()` iterates the registry instead of hardcoding framework names.

**Approach**:
1. Define observer factory registry
2. Register React and Vue observers
3. Replace hardcoded if-blocks with registry iteration

**Verification**:
- `bun run test:e2e` passes (browser recording tests)
- Adding a hypothetical third framework requires only: implement observer + register (no changes to FrameworkTracker)

---

## Dependency Order

```
Step 1 (checkCommandVersioned) ← Step 2 (parseJavacVersion — may be absorbed)
Step 3 (js-debug parent session) — independent
Step 4 (connectOrKill) — independent
Step 5 (cache guards) — independent
Step 6 (codelldb.ts) — independent
Step 7 (typed errors) — independent, but best done after Steps 1-6 since those change adapter code
Step 8 (injection preamble) — independent
Step 9 (session-manager helpers) ← Step 10 (config mutation fix — apply during or after Step 9)
Step 11 (aligned variables) — independent, but pairs well with Step 9
Step 12 (ViewportConfigPartialSchema) — independent
Step 13 (toolHandler) ← Step 14 (TimeRangeSchema — can do together)
Step 15 (isErrorEvent) — independent
Step 16 (formatTime + constants) — independent
Step 17 (paths.ts) — independent
Step 18 (framework registry) — independent, best after Step 8
```

## Recommended Execution Order

1. **Steps 1-6** (adapter consolidation) — all low risk, high deduplication value
2. **Step 7** (typed errors) — high value, touches files changed in Steps 1-6
3. **Steps 8, 18** (browser injection + registry) — independent, high dedup value
4. **Steps 9-11** (session-manager) — medium risk, high value, do together
5. **Steps 12-14** (MCP + schema) — low risk, medium value
6. **Steps 15-17** (cleanup) — low risk, low value, polish pass
