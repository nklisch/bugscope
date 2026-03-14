# Refactor Plan: Next-Round Consolidation

## Summary

The previous refactor (`refactor-adapter-mcp-dedup.md`) consolidated low-level adapter utilities (download, cache, TCP constants, errorResponse). This plan addresses the remaining duplication and structural issues across three areas:

1. **Adapter `checkPrerequisites` boilerplate** — 11 adapters implement near-identical spawn-and-check patterns
2. **MCP tool handler boilerplate** — 28+ handlers repeat the same try/catch/errorResponse wrapper
3. **Duplicate Zod schemas at the MCP boundary** — BreakpointMcpSchema duplicates core BreakpointSchema with only `.describe()` added
4. **Adapter `dispose()` null-assignment** — 11 adapters repeat the same 4-line teardown
5. **Launch config logic duplication** — MCP tools and CLI commands both do viewport config mapping and launch.json parsing

Items explicitly excluded: session-manager.ts splitting (1383 lines but cohesive), command parser factory (language-specific semantics make a generic factory more complex than per-adapter functions), and browser code-generation `parts.push` patterns (code generators are inherently repetitive).

---

## Refactor Steps

### Step 1: Extract `checkCommand` prerequisite helper

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/python.ts`, `src/adapters/go.ts`, `src/adapters/ruby.ts`, `src/adapters/java.ts`, `src/adapters/cpp.ts`, `src/adapters/csharp.ts`, `src/adapters/kotlin.ts`, `src/adapters/swift.ts`

**Current State**: Each adapter implements `checkPrerequisites()` as a raw `new Promise((resolve) => { spawn(...); proc.on("close", ...); proc.on("error", ...); })` with identical structure. Only the command, args, missing-names, and installHint differ.

Example from python.ts:22-50 and go.ts:33-55 — identical pattern, different strings.

**Target State**: Shared helper in `helpers.ts`:
```typescript
export function checkCommand(opts: {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  missing: string[];
  installHint: string;
}): Promise<PrerequisiteResult>
```

Most adapters reduce `checkPrerequisites()` to a one-liner. Adapters with multi-step checks (Java needs both `javac` and the debug adapter JAR, Kotlin needs `kotlinc` and kotlin-debug-adapter) call it multiple times.

**Approach**:
1. Add `checkCommand` to `helpers.ts`. It spawns the command, resolves `{ satisfied: true }` on exit code 0, or `{ satisfied: false, missing, installHint }` on error/non-zero.
2. Refactor each adapter's `checkPrerequisites()` to use the helper.
3. Keep adapters with complex multi-step checks (Java, Kotlin) as light wrappers that call `checkCommand` for each prerequisite.

**Verification**:
- Build passes
- `bun run test:unit` passes
- `bun run test:integration` passes
- `krometrail doctor` still reports correct status for all installed adapters

---

### Step 2: Deduplicate MCP Zod schemas via `.describe()` extension

**Priority**: High
**Risk**: Low
**Files**: `src/mcp/tools/index.ts`, `src/core/types.ts`

**Current State**: `BreakpointMcpSchema` (index.ts:14-19) duplicates `BreakpointSchema` (types.ts:18-23) with `.describe()` annotations added. Same for `FileBreakpointsMcpSchema` and `ViewportConfigSchema`. If a field is added to the core schema but not the MCP schema, they silently diverge.

**Target State**: MCP schemas derived from core schemas:
```typescript
const BreakpointMcpSchema = BreakpointSchema.extend({
  line: BreakpointSchema.shape.line.describe("Line number"),
  condition: BreakpointSchema.shape.condition.describe("Expression..."),
  // etc.
});
```
Or, simpler: add `.describe()` directly to the core schemas (they're harmless outside MCP) so the MCP file just re-exports them.

**Approach**:
1. Add `.describe()` to the core `BreakpointSchema` and `FileBreakpointsSchema` fields in `types.ts`.
2. Remove the duplicate schemas from `index.ts`.
3. Import from core. The MCP `ViewportConfigSchema` uses snake_case while core uses camelCase, so it must remain separate — but add a comment noting the intentional divergence and linking to the core schema.

**Verification**:
- Build passes
- Unit tests pass
- MCP tool descriptions still render correctly (check via `krometrail mcp` or MCP inspector)

---

### Step 3: Create MCP tool handler wrapper

**Priority**: High
**Risk**: Low
**Files**: `src/mcp/tools/utils.ts`, `src/mcp/tools/index.ts`, `src/mcp/tools/browser.ts`

**Current State**: 28+ tool handlers repeat this pattern:
```typescript
async (params) => {
  try {
    const result = await sessionManager.someMethod(...);
    return { content: [{ type: "text" as const, text: result }] };
  } catch (err) {
    return errorResponse(err);
  }
}
```

The 15 simple tools (debug_continue, debug_step, debug_evaluate, etc.) are just try/catch wrappers around a single sessionManager call that returns text.

**Target State**: Helper in `utils.ts`:
```typescript
export function textResponse(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

export function toolHandler<T>(
  fn: (params: T) => Promise<string>
): (params: T) => Promise<ToolResult> {
  return async (params) => {
    try {
      return textResponse(await fn(params));
    } catch (err) {
      return errorResponse(err);
    }
  };
}
```

Simple tools become:
```typescript
server.tool("debug_continue", desc, schema,
  toolHandler(({ session_id, timeout_ms, thread_id }) =>
    sessionManager.continue(session_id, timeout_ms, thread_id)
  )
);
```

Complex tools (debug_launch, debug_status, debug_set_breakpoints) that build multi-part text responses keep their explicit try/catch but use `textResponse()` for the success path.

**Approach**:
1. Add `textResponse` and `toolHandler` to `utils.ts`.
2. Convert the ~15 simple handlers in `index.ts` (debug_continue, debug_step, debug_run_to, debug_evaluate, debug_variables, debug_stack_trace, debug_source, debug_action_log, debug_output, debug_watch, debug_threads, debug_stop).
3. Convert the ~6 simple handlers in `browser.ts` (chrome_status, chrome_mark, chrome_stop, session_list, session_inspect, session_diff).
4. Leave complex handlers (debug_launch, debug_status, debug_set_breakpoints, debug_set_exception_breakpoints, chrome_start, session_overview, session_search, session_replay_context) with explicit try/catch but using `textResponse()`.

**Verification**:
- Build passes
- `bun run test:unit` passes
- `bun run test:e2e` passes (all MCP tools exercised)
- Error responses still include proper messages

---

### Step 4: Consolidate viewport config mapping

**Priority**: Medium
**Risk**: Low
**Files**: `src/mcp/tools/index.ts`, `src/core/types.ts`

**Current State**: `mapViewportConfig()` in `index.ts:42-63` manually maps snake_case MCP input to camelCase core config. This function is also needed by CLI commands when parsing `--viewport-*` flags.

**Target State**: Move `mapViewportConfig` to `src/core/types.ts` (next to `ViewportConfigSchema`) so both MCP tools and CLI can import it from the same place.

**Approach**:
1. Move the function to `types.ts`.
2. Update imports in `index.ts`.
3. If CLI commands need it in the future, it's already available.

**Verification**:
- Build passes
- Unit tests pass

---

### Step 5: Extract early-error detection helper for adapters

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/python.ts`, `src/adapters/ruby.ts`, `src/adapters/cpp.ts`

**Current State**: Python (lines 86-98), Ruby (lines 94-115), and C++ (lines ~190-208) each implement identical early spawn failure detection:
```typescript
const earlyError = await new Promise<Error | null>((resolve) => {
  child.on("error", (err) => resolve(new LaunchError(...)));
  child.on("close", (code) => {
    if (code !== null && code !== 0) resolve(new LaunchError(...));
    else resolve(null);
  });
  setTimeout(() => resolve(null), 300);
});
if (earlyError) throw earlyError;
```

Note: several other adapters (Go, Java, Kotlin, C#) already use `spawnAndWait()` from helpers.ts, which handles readiness detection differently (via stdout/stderr pattern matching). The early-error pattern is specifically for adapters that don't emit a readiness signal.

**Target State**: Helper in `helpers.ts`:
```typescript
export function detectEarlySpawnFailure(
  child: ChildProcess,
  label: string,
  stderrBuffer: string[],
  timeoutMs?: number
): Promise<void>
```
Rejects with LaunchError on early failure, resolves after timeout if process is still running.

**Approach**:
1. Add helper to `helpers.ts`.
2. Replace the pattern in python.ts, ruby.ts, cpp.ts.
3. Keep `spawnAndWait` for adapters that need readiness detection.

**Verification**:
- Build passes
- Integration tests pass for Python, Ruby, C++ adapters

---

### Step 6: Unify browser daemon client boilerplate

**Priority**: Medium
**Risk**: Low
**Files**: `src/mcp/tools/browser.ts`

**Current State**: All 4 chrome_* tool handlers repeat:
```typescript
const client = await getDaemonClient();
try {
  const result = await client.call<T>(...);
  return textResponse(result);
} catch (err) {
  return errorResponse(err);
} finally {
  client.dispose();
}
```

**Target State**: Helper function:
```typescript
async function withDaemonClient<T>(
  fn: (client: DaemonClient) => Promise<T>,
  format: (result: T) => string
): Promise<ToolResult>
```

**Approach**:
1. Add `withDaemonClient` helper at the top of `browser.ts` (private to that module).
2. Refactor chrome_status, chrome_mark, chrome_stop to use it.
3. Leave chrome_start with explicit handling (it has special error detection for CDP issues).

**Verification**:
- Build passes
- E2E browser tests pass

---

### Step 7: Framework observer base class

**Priority**: Low
**Risk**: Low
**Files**: `src/browser/recorder/framework/react-observer.ts`, `src/browser/recorder/framework/vue-observer.ts`

**Current State**: ReactObserver and VueObserver are near-identical classes:
```typescript
export class ReactObserver {
  private config: Required<ReactObserverConfig>;
  constructor(config: ReactObserverConfig = {}) {
    this.config = { ...DEFAULTS, ...config };
  }
  getInjectionScript(): string {
    return buildReactInjectionScript(this.config);
  }
}
```

**Target State**: Generic base class or shared factory:
```typescript
class FrameworkObserver<TConfig> {
  protected config: Required<TConfig>;
  constructor(defaults: Required<TConfig>, overrides: Partial<TConfig> = {}) {
    this.config = { ...defaults, ...overrides };
  }
}
```

**Approach**:
1. Create base class in a shared file.
2. Have ReactObserver and VueObserver extend it.
3. Each keeps its `getInjectionScript()` implementation.

**Decision**: This is **optional** — only 2 classes, each ~25 lines. Include if Svelte/Solid observers will follow the same pattern (per the framework-state roadmap, they will).

**Verification**:
- Build passes
- Unit tests for React/Vue observers pass

---

## Steps NOT included (and why)

**Splitting session-manager.ts (1383 lines)**: Cohesive orchestration class. Splitting into SessionLifecycleManager, ExecutionController, StateInspector would create cross-file coupling without reducing complexity. The class is large but has clear internal structure. Revisit if it grows past ~2000 lines.

**Command parser factory**: Each adapter's `parseCommand` has language-specific semantics (Python `-m`/`-c` modes, Go package vs file, Java classpaths, Node.js `--inspect` flags). A generic factory would need enough configuration that it wouldn't be simpler than the current per-adapter functions.

**Code-generation `parts.push` patterns**: The framework detector, react-patterns, vue-patterns, and injection files build JavaScript strings via `parts.push()`. This is inherently repetitive for code generators. A `CodeBuilder` abstraction would add indirection without reducing the actual content that needs to be written. The linear `parts.push` style is easy to read and modify.

**DAP message validation with Zod**: The DAP protocol uses `@vscode/debugprotocol` TypeScript types. Adding Zod schemas would duplicate those types. The silent JSON parse failure in dap-client.ts:371 should be improved with better error logging, but full schema validation is overkill for an internal protocol.

**MCP tool factory**: The `server.tool()` API is already concise. A factory would hide schema definitions and tool descriptions, making them harder to find and modify. Step 3's `toolHandler` wrapper is sufficient — it removes the boilerplate without hiding the schema.

**Internal variable filtering registry**: The `PYTHON_INTERNAL_NAMES`, `JS_INTERNAL_NAMES` etc. sets in value-renderer.ts are static data. A registry pattern adds runtime complexity for data that never changes. The current approach is clear and grep-able.
