# Design: Phase 15 — React State Observer

## Overview

Full React component state observation — fiber tree walking, state/prop change tracking, commit diffing, and bug pattern detection. After this phase, agents see React-specific events in the Browser Lens timeline: component mounts/updates/unmounts, state diffs, trigger sources, and detected anti-patterns (infinite re-renders, stale closures, missing cleanup, excessive context re-renders).

**Depends on:** Phase 14 (framework detection infrastructure) — complete.

**References:**
- `docs/framework-state/react/SPEC.md` — hook contract, event schemas, bug pattern definitions
- `docs/framework-state/react/INTERFACE.md` — fiber tree traversal, state extraction, hook classification
- `docs/framework-state/react/ARCH.md` — injection script architecture, observer flow, throttling

---

## Architecture Summary

```
Page.addScriptToEvaluateOnNewDocument (order matters)
  1. detector.ts script  — installs __REACT_DEVTOOLS_GLOBAL_HOOK__ shim, reports framework_detect
  2. react-injection.ts script — patches onCommitFiberRoot/onCommitFiberUnmount with observation
  3. input-tracker.ts script — existing click/submit/change tracking

React reconciler
  → calls hook.inject(renderer)     → detector reports framework_detect via __BL__
  → calls hook.onCommitFiberRoot()  → observer walks fibers, diffs state, queues events
  → calls hook.onCommitFiberUnmount() → observer reports unmount

Observer event queue
  → RAF-throttled flush
  → console.debug("__BL__", JSON.stringify({ type: "framework_state"|"framework_error", ... }))
  → CDP Runtime.consoleAPICalled
  → EventPipeline → FrameworkTracker.processFrameworkEvent() → RollingBuffer → Persistence
```

The observer script is a self-contained IIFE that runs in the page context. All fiber walking, state extraction, diffing, pattern detection, serialization, and throttling happen in-page. The server side (`FrameworkTracker.processFrameworkEvent()`) already handles converting `__BL__` messages to `RecordedEvent` objects (implemented in Phase 14). No server-side changes are needed for event processing.

---

## Implementation Units

### Unit 1: ReactObserver Class

**File**: `src/browser/recorder/framework/react-observer.ts`

```typescript
export interface ReactObserverConfig {
	/** Max framework events per second reported via __BL__. Default: 10. */
	maxEventsPerSecond?: number;
	/** Max depth for state/props serialization. Default: 3. */
	maxSerializationDepth?: number;
	/** Renders with unchanged deps before stale closure warning. Default: 5. */
	staleClosureThreshold?: number;
	/** Renders in 1s window before infinite loop warning. Default: 15. */
	infiniteRerenderThreshold?: number;
	/** Context consumers before excessive re-render warning. Default: 20. */
	contextRerenderThreshold?: number;
	/** Max fibers visited per commit (safety cap). Default: 5000. */
	maxFibersPerCommit?: number;
	/** Max queued events before overflow (oldest dropped). Default: 1000. */
	maxQueueSize?: number;
}

/**
 * Manages the React state observation injection script.
 * Instantiated by FrameworkTracker when "react" is in the enabled frameworks.
 */
export class ReactObserver {
	private config: Required<ReactObserverConfig>;

	constructor(config: ReactObserverConfig = {}) {
		this.config = {
			maxEventsPerSecond: config.maxEventsPerSecond ?? 10,
			maxSerializationDepth: config.maxSerializationDepth ?? 3,
			staleClosureThreshold: config.staleClosureThreshold ?? 5,
			infiniteRerenderThreshold: config.infiniteRerenderThreshold ?? 15,
			contextRerenderThreshold: config.contextRerenderThreshold ?? 20,
			maxFibersPerCommit: config.maxFibersPerCommit ?? 5000,
			maxQueueSize: config.maxQueueSize ?? 1000,
		};
	}

	/**
	 * Returns the injection script IIFE string.
	 * This script patches __REACT_DEVTOOLS_GLOBAL_HOOK__ (installed by detector.ts)
	 * to observe fiber commits and report state changes via __BL__.
	 */
	getInjectionScript(): string {
		return buildReactInjectionScript(this.config);
	}
}
```

**Implementation Notes:**
- Config defaults match the values specified in `react/ARCH.md § Configurable Parameters`.
- The class is intentionally thin — it wraps config and delegates script generation to `buildReactInjectionScript()`.
- No server-side event processing — `FrameworkTracker.processFrameworkEvent()` already handles that.

