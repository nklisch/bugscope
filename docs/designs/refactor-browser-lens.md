# Refactor Plan: Browser Lens (Phase 10/11)

## Summary

The browser subsystem (`src/browser/`) has grown organically across phases 9-10. `BrowserRecorder` is a god-class orchestrating 7+ responsibilities. Screenshot capture is duplicated between `ScreenshotCapture` and `PersistencePipeline`. The `PersistencePipeline` is accessed via unsafe double-cast to reach its private `db` field. Several config types lack Zod validation, and all browser errors use generic `Error` instead of the project's `KrometrailError` hierarchy. This plan addresses these issues in small, testable steps.

## Refactor Steps

### Step 1: Deduplicate screenshot capture logic
**Priority**: High
**Risk**: Low
**Files**: `src/browser/storage/persistence.ts`, `src/browser/storage/screenshot.ts`

**Current State**: `PersistencePipeline.captureScreenshot()` (persistence.ts:183-195) duplicates the CDP screenshot call and file write from `ScreenshotCapture.capture()` (screenshot.ts:26-36). Both call `Page.captureScreenshot` with `{ format: "png", quality: 80 }`, decode base64, and `writeFileSync`.

**Target State**: `PersistencePipeline` accepts a `ScreenshotCapture` instance and delegates to it. Remove the private `captureScreenshot` method from `PersistencePipeline`.

**Approach**:
1. Add `ScreenshotCapture` as a constructor dependency of `PersistencePipeline`
2. Replace `this.captureScreenshot(...)` call in `onMarkerPlaced` with `this.screenshotCapture.capture(...)` wrapped in try/catch
3. Delete `PersistencePipeline.captureScreenshot()`

**Verification**:
- Build passes
- Unit tests pass
- `bun run test:unit` passes

---

### Step 2: Expose cleanup method on PersistencePipeline, remove unsafe cast
**Priority**: High
**Risk**: Low
**Files**: `src/browser/storage/persistence.ts`, `src/browser/recorder/index.ts`

**Current State**: `BrowserRecorder` accesses the private `db` field of `PersistencePipeline` via an unsafe double-cast (`as unknown as { db: ... }`) to run retention cleanup (index.ts:126).

**Target State**: `PersistencePipeline` exposes a public `runRetentionCleanup(config: RetentionConfig)` method. `BrowserRecorder` calls it directly.

**Approach**:
1. Add `async runRetentionCleanup(config?: RetentionConfig): Promise<{ deleted: number }>` to `PersistencePipeline`
2. Inside, instantiate `RetentionManager` and call `cleanup(this.db)`
3. In `BrowserRecorder` constructor, replace the unsafe cast + cleanup block with `this.persistence.runRetentionCleanup().catch(() => {})`

**Verification**:
- Build passes
- No `as unknown as` casts remain in recorder/index.ts
- `bun run test:unit` passes

---

### Step 3: Add Zod schema for PersistenceConfig
**Priority**: High
**Risk**: Low
**Files**: `src/browser/storage/persistence.ts`, `src/browser/recorder/index.ts`

**Current State**: `PersistenceConfig` is a plain interface (persistence.ts:11-16), violating the project convention of Zod validation at boundaries. All other browser configs (`BufferConfigSchema`, `ScreenshotConfigSchema`, `RetentionConfigSchema`) have schemas.

**Target State**: `PersistenceConfigSchema` validates config with defaults. `PersistenceConfig` is derived via `z.infer`.

**Approach**:
1. Define `PersistenceConfigSchema` with `dataDir` (string, default `~/.krometrail/browser`) and `markerPaddingMs` (number, default from buffer config)
2. Change `PersistenceConfig` to `z.infer<typeof PersistenceConfigSchema>`
3. Parse config in `PersistencePipeline` constructor

**Verification**:
- Build passes
- `bun run lint` passes
- `bun run test:unit` passes

---

### Step 4: Add Zod schemas for database query filters
**Priority**: Medium
**Risk**: Low
**Files**: `src/browser/storage/database.ts`

**Current State**: `SessionFilter` and `EventQueryFilter` are plain interfaces (database.ts:46-60) used at query boundaries.

**Target State**: Both have Zod schemas. Internal callers can skip parsing; external callers (MCP tools, CLI) validate at the boundary.

**Approach**:
1. Add `SessionFilterSchema` and `EventQueryFilterSchema` alongside existing interfaces
2. Export both schemas and inferred types
3. Do not change existing callers yet (schemas are available for Phase 11 MCP tools to use)

**Verification**:
- Build passes
- `bun run lint` passes

---

### Step 5: Extract event builder helper in EventNormalizer
**Priority**: Medium
**Risk**: Low
**Files**: `src/browser/recorder/event-normalizer.ts`

**Current State**: 9 normalizer methods each repeat the same `RecordedEvent` construction boilerplate: `{ id: crypto.randomUUID(), timestamp: Date.now(), type, tabId, summary, data }`.

