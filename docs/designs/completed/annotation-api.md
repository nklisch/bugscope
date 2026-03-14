# Design: Browser Annotation API

## Overview

Add a page-side JavaScript API (`window.__krometrail.mark()`) that lets developer application code and agent-injected code place lightweight **annotations** in the browser recording timeline. Annotations are recorded events that do NOT trigger screenshots, persistence windows, or network body extraction — solving the problem of markers in tight loops slamming storage/memory.

### Key Decisions

1. **Two-tier system**: Annotations (lightweight, no snapshot) vs Markers (full, existing behavior with snapshot + persistence window)
2. **New `annotation` event type** — separate from `marker` in `EVENT_TYPES`
3. **Time-window coalescing** — same-label annotations within 1s are coalesced into a single event with a count
4. **Page API only** — annotations come from developer/page code, not MCP tools. The agent learns about annotations via skill documentation and can inject `__krometrail.mark()` calls into application source code.
5. **Global function API** — `window.__krometrail.mark(label, opts?)` with no-op when not recording
6. **Arbitrary metadata** — annotations carry a `metadata: Record<string, unknown>` bag for developer context
7. **Opt-in promotion** — pass `{ marker: true }` to promote an annotation to a full marker (with snapshot)

---

## Implementation Units

### Unit 1: Add `annotation` event type to enums

**File**: `src/core/enums.ts`

```typescript
export const EVENT_TYPES = [
	// ... existing 16 types ...
	"annotation",
] as const;

export const SEARCHABLE_EVENT_TYPES = [
	// ... existing searchable types ...
	"annotation",
] as const;
```

**Implementation Notes**:
- Add `"annotation"` to both `EVENT_TYPES` and `SEARCHABLE_EVENT_TYPES` arrays
- No new Zod schema needed — `EventTypeSchema` and `SearchableEventTypeSchema` derive from the const arrays automatically

**Acceptance Criteria**:
- [ ] `EventType` union includes `"annotation"`
- [ ] `SearchableEventTypeSchema` accepts `"annotation"`
- [ ] Existing types are unchanged

---

### Unit 2: Annotation coalescing engine

**File**: `src/browser/recorder/annotation-coalescer.ts` (new)

```typescript
export interface PendingAnnotation {
	label: string;
	source: string;
	severity?: Severity;
	firstTs: number;
	lastTs: number;
	count: number;
	metadata?: Record<string, unknown>;
}

export interface CoalescerConfig {
	/** Coalesce window in ms. Annotations with the same label within this window
	 *  are merged into a single event. Default: 1000. */
	windowMs?: number;
}

/**
 * Buffers annotations per-label and flushes them as coalesced events after
 * a configurable quiet window. Prevents annotation spam from tight loops.
 */
export class AnnotationCoalescer {
	private pending: Map<string, PendingAnnotation>;
	private timers: Map<string, ReturnType<typeof setTimeout>>;
	private windowMs: number;
	private onFlush: (annotation: PendingAnnotation) => void;

	constructor(onFlush: (annotation: PendingAnnotation) => void, config?: CoalescerConfig);

	/** Record an annotation. Starts or extends the coalesce window for this label. */
	add(label: string, source: string, ts: number, severity?: Severity, metadata?: Record<string, unknown>): void;

	/** Flush all pending annotations immediately (used on session stop). */
	flushAll(): void;

	/** Clean up all timers. */
	dispose(): void;
}
```

**Implementation Notes**:
- `add()` checks if a pending annotation exists for the label:
  - If yes: increment `count`, update `lastTs`, merge `metadata` (last-write-wins per key), reset the timer
  - If no: create a new `PendingAnnotation`, start a `setTimeout(windowMs)` to flush
- On timer fire: call `onFlush(pending)`, remove from maps
- `flushAll()` clears all timers and calls `onFlush` for each pending entry
- `dispose()` clears all timers without flushing (for abnormal shutdown)
- Memory bounded: each unique label in flight has one `PendingAnnotation` + one timer. Even worst case (1000 unique labels in 1s) is trivial memory.

**Acceptance Criteria**:
- [ ] Same-label annotations within `windowMs` produce a single flush with correct `count`, `firstTs`, `lastTs`
- [ ] Different labels coalesce independently
- [ ] `metadata` from later calls overwrites earlier values per-key
- [ ] `flushAll()` emits all pending annotations immediately
- [ ] Timers are cleaned up on `dispose()`
- [ ] Single annotation (no repeat) flushes after `windowMs` with `count: 1`

---

### Unit 3: Annotation injection script