**Acceptance Criteria:**
- [ ] `new ReactObserver()` uses sensible defaults for all config values (including `maxQueueSize: 1000`)
- [ ] `new ReactObserver({ maxEventsPerSecond: 20, maxQueueSize: 2000 })` overrides specified values
- [ ] `getInjectionScript()` returns a non-empty string
- [ ] The returned string is a valid self-contained IIFE (starts with `(function()`, ends with `})();`)
- [ ] The returned string contains no `let` or `const` declarations (only `var`)

---

### Unit 2: React Injection Script

**File**: `src/browser/recorder/framework/react-injection.ts`

```typescript
import type { ReactObserverConfig } from "./react-observer.js";
import { getReactPatternCode } from "./patterns/react-patterns.js";

/**
 * Generate the React observer injection script.
 * Returns a self-contained IIFE that patches __REACT_DEVTOOLS_GLOBAL_HOOK__
 * to observe fiber commits and report via __BL__.
 *
 * Uses only `var` declarations — no let/const — for maximum browser compatibility.
 * All state is closure-local. Only side effect is patching the global hook.
 */
export function buildReactInjectionScript(config: Required<ReactObserverConfig>): string;
```

The generated IIFE has these sections (in order):

#### Section 1: Configuration Constants
Interpolated from `config` at script generation time.
```javascript
var MAX_EVENTS_PER_SECOND = ${config.maxEventsPerSecond};
var MAX_DEPTH = ${config.maxSerializationDepth};
var STALE_CLOSURE_THRESHOLD = ${config.staleClosureThreshold};
var INFINITE_RERENDER_THRESHOLD = ${config.infiniteRerenderThreshold};
var INFINITE_RERENDER_WINDOW_MS = 1000;
var CONTEXT_RERENDER_THRESHOLD = ${config.contextRerenderThreshold};
var MAX_FIBERS_PER_COMMIT = ${config.maxFibersPerCommit};
var MAX_QUEUE_SIZE = ${config.maxQueueSize};
```

#### Section 2: Tracking State
```javascript
var componentTracking = new WeakMap();  // Fiber -> tracking data
var eventQueue = [];
var lastFlushTime = 0;
var rafScheduled = false;
```

#### Section 3: Reporting Helpers
- `blReport(type, data)` — immediate report via `console.debug('__BL__', ...)`. Used only for detection updates (non-throttled).
- `queueEvent(type, data)` — coalesces or pushes to `eventQueue`, schedules RAF flush.
- `flushEvents()` — RAF callback. Computes budget from elapsed time × `MAX_EVENTS_PER_SECOND`. Sends events up to budget. If events remain, schedules another frame. Caps queue at `MAX_QUEUE_SIZE` (default 1000); drops oldest with overflow warning.

**Per-component coalescing:** Before pushing a new `framework_state` update event, scan the queue (from tail, up to 30 entries) for an existing entry with the same `componentName` and `type === "framework_state"`. If found, merge: overwrite `changes`, `renderCount`, `triggerSource` with the latest values. This keeps the queue proportional to *distinct components updated per flush cycle*, not *total commits*. Mount and unmount events are never coalesced (they represent distinct lifecycle events). Error events are never coalesced.

```javascript
function queueEvent(type, data) {
    // Coalesce updates to the same component
    if (type === 'state' && data.changeType === 'update') {
        var scanLimit = Math.min(eventQueue.length, 30);
        for (var i = eventQueue.length - 1; i >= eventQueue.length - scanLimit; i--) {
            var existing = eventQueue[i];
            if (existing.type === 'state'
                && existing.data.changeType === 'update'
                && existing.data.componentName === data.componentName) {
                // Merge: keep latest state
                existing.data.changes = data.changes;
                existing.data.renderCount = data.renderCount;
                existing.data.triggerSource = data.triggerSource;
                if (!rafScheduled) {
                    rafScheduled = true;
                    requestAnimationFrame(flushEvents);
                }
                return;
            }
        }
    }

    eventQueue.push({ type: type, data: data });

    // Overflow protection
    if (eventQueue.length > MAX_QUEUE_SIZE) {
        var dropped = eventQueue.length - Math.floor(MAX_QUEUE_SIZE / 2);
        eventQueue = eventQueue.slice(-Math.floor(MAX_QUEUE_SIZE / 2));
        blReport('error', {
            framework: 'react',
            pattern: 'observer_overflow',
            componentName: '[Observer]',
            severity: 'low',
            detail: 'Dropped ' + dropped + ' framework events due to high commit rate.',
            evidence: { dropped: dropped }
        });
    }

    if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(flushEvents);
    }
}
```

