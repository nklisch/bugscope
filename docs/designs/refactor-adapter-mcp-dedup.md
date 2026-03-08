# Refactor Plan: Adapter & MCP Tool Deduplication

## Summary

The adapter layer (`src/adapters/`) contains significant code duplication across 11 language adapters — most notably identical `downloadToFile()` implementations (5 copies), repeated `dispose()` patterns, duplicated version-checking boilerplate, and repeated cache path construction. The MCP tool layer (`src/mcp/tools/`) has a duplicated `errorResponse()` helper. This plan consolidates these into shared utilities, ordered by impact and safety.

---

## Refactor Steps

### Step 1: Extract `downloadToFile` to helpers.ts

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/java.ts`, `src/adapters/rust.ts`, `src/adapters/kotlin.ts`, `src/adapters/js-debug-adapter.ts`, `src/adapters/netcoredbg.ts`

**Current State**: 5 identical copies of `downloadToFile(url, destPath)` — each follows redirects via recursive call, writes to `createWriteStream`, uses `pipeline`. The only difference is the error message string (e.g., "downloading CodeLLDB" vs "downloading java-debug-adapter").

**Target State**: Single `downloadToFile(url: string, destPath: string, label?: string): Promise<void>` exported from `helpers.ts`. Each adapter imports and calls it with its label.

**Approach**:
1. Add `downloadToFile` to `src/adapters/helpers.ts` with a `label` parameter for the error message.
2. Remove the local `downloadToFile` from each adapter.
3. Update imports in all 5 adapter files.

**Verification**:
- Build passes (`bun run build`)
- `bun run test:unit` passes
- `bun run test:integration` passes (tests real download + cache for adapters with installed debuggers)

---

### Step 2: Extract `getAdapterCacheDir` to helpers.ts

**Priority**: High
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/java.ts`, `src/adapters/rust.ts`, `src/adapters/kotlin.ts`, `src/adapters/js-debug-adapter.ts`, `src/adapters/netcoredbg.ts`

**Current State**: Each adapter that downloads a tool constructs `join(homedir(), ".agent-lens", "adapters", <name>)` independently. Some also have `isCached()` helpers that check `existsSync` on the result.

**Target State**: Shared helper:
```typescript
export function getAdapterCacheDir(adapterName: string): string
export function ensureAdapterCacheDir(adapterName: string): string // mkdirSync + return path
```

**Approach**:
1. Add helpers to `helpers.ts`.
2. Refactor each adapter's cache path construction to use the shared helper.
3. Keep adapter-specific `getCachePath()` functions that call the shared helper with their specific filename (e.g., appending the JAR name).

**Verification**:
- Build passes
- Unit tests pass
- Existing `getJavaDebugAdapterCachePath()` / `getCodeLLDBCachePath()` exports (used by doctor.ts) still work

---

### Step 3: Extract `errorResponse` to shared MCP utility

**Priority**: High
**Risk**: Low
**Files**: `src/mcp/tools/index.ts`, `src/mcp/tools/browser.ts`

**Current State**: Identical `errorResponse(err: unknown)` function defined at the bottom of both files (~4 lines each).

**Target State**: Single export from a new `src/mcp/tools/utils.ts` (or from `index.ts` as a named export). Both tool registration files import it.

**Approach**:
1. Create `src/mcp/tools/utils.ts` with `errorResponse` and optionally `textResponse(text: string)` for the matching success pattern.
2. Delete the local copies from both files.
3. Update imports.

**Verification**:
- Build passes
- `bun run test:unit` passes
- `bun run test:e2e` passes (MCP tools exercise error paths)

---

### Step 4: Extract download error message template

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, `src/adapters/java.ts`, `src/adapters/rust.ts`, `src/adapters/kotlin.ts`, `src/adapters/js-debug-adapter.ts`, `src/adapters/netcoredbg.ts`

**Current State**: Each adapter's download-and-cache function has a catch block that constructs a nearly identical error message:
```
Failed to download <tool> v<VERSION>.
URL: <url>
Error: <err.message>
To install manually, download ... and place it at: <path>
```

**Target State**: Shared helper:
```typescript
export function downloadError(tool: string, version: string, url: string, destPath: string, err: unknown): Error
```

**Approach**:
1. Add helper to `helpers.ts`.
2. Replace each adapter's manual error construction with the helper call.