**File**: `src/browser/recorder/annotation-injector.ts` (new)

```typescript
/**
 * Returns the injection script that installs window.__krometrail on the page.
 * Uses the __BL__ console.debug protocol to communicate back to the recorder.
 */
export function getAnnotationInjectionScript(): string;
```

The injected script installs:

```typescript
// Injected into page context (var-only, IIFE, max compat)
interface KrometrailAPI {
	mark(label: string, opts?: {
		severity?: "low" | "medium" | "high";
		data?: Record<string, unknown>;
		marker?: boolean; // promote to full marker
	}): void;
}
// Available as window.__krometrail
```

**Implementation Notes**:
- Script is an IIFE that:
  1. Checks `window.__krometrail` isn't already installed (idempotent)
  2. Creates `window.__krometrail = { mark: function(label, opts) { ... } }`
  3. `mark()` calls `console.debug('__BL__', JSON.stringify({ type: 'annotation', ts: Date.now(), label, severity, metadata, promote: opts?.marker }))`
  4. Uses `var` declarations only (like existing injection scripts)
  5. Wraps everything in try/catch — never throws into user code
- When `opts.marker` is true, sends `{ type: 'annotation', promote: true, ... }` — the recorder-side promotes this to a full marker
- The `opts.data` field maps to `metadata` in the `__BL__` payload to avoid collision with the top-level data concept
- No-ops silently when `console.debug` isn't available (shouldn't happen in a browser)

**Acceptance Criteria**:
- [ ] `window.__krometrail.mark('label')` sends a `__BL__` message with `type: 'annotation'`
- [ ] `window.__krometrail.mark('label', { severity: 'high', data: { x: 1 } })` includes severity and metadata
- [ ] `window.__krometrail.mark('label', { marker: true })` sends with `promote: true`
- [ ] Calling `mark()` when krometrail is not recording does nothing (no error)
- [ ] Script is idempotent — injecting twice doesn't break anything
- [ ] Script uses only `var` and IIFE pattern (matches existing injection conventions)

---

### Unit 4: Wire annotation processing into EventPipeline

**File**: `src/browser/recorder/event-pipeline.ts`

Update `EventPipeline` to:
1. Accept an `AnnotationCoalescer` in its config
2. Handle `__BL__` messages with `type: 'annotation'`
3. Route promoted annotations to `placeMarker()`

```typescript
// Add to EventPipelineConfig:
export interface EventPipelineConfig {
	// ... existing fields ...
	/** Annotation coalescer for throttling page-side annotations. */
	annotationCoalescer?: AnnotationCoalescer;
}
```