Implementation: extends `react/ARCH.md § Throttling Strategy` with coalescing.

#### Section 4: Serialization
- `serialize(value, depth)` — shallow serialize with depth limit, string truncation (200 chars), array preview (10 items), object key cap (20 keys). Functions → `[Function: name]`, symbols → `.toString()`. Wraps object property access in try/catch for Proxy edge cases.

Implementation: follow `react/ARCH.md § SERIALIZATION` exactly.

#### Section 5: Fiber Utilities
- `getComponentName(fiber)` — extracts display name from `fiber.type`. Handles function, class, ForwardRef (`type.render`), Memo (`type.type`). Returns `"Anonymous"` or `"Unknown"` as fallbacks.
- `getComponentPath(fiber)` — walks `fiber.return` chain, collects user-component names (tags 0, 1, 11, 14, 15), caps at 10 segments.
- `isUserComponent(fiber)` — `tag === 0 || 1 || 11 || 14 || 15`.
- `getFlags(fiber)` — `fiber.flags ?? fiber.effectTag ?? 0` (React 16/17+ compat).
- `shallowEqual(a, b)` — array shallow comparison for deps arrays.

Implementation: follow `react/INTERFACE.md § Component Name Extraction` and `§ Component Path Computation`.

#### Section 6: Hook Inspection
- `getHooksState(fiber)` — walks `fiber.memoizedState` linked list, returns array of `{ index, hook }`.
- `classifyHook(hook, index)` — structural classification into state/reducer/effect/layoutEffect/ref/memo/callback/id/transition/unknown. Returns `{ index, type, value, deps }`.

Implementation: follow `react/INTERFACE.md § Hooks Linked List` and `§ Hook Type Identification` from SPEC.md. The classification uses the structural rules from SPEC.md (queue presence for useState, effect shape for useEffect, etc.).

#### Section 7: State Change Diffing
- `computeChanges(fiber, tracking)` — diffs props (`fiber.memoizedProps` vs `alternate.memoizedProps`) and state (hooks linked list walk for function components, `memoizedState` object diff for class components). Skips `children` prop. Returns array of `{ key, prev, next }` with serialized values.
- `detectTriggerSource(fiber)` — determines what caused the re-render: `"context"` (dependencies changed), `"state"` (memoizedState differs, props same), `"props"` (props differ, state same), `"parent"` (neither differ meaningfully but component re-rendered).

Implementation: follow `react/ARCH.md § computeChanges` and `§ detectTriggerSource`.

#### Section 8: Pattern Detection
- `checkPatterns(fiber, tracking, componentName)` — dispatches to individual pattern checkers.
- Individual pattern functions imported from `getReactPatternCode()` (see Unit 3).

#### Section 9: Commit Processing
- `processCommit(rendererId, fiberRoot)` — the core observation loop:
  1. Get `rootFiber = fiberRoot.current`
  2. Depth-first walk using explicit stack (not recursion)
  3. For each user component fiber:
     - Get/create tracking record in WeakMap
     - Determine mount vs update (no alternate = mount, props/state differ = update)
     - If mount or update: increment render count, record timestamp, compute changes, detect trigger, queue `framework_state` event, run pattern checkers, update tracking snapshots
     - If unchanged: skip children (optimization — subtree bailout)
  4. Safety cap: stop after `MAX_FIBERS_PER_COMMIT` fibers visited

- `processUnmount(rendererId, fiber)` — if user component, queue `framework_state` event with `changeType: "unmount"`.

Implementation: follow `react/ARCH.md § processCommit` and `§ processUnmount` exactly.

**Subtree bailout optimization**: When `fiber.memoizedProps === fiber.alternate.memoizedProps && fiber.memoizedState === fiber.alternate.memoizedState`, skip the fiber's entire subtree. This is critical for performance — most of the tree is unchanged on each commit.

#### Section 10: Hook Patching
The final section that executes immediately:

```javascript
var hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
if (!hook) return; // Detection script should have installed it

var origOnCommit = hook.onCommitFiberRoot;
var origOnUnmount = hook.onCommitFiberUnmount;

hook.onCommitFiberRoot = function(id, root, priority) {
    if (origOnCommit) {
        try { origOnCommit.call(hook, id, root, priority); } catch(e) {}
    }
    try { processCommit(id, root); } catch(e) {}
};

hook.onCommitFiberUnmount = function(id, fiber) {
    if (origOnUnmount) {
        try { origOnUnmount.call(hook, id, fiber); } catch(e) {}
    }
    try { processUnmount(id, fiber); } catch(e) {}
};
```