**Verification**:
- Build passes
- Unit tests pass
- Error messages remain identical (check manually or with a snapshot test)

---

### Step 5: Define TCP connection retry constants

**Priority**: Medium
**Risk**: Low
**Files**: `src/adapters/helpers.ts`, all TCP-based adapters

**Current State**: Adapters pass magic numbers to `connectTCP()`: `(5, 300)`, `(25, 200)`, `(30, 300)`. The semantics differ by adapter startup speed — fast-starting adapters (Node, Go) use fewer retries; slow-starting ones (Python, Rust, Java) use more.

**Target State**: Named constants in `helpers.ts`:
```typescript
export const CONNECT_FAST = { maxRetries: 5, retryDelayMs: 300 } as const;
export const CONNECT_SLOW = { maxRetries: 25, retryDelayMs: 200 } as const;
```
Adapters use spread: `connectTCP("127.0.0.1", port, ...Object.values(CONNECT_FAST))` or a destructured call.

**Approach**:
1. Add constants to `helpers.ts`.
2. Replace magic numbers in each adapter.
3. Optionally update `connectTCP` signature to accept an options object for clarity.

**Verification**:
- Build passes
- Integration tests pass (connection behavior unchanged)

---

### Step 6: Extract `getErrorMessage` utility

**Priority**: Medium
**Risk**: Low
**Files**: New `src/core/utils.ts` or add to `src/core/errors.ts`. Used by: adapters (20+ sites), `mcp/tools/`, `core/launch-json.ts`

**Current State**: `err instanceof Error ? err.message : String(err)` appears 20+ times across the codebase.

**Target State**: `getErrorMessage(err: unknown): string` exported from `src/core/errors.ts`.

**Approach**:
1. Add function to `src/core/errors.ts` (natural home for error utilities).
2. Find-and-replace across all files. Each replacement is a 1-line change.

**Verification**:
- Build passes
- Unit tests pass
- Lint passes (`bun run lint`)

---

### Step 7: Consolidate adapter `dispose()` pattern

**Priority**: Medium
**Risk**: Low
**Files**: All TCP-based adapters (~9 files), `src/adapters/helpers.ts`

**Current State**: Most adapters have nearly identical `dispose()`:
```typescript
async dispose(): Promise<void> {
    await gracefulDispose(this.socket, this.adapterProcess);
    this.socket = null;
    this.adapterProcess = null;
}
```
Some adapters (Node, C++) have extra cleanup (killing parent processes, extra sockets).

**Target State**: For standard TCP adapters, add a mixin or helper that handles the common case. Adapters with extra cleanup override/extend.

**Approach**:
1. Add `disposeAdapter(fields: { socket: Socket | null; process: ChildProcess | null }): Promise<void>` to `helpers.ts` that calls `gracefulDispose` and returns void (callers null their own fields).
2. Or: keep as-is. The duplication is only 4 lines per adapter and is very readable.

**Decision**: This step is **optional** — the 4-line dispose pattern is simple enough that deduplication may reduce readability. Include only if the team prefers DRY over clarity here.

**Verification**:
- Build passes
- Integration tests pass
- Adapter cleanup still works (test by launching and stopping sessions)

---

## Steps NOT included (and why)

**Base class for adapters**: While a `TCPDebugAdapter` base class could eliminate the private field + dispose + checkPrerequisites boilerplate, it would:
- Change the adapter SDK contract (currently interface-based, not class-based)
- Force new adapters to extend a class rather than implement an interface
- Make the adapter layer less transparent to contributors
The current interface + helpers approach is simpler and aligns with the SPEC's "deliberately narrow" adapter boundary.

**Command parser factory**: Each adapter's `parseCommand()` has language-specific semantics (Go packages, Java classpaths, Python `-m` mode). A generic factory would need so many configuration knobs that it wouldn't be simpler than the current per-adapter functions.

**MCP tool factory**: The MCP SDK's `server.tool()` pattern is already fairly concise. A factory abstraction would hide the schema definitions and make tool descriptions harder to find. Not worth the indirection.

**Splitting session-manager.ts**: At 1383 lines this is large, but it's the core orchestration class. Splitting viewport building, breakpoint management, and variable inspection into separate files would create cross-file coupling without reducing complexity. Consider this separately if session-manager continues to grow.

**Splitting cli/commands/index.ts**: Commands are grouped for discoverability. Splitting into per-command files adds navigation overhead without reducing complexity.