**Implementation Notes**:
- In the `Runtime.consoleAPICalled` handler, after `inputTracker.processInputEvent()` returns null and before `frameworkTracker`:
  - Parse the `__BL__` JSON
  - If `parsed.type === 'annotation'`:
    - If `parsed.promote === true`: call `this.config.placeMarker(parsed.label)` (full marker path, existing behavior)
    - Else: call `annotationCoalescer.add(parsed.label, 'api', parsed.ts, parsed.severity, parsed.metadata)`
  - Return early (don't pass to normalizer or framework tracker)
- The coalescer's `onFlush` callback builds a `RecordedEvent` with `type: 'annotation'` and pushes it to the buffer + persistence

**Acceptance Criteria**:
- [ ] `__BL__` messages with `type: 'annotation'` are routed to the coalescer
- [ ] `promote: true` annotations bypass the coalescer and call `placeMarker()` (full marker with screenshot)
- [ ] Coalesced annotations are pushed to the rolling buffer as `RecordedEvent` with `type: 'annotation'`
- [ ] Coalesced annotations are persisted if within an open marker window
- [ ] Annotations do NOT trigger `checkAutoDetect()` (they are user-intent, not anomalies)
- [ ] Annotations do NOT trigger screenshots or new persistence windows

---

### Unit 5: Wire into BrowserRecorder

**File**: `src/browser/recorder/index.ts`

```typescript
// Add to BrowserRecorder:
private annotationCoalescer: AnnotationCoalescer;
```

**Implementation Notes**:
- Create `AnnotationCoalescer` in constructor with `onFlush` callback that:
  - Builds a `RecordedEvent` with `type: 'annotation'`, appropriate summary, and data fields
  - Pushes to `this.buffer`
  - Persists via `this.persistence?.onNewEvent()` if applicable
  - Invalidates session cache
- Pass the coalescer to `EventPipeline` config
- Inject the annotation script via `Page.addScriptToEvaluateOnNewDocument` in `startRecordingTab()` — inject BEFORE the input tracker and control panel scripts so `window.__krometrail` is available early
- Call `annotationCoalescer.flushAll()` in `stop()` before ending the session
- Call `annotationCoalescer.dispose()` after flush

**Acceptance Criteria**:
- [ ] Annotation injection script is injected into every recorded tab
- [ ] Coalesced annotations appear in the rolling buffer
- [ ] `stop()` flushes all pending annotations before session ends
- [ ] Annotation script is injected before input tracker (so `__krometrail` is available to developer code that runs early)

---

### Unit 6: Update skill documentation

**File**: `.agents/skills/krometrail-mcp/SKILL.md`
**File**: `.agents/skills/krometrail-mcp/references/chrome.md`

Add a section teaching agents how to use annotations:

```markdown
## Annotations (Lightweight Markers)

When recording a browser session, you can instrument the application's source code
with lightweight annotations that appear in the recording timeline without triggering
expensive screenshots or persistence snapshots.

### When to use annotations vs markers

- **Annotations** (`window.__krometrail.mark()`): For frequent, programmatic events
  in application code — render cycles, state transitions, feature flag checks, API
  call starts/ends. Safe in loops. Automatically coalesced when fired rapidly.

- **Markers** (`chrome_mark` tool): For significant moments you want to investigate
  later — error reproduction points, "before" and "after" a user action. Triggers
  screenshot capture and event persistence.

### How to add annotations to application code

Add calls to the application source code (they no-op when krometrail isn't recording):

```javascript
// Simple annotation
window.__krometrail?.mark('checkout-started');

// With severity and context data
window.__krometrail?.mark('payment-failed', {
  severity: 'high',
  data: { errorCode: 'card_declined', amount: 42.99 }
});

// Promote to full marker (triggers screenshot + persistence)
window.__krometrail?.mark('critical-error', { marker: true });
```

### Querying annotations

Use `session_search` with `event_types: ["annotation"]` to find annotations,
or use `contains_text` to search by label.
```

**Acceptance Criteria**:
- [ ] Skill docs explain annotation vs marker distinction
- [ ] Skill docs show code examples for `window.__krometrail.mark()`
- [ ] Skill docs explain the `marker: true` promotion flag
- [ ] Skill docs explain how to query annotations in session_search

---

## Implementation Order

1. **Unit 1** — Add `annotation` event type to enums (no dependencies)
2. **Unit 2** — Annotation coalescer (depends on enums for Severity type only)
3. **Unit 3** — Annotation injection script (independent)
4. **Unit 4** — Wire into EventPipeline (depends on Units 1, 2)
5. **Unit 5** — Wire into BrowserRecorder (depends on Units 3, 4)
6. **Unit 6** — Update skill docs (can be done anytime after design is settled)

Units 1, 2, 3 can be implemented in parallel.

---

## Testing

### Unit Tests: `tests/unit/browser/annotation-coalescer.test.ts`

```typescript
describe("AnnotationCoalescer", () => {
	// Use fake timers (vi.useFakeTimers)

	it("flushes a single annotation after windowMs");
	it("coalesces same-label annotations within window into one event with count");
	it("tracks firstTs and lastTs across coalesced annotations");
	it("coalesces labels independently — different labels produce separate flushes");
	it("merges metadata with last-write-wins per key");
	it("resets timer on each new annotation for same label");
	it("flushAll() emits all pending annotations immediately");
	it("dispose() clears timers without flushing");
	it("handles undefined severity and metadata gracefully");
});
```

### Unit Tests: `tests/unit/browser/annotation-injector.test.ts`

```typescript
describe("getAnnotationInjectionScript", () => {
	it("returns a string containing __krometrail");
	it("script is an IIFE");
	it("script uses only var declarations (no let/const)");
});
```

### E2E Tests: `tests/e2e/browser/annotation-api.test.ts`

```typescript
describe("Annotation API", () => {
	// Requires real Chrome + CDP connection

	it("window.__krometrail.mark() creates annotation events in the recording");
	it("rapid same-label annotations are coalesced with correct count");
	it("annotations with marker:true promote to full markers with screenshot");
	it("annotations appear in session_search with event_types=['annotation']");
	it("annotation metadata is preserved in event data");
	it("annotations do not trigger screenshot capture");
});
```

---

## Verification Checklist

```bash
bun run lint                    # Biome passes
bun run test:unit               # Coalescer + injector tests pass
bun run test:e2e                # Annotation E2E tests pass (requires Chrome)
bun run build                   # Binary compiles
```