Wrapping in try/catch ensures our observer never crashes the page, and the original hook callbacks (if any) are preserved.

**Implementation Notes:**
- The entire script must use `var` only (no `let`/`const`) for pre-ES6 compatibility.
- The script builds using `parts.push(...)` string concatenation (same pattern as `detector.ts`) to avoid template literal escaping issues with nested quotes.
- All fiber access is wrapped in try/catch — fibers can be in inconsistent states during concurrent mode transitions.
- The `WeakMap` for component tracking ensures unmounted fibers are garbage-collected automatically.
- The `requestAnimationFrame`-based throttle ensures the observer never blocks the main thread longer than a single event serialization.

**Acceptance Criteria:**
- [ ] Generated script is a valid IIFE with no `let`/`const`
- [ ] Script patches `onCommitFiberRoot` to call `processCommit`
- [ ] Script patches `onCommitFiberUnmount` to call `processUnmount`
- [ ] Original hook callbacks are preserved (chained, not replaced)
- [ ] `processCommit` walks the fiber tree depth-first using explicit stack
- [ ] `processCommit` skips unchanged subtrees (bailout optimization)
- [ ] `processCommit` caps at `MAX_FIBERS_PER_COMMIT`
- [ ] Mount events emitted for fibers with no `alternate`
- [ ] Update events emitted for fibers with changed props or state
- [ ] Unmount events emitted via `processUnmount`
- [ ] State changes serialized with depth limit and string truncation
- [ ] Events throttled via RAF with configurable rate limit
- [ ] Repeated updates to the same component are coalesced in the queue
- [ ] Mount, unmount, and error events are never coalesced
- [ ] Event queue overflow (>`MAX_QUEUE_SIZE`, default 1000) drops oldest events with warning
- [ ] `MAX_QUEUE_SIZE` is configurable via `ReactObserverConfig.maxQueueSize`
- [ ] All fiber access wrapped in try/catch (never crashes the page)

---

### Unit 3: React Pattern Detectors

**File**: `src/browser/recorder/framework/patterns/react-patterns.ts`

```typescript
import type { ReactObserverConfig } from "../react-observer.js";

/** Threshold constants — exported for unit testing. */
export const REACT_PATTERN_DEFAULTS = {
	infiniteRerenderThreshold: 15,
	infiniteRerenderWindowMs: 1000,
	staleClosureThreshold: 5,
	contextRerenderThreshold: 20,
} as const;

/**
 * Returns the JavaScript code string for all React pattern detection functions.
 * Injected into the observer IIFE. All functions use `var` only.
 *
 * Generated functions:
 * - checkPatterns(fiber, tracking, componentName)
 * - checkInfiniteRerender(fiber, tracking, componentName)
 * - checkStaleClosures(fiber, tracking, componentName)
 * - checkMissingCleanup(fiber, tracking, componentName)
 * - checkExcessiveContextRerender(fiber, tracking, componentName)
 */
export function getReactPatternCode(config: Required<ReactObserverConfig>): string;
```

#### Pattern: Infinite Re-render

**Detection:** `tracking.renderTimestamps` filtered to last 1s window. If count > threshold, emit `framework_error` with `pattern: "infinite_rerender"`, `severity: "high"`.

**Evidence:** `{ rendersInWindow, windowMs, lastState: serialize(fiber.memoizedState) }`

Implementation: follow `react/ARCH.md § Infinite Re-render Detection`.

#### Pattern: Stale Closure

**Detection:** For function components, walk hooks. For each effect/memo hook with non-null deps:
1. Compare `hook.memoizedState.deps` (or `ms[1]` for memo tuples) against `tracking.prevDeps[hookIndex]`
2. If `shallowEqual` → deps unchanged this render. Increment `tracking._staleCount[hookIndex]`
3. If stale count ≥ threshold AND state has changed (`fiber.memoizedState !== fiber.alternate.memoizedState`), emit `framework_error` with `pattern: "stale_closure"`, `severity: "medium"`.
4. Reset counter after emitting to avoid spam.

**Evidence:** `{ hookIndex, unchangedDeps: serialize(deps), rendersSinceLastDepsChange, renderCount }`

Implementation: follow `react/ARCH.md § Stale Closure Detection`.

#### Pattern: Missing Cleanup

**Detection:** For function components, walk hooks. For each passive effect (tag & 8):
- If `destroy === undefined` AND `renderCount > 1` AND effect has `HasEffect` flag (tag & 1), emit `framework_error` with `pattern: "missing_cleanup"`, `severity: "low"`.