**Target State**: Private `buildEvent(type, tabId, summary, data)` helper eliminates the repetitive object construction.

**Approach**:
1. Add `private buildEvent(type: EventType, tabId: string, summary: string, data: Record<string, unknown>): RecordedEvent`
2. Refactor each `normalize*` method to call `this.buildEvent(...)` instead of constructing the object inline
3. Same treatment for `InputTracker.buildUserInputEvent` methods

**Verification**:
- Build passes
- Unit tests for event normalizer pass
- `bun run test:unit` passes

---

### Step 6: Add browser-specific error classes
**Priority**: Medium
**Risk**: Low
**Files**: `src/core/errors.ts`, `src/browser/recorder/index.ts`, `src/browser/recorder/cdp-client.ts`, `src/browser/recorder/tab-manager.ts`

**Current State**: All browser errors use generic `Error` (10+ locations). Core modules use `KrometrailError` subclasses with error codes.

**Target State**: Browser-specific errors extend `KrometrailError`: `ChromeNotFoundError`, `CDPConnectionError`, `TabNotFoundError`, `BrowserRecorderStateError`.

**Approach**:
1. Add browser error classes to `src/core/errors.ts`
2. Replace `throw new Error(...)` with appropriate typed errors in: `index.ts` (4 locations), `cdp-client.ts` (4 locations), `tab-manager.ts` (1 location)
3. Leave silent `.catch(() => {})` patterns for now (fire-and-forget operations are intentional for CDP resilience)

**Verification**:
- Build passes
- `bun run test:unit` passes
- `bun run lint` passes

---

### Step 7: Extract buildSessionInfo caching
**Priority**: Medium
**Risk**: Low
**Files**: `src/browser/recorder/index.ts`

**Current State**: `buildSessionInfo()` is called from 5 different sites in `BrowserRecorder`, each time re-querying `buffer.getStats()` and `tabManager.listRecordingTabs()`.

**Target State**: Session info is built lazily and invalidated on buffer push or tab change, avoiding redundant computation during event bursts.

**Approach**:
1. Add `private cachedSessionInfo: BrowserSessionInfo | null = null`
2. Invalidate in `push()` path (set to null when buffer changes)
3. `buildSessionInfo()` returns cached value if not null, rebuilds otherwise

**Verification**:
- Build passes
- `bun run test:unit` passes

---

### Step 8: Decompose BrowserRecorder — extract Chrome lifecycle
**Priority**: High
**Risk**: Medium
**Files**: `src/browser/recorder/index.ts`, new `src/browser/recorder/chrome-launcher.ts`

**Current State**: `BrowserRecorder` manages Chrome launch, CDP connection, reconnection, and the process handle directly (module-level functions `launchChrome`, `waitForChrome` + class fields `chromeProcess`, CDP options setup in `start()`).

**Target State**: New `ChromeLauncher` class encapsulates Chrome process management and CDP URL resolution. `BrowserRecorder.start()` becomes: `const { cdpClient, process } = await this.launcher.connect(config)`.

**Approach**:
1. Create `src/browser/recorder/chrome-launcher.ts`
2. Move `launchChrome()`, `waitForChrome()` into `ChromeLauncher`
3. Add `connect(config: { port, attach, profile }): Promise<{ cdpClient: CDPClient, process?: ChildProcess }>` method
4. `BrowserRecorder` constructor takes `ChromeLauncher` or creates a default one
5. Update `start()` and `stop()` to delegate

**Verification**:
- Build passes
- Integration tests pass (browser tests still connect to real Chrome)
- `bun run test:unit` passes

---

### Step 9: Decompose BrowserRecorder — extract event dispatch
**Priority**: High
**Risk**: Medium
**Files**: `src/browser/recorder/index.ts`, new `src/browser/recorder/event-pipeline.ts`

**Current State**: `onCDPEvent()` (52 lines) mixes input tracker processing, event normalization, buffer management, persistence callbacks, screenshot triggers, and auto-detection in a single method with deeply nested conditionals.

**Target State**: New `EventPipeline` class owns the event processing flow. Takes normalizer, buffer, input tracker, auto-detector, and optional persistence/screenshot hooks as dependencies. `BrowserRecorder.onCDPEvent()` becomes a one-liner delegation.

**Approach**:
1. Create `src/browser/recorder/event-pipeline.ts`
2. Move `onCDPEvent()` logic, `checkAutoDetect()` into `EventPipeline`
3. `EventPipeline` exposes hooks for marker placement and screenshot capture (callbacks)
4. `BrowserRecorder` wires up the pipeline in `start()`, delegates events to it

**Verification**:
- Build passes
- `bun run test:unit` passes
- Integration tests pass
- Event processing behavior unchanged (same events flow to buffer and persistence)