**Evidence:** `{ hookIndex, effectTag, hasDestroyFn: false, renderCount }`

Implementation: follow `react/ARCH.md § Missing Cleanup Detection`.

#### Pattern: Excessive Context Re-render

**Detection:** Only on ContextProvider fibers (tag 10). If `fiber.memoizedProps.value !== fiber.alternate.memoizedProps.value`:
1. Walk the provider's subtree counting fibers whose `dependencies.firstContext` chain includes this context
2. If consumer count > threshold, emit `framework_error` with `pattern: "excessive_context_rerender"`, `severity: "medium"`.
3. Cap consumer enumeration at threshold + 5 to bound cost.

**Evidence:** `{ contextDisplayName, affectedConsumerCount, consumerNames: first10 }`

Implementation: follow `react/ARCH.md § Excessive Context Re-render Detection`.

#### Deps Tracking Update

After all pattern checks, `updateDepsTracking(fiber, tracking)` walks the hooks list and snapshots each hook's deps array into `tracking.prevDeps[index]`. This is used for stale closure detection on the next render.

**Acceptance Criteria:**
- [ ] `getReactPatternCode()` returns valid JavaScript using only `var`
- [ ] Infinite re-render detected when same component commits >15 times in 1s
- [ ] Stale closure detected when deps unchanged for 5+ renders while state changes
- [ ] Missing cleanup detected for passive effects without destroy function
- [ ] Excessive context re-render detected when >20 consumers affected
- [ ] Each pattern emits correctly shaped `framework_error` event via `queueEvent`
- [ ] Pattern detection is bounded (doesn't infinite-loop, caps consumer enumeration)

---

### Unit 4: FrameworkTracker Extension

**File**: `src/browser/recorder/framework/index.ts` (modify existing)

```typescript
import { ReactObserver } from "./react-observer.js";

export class FrameworkTracker {
	private config: FrameworkTrackerConfig;
	private reactObserver: ReactObserver | null = null;

	constructor(frameworkState: boolean | string[] | undefined) {
		// ... existing normalization logic unchanged ...
	}

	getInjectionScripts(): string[] {
		if (!this.isEnabled()) return [];

		const scripts: string[] = [getDetectionScript(this.config.frameworks)];

		// Phase 15: React observer
		if (this.config.frameworks.includes("react")) {
			this.reactObserver = new ReactObserver();
			scripts.push(this.reactObserver.getInjectionScript());
		}

		// Phase 16+: Vue, Solid, Svelte observers will be added here

		return scripts;
	}

	// processFrameworkEvent() — unchanged, already handles framework_state and framework_error
}
```

**Implementation Notes:**
- The detection script MUST be injected first (index 0) to ensure the hook shim is installed before the observer patches it.
- `ReactObserver` uses default config. Per-framework config from `chrome_start` params is deferred to a future phase.
- No changes to `processFrameworkEvent()` or `buildSummary()` — they already handle all three framework event types generically.

**Acceptance Criteria:**
- [ ] `getInjectionScripts()` returns 2 scripts when `["react"]` is configured (detection + observer)
- [ ] Detection script is at index 0, observer script at index 1
- [ ] `getInjectionScripts()` returns 1 script when `["vue"]` is configured (detection only, no observer yet)
- [ ] `getInjectionScripts()` returns 2 scripts when `true` is configured (detection + react observer)
- [ ] `ReactObserver` instance is created only when react is in frameworks list

---

### Unit 5: React Counter Fixture

**File**: `tests/fixtures/browser/react-counter/server.ts`

```typescript
/**
 * Minimal React counter app for testing framework state observation.
 * Serves a single page with:
 * - A counter component using useState
 * - A display component receiving count as props
 * - Buttons to increment/decrement
 *
 * Usage: bun run tests/fixtures/browser/react-counter/server.ts <port>
 * Prints "READY:<port>" to stdout when listening.
 */
```

**File**: `tests/fixtures/browser/react-counter/index.html`

Serves a page that:
1. Loads React + ReactDOM UMD builds from the fixture server's `/vendor/` path
2. Renders a `Counter` component with `useState(0)` and increment/decrement buttons
3. Renders a `CountDisplay` child component that receives `count` as a prop
4. Includes a `ResetButton` component to test unmount/remount

The fixture server serves:
- `/` → `index.html`
- `/vendor/react.development.js` → React UMD dev build
- `/vendor/react-dom.development.js` → ReactDOM UMD dev build

**File**: `tests/fixtures/browser/react-counter/package.json`

```json
{
  "name": "react-counter-fixture",
  "private": true,
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

**Implementation Notes:**
- Uses `React.createElement` directly — no JSX, no build step.
- Development builds required for `bundleType: 1` and richer debug info.
- The server follows the same pattern as `tests/fixtures/browser/test-app/server.ts`: Bun HTTP server, port from argv, `READY:<port>` on stdout.
- Test setup runs `bun install` in the fixture directory if `node_modules/` doesn't exist.

**Acceptance Criteria:**
- [ ] `bun run server.ts 0` starts and prints `READY:<port>`
- [ ] Navigating to `/` renders a React app with a counter
- [ ] Clicking increment button updates the counter via `useState`
- [ ] React development build is served (bundleType 1)
- [ ] Multiple component types present: parent with state, child with props

---

### Unit 6: React Bugs Fixture

**File**: `tests/fixtures/browser/react-bugs/server.ts`

Same server pattern as the counter fixture.

**File**: `tests/fixtures/browser/react-bugs/index.html`

Serves a page with purpose-built components that trigger each bug pattern:

1. **InfiniteLooper** — `useEffect(() => { setState(s => s + 1) }, [state])` — setState in effect with state as dependency, causing infinite loop. Guarded by a button to activate (not auto-triggering on mount).

2. **StaleClosureDemo** — `useCallback` with empty deps `[]` that captures a state value. The state changes via a button but the callback's deps never update. After 5+ renders, stale closure pattern should fire.

3. **MissingCleanupDemo** — `useEffect` that sets up a `setInterval` but returns no cleanup function. Component re-renders via a button.

4. **ContextFloodDemo** — A context provider wrapping 25+ consumer components. A button changes the context value, causing all consumers to re-render.

Each demo component is isolated in its own section with activation buttons so tests can trigger patterns selectively.

**Implementation Notes:**
- The `InfiniteLooper` must be activatable on demand (not auto-run) to prevent the fixture page from freezing before tests can interact with it.
- Each component has a `data-testid` attribute for reliable test targeting.
- The page includes a `window.__TEST_CONTROLS__` object for programmatic activation via `Runtime.evaluate`.

**Acceptance Criteria:**
- [ ] Server starts and serves the page
- [ ] InfiniteLooper triggers >15 renders/second when activated
- [ ] StaleClosureDemo has unchanged callback deps across 5+ state-changing renders
- [ ] MissingCleanupDemo has a passive effect with no destroy function
- [ ] ContextFloodDemo has 25+ context consumers that re-render on value change

---

### Unit 7: Unit Tests

**File**: `tests/unit/browser/react-observer.test.ts`

Tests for the `ReactObserver` class:
```typescript
describe("ReactObserver", () => {
  describe("constructor", () => {
    it("uses default config when no args provided")
    it("merges partial config with defaults")
    it("respects all config overrides")
  })

  describe("getInjectionScript", () => {
    it("returns a non-empty string")
    it("is a self-contained IIFE")
    it("uses only var declarations (no let/const)")
    it("contains __BL__ reporting")
    it("contains onCommitFiberRoot patching")
    it("contains onCommitFiberUnmount patching")
    it("interpolates config values into the script")
    it("contains processCommit function")
    it("contains processUnmount function")
    it("contains serialize function")
    it("contains getComponentName function")
    it("contains getComponentPath function")
    it("contains pattern detection functions")
  })
})
```

**File**: `tests/unit/browser/react-injection.test.ts`

Tests for the injection script generator:
```typescript
describe("buildReactInjectionScript", () => {
  it("interpolates maxEventsPerSecond config")
  it("interpolates maxSerializationDepth config")
  it("interpolates pattern thresholds")
  it("generated script has no syntax errors (new Function parse check)")
  it("generated script wraps existing hook callbacks")
  it("generated script handles missing hook gracefully (early return)")
})
```

**File**: `tests/unit/browser/react-patterns.test.ts`

Tests for the pattern code generator:
```typescript
describe("getReactPatternCode", () => {
  it("returns valid JavaScript string")
  it("uses only var declarations")
  it("includes checkInfiniteRerender function")
  it("includes checkStaleClosures function")
  it("includes checkMissingCleanup function")
  it("includes checkExcessiveContextRerender function")
  it("includes checkPatterns dispatcher function")
  it("interpolates threshold values from config")
})
```

**File**: `tests/unit/browser/framework-tracker.test.ts` (extend existing)

Add tests for the Phase 15 extension:
```typescript
describe("getInjectionScripts with react observer", () => {
  it("returns 2 scripts when react is enabled", () => {
    const scripts = new FrameworkTracker(["react"]).getInjectionScripts();
    expect(scripts).toHaveLength(2);
  })

  it("first script is detection, second is observer", () => {
    const scripts = new FrameworkTracker(["react"]).getInjectionScripts();
    expect(scripts[0]).toContain("framework_detect");
    expect(scripts[1]).toContain("onCommitFiberRoot");
  })

  it("returns 1 script when only vue is enabled (no observer yet)", () => {
    const scripts = new FrameworkTracker(["vue"]).getInjectionScripts();
    expect(scripts).toHaveLength(1);
  })

  it("returns 2 scripts when true (all frameworks, react observer present)")
})
```

**Implementation Notes:**
- Unit tests validate script generation only — they don't execute the scripts in a browser.
- The `new Function(script)` parse check verifies the generated JavaScript has no syntax errors.
- Pattern test verifies all four detector functions are included in the generated code string.

**Acceptance Criteria:**
- [ ] All unit tests pass with `bun run test:unit`
- [ ] Tests cover config defaulting, script generation, FrameworkTracker extension
- [ ] No mocking of browser APIs — unit tests only check generated code

---

### Unit 8: E2E Tests

**File**: `tests/e2e/browser/react-observer.test.ts`

Full pipeline test: launch Chrome → load React fixture → interact → verify framework events in session.

```typescript
import { setupBrowserTest, isChromeAvailable } from "../../helpers/browser-test-harness.js";

const SKIP = !(await isChromeAvailable());

describe.skipIf(SKIP)("E2E Browser: React State Observer", () => {
  // --- Counter app tests ---
  describe("react-counter fixture", () => {
    let ctx: BrowserTestContext;

    beforeAll(async () => {
      ctx = await setupBrowserTest({
        fixturePath: "tests/fixtures/browser/react-counter",
        frameworkState: ["react"],
      });
      // Wait for React to mount
      await ctx.evaluate("/* click increment a few times */");
      await ctx.placeMarker("after-interactions");
      await ctx.finishRecording();
    });

    afterAll(() => ctx?.cleanup());

    it("detects React framework", async () => {
      const result = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_detect"],
      });
      expect(result).toContain("react");
      expect(result).toContain("18.");
    });

    it("captures component mount events", async () => {
      const result = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_state"],
        query: "mount",
      });
      expect(result).toContain("mount");
      expect(result).toContain("Counter");
    });

    it("captures state update events on interaction", async () => {
      const result = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_state"],
        query: "update",
      });
      expect(result).toContain("update");
      // Should show render count > 1
      expect(result).toMatch(/render #[2-9]/);
    });

    it("includes component path in state events", async () => {
      const result = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_state"],
      });
      // CountDisplay is a child of Counter — path should show ancestry
      expect(result).toMatch(/Counter.*>.*CountDisplay|CountDisplay/);
    });

    it("events are queryable via session_inspect", async () => {
      const search = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_state"],
      });
      const eventId = extractEventId(search);
      const detail = await ctx.callTool("session_inspect", {
        session_id: ctx.sessionId,
        event_id: eventId,
      });
      expect(detail).toContain("framework");
      expect(detail).toContain("react");
    });
  });

  // --- Bug pattern tests ---
  describe("react-bugs fixture", () => {
    let ctx: BrowserTestContext;

    beforeAll(async () => {
      ctx = await setupBrowserTest({
        fixturePath: "tests/fixtures/browser/react-bugs",
        frameworkState: ["react"],
      });
    });

    afterAll(() => ctx?.cleanup());

    it("detects infinite re-render pattern", async () => {
      // Activate the infinite looper via Runtime.evaluate
      await ctx.evaluate("window.__TEST_CONTROLS__.activateInfiniteLoop()");
      await new Promise((r) => setTimeout(r, 2000)); // Let it loop
      await ctx.placeMarker("after-loop");
      await ctx.finishRecording();

      const result = await ctx.callTool("session_search", {
        session_id: ctx.sessionId,
        event_types: ["framework_error"],
      });
      expect(result).toContain("infinite_rerender");
      expect(result).toContain("high");
    });

    // Additional pattern tests follow the same structure
    // Each activates a specific bug component and verifies the error event
  });
});
```

**Implementation Notes:**
- The `setupBrowserTest` helper needs a small extension to accept `fixturePath` and `frameworkState` options. Currently it always uses the `test-app` fixture. The extension adds:
  - `fixturePath?: string` — path to fixture directory (default: existing test-app)
  - `frameworkState?: boolean | string[]` — passed to `BrowserRecorder` config
- The helper starts the fixture's `server.ts`, launches Chrome, navigates to the fixture, creates a `BrowserRecorder` with `frameworkState` enabled.
- E2E tests are inherently slower — each describe block sets up its own Chrome session.
- Tests use `session_search` with `event_types: ["framework_state"]` and `event_types: ["framework_error"]` to find framework events.

**Acceptance Criteria:**
- [ ] Counter fixture tests pass: detection, mount, update, path, inspect
- [ ] Bugs fixture tests pass: infinite re-render pattern detected with high severity
- [ ] Tests skip gracefully when Chrome is not available
- [ ] Framework events appear in session_search results
- [ ] Framework events are inspectable via session_inspect
- [ ] Auto-detection markers are placed for high-severity patterns

---

### Unit 9: Browser Test Harness Extension

**File**: `tests/helpers/browser-test-harness.ts` (modify existing)

```typescript
export interface BrowserTestOptions {
  /** Path to fixture directory. Default: "tests/fixtures/browser/test-app" */
  fixturePath?: string;
  /** Framework state config for BrowserRecorder. Default: undefined (disabled) */
  frameworkState?: boolean | string[];
  /** Additional setup after Chrome launch, before recording starts */
  beforeRecord?: (ctx: BrowserTestContext) => Promise<void>;
}

export async function setupBrowserTest(
  options?: BrowserTestOptions
): Promise<BrowserTestContext>;
```

**Implementation Notes:**
- The existing `setupBrowserTest()` signature is extended with optional `options` parameter.
- `fixturePath` controls which fixture's `server.ts` is spawned.
- `frameworkState` is passed through to `BrowserRecorderConfig`.
- Existing tests that call `setupBrowserTest()` with no args continue to work unchanged.
- If the fixture directory has a `package.json` and no `node_modules/`, run `bun install` before spawning the server.

**Acceptance Criteria:**
- [ ] Existing e2e tests continue to pass without modification
- [ ] New fixture path option correctly starts the specified fixture server
- [ ] `frameworkState` option is wired through to `BrowserRecorder`
- [ ] Fixture dependency installation handled automatically

---

## Implementation Order

```
1. Unit 3: patterns/react-patterns.ts     — pattern code generator (no dependencies)
2. Unit 1: react-observer.ts              — ReactObserver class (imports Unit 3 transitively via Unit 2)
   Unit 2: react-injection.ts             — injection script generator (imports Unit 3)
3. Unit 4: FrameworkTracker extension      — wire ReactObserver into getInjectionScripts()
4. Unit 7: Unit tests                      — validate Units 1-4
5. Unit 9: Browser test harness extension  — enable fixture/framework options
6. Unit 5: React counter fixture           — simple fixture app
   Unit 6: React bugs fixture              — bug pattern fixture app
7. Unit 8: E2E tests                       — full pipeline validation
```

Units 1 and 2 can be implemented together (they're tightly coupled). Units 5 and 6 can be implemented in parallel.

---

## Testing

### Unit Tests: `tests/unit/browser/`

| File | Tests | Focus |
|------|-------|-------|
| `react-observer.test.ts` | ~12 | Config defaults, script generation shape |
| `react-injection.test.ts` | ~6 | Script content, config interpolation, syntax validity |
| `react-patterns.test.ts` | ~8 | Pattern code generation, threshold interpolation |
| `framework-tracker.test.ts` | +4 | Multi-script output, ordering, framework filtering |

### E2E Tests: `tests/e2e/browser/`

| File | Tests | Focus |
|------|-------|-------|
| `react-observer.test.ts` | ~8 | Full pipeline: Chrome → React app → framework events in session |

### Fixtures: `tests/fixtures/browser/`

| Directory | Purpose |
|-----------|---------|
| `react-counter/` | Simple useState counter — mount, update, prop passing |
| `react-bugs/` | Purpose-built bug patterns — infinite loop, stale closure, missing cleanup, context flood |

---

## Verification Checklist

```bash
# Unit tests
bun run test:unit -- --grep "ReactObserver|react-injection|react-patterns|FrameworkTracker"

# E2E tests (requires Chrome)
bun run test:e2e -- --grep "React State Observer"

# Lint
bun run lint

# Full test suite (verify no regressions)
bun run test
```
