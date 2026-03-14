# Framework State Capture — Roadmap

Extends the Browser Lens subsystem with framework-aware state observation. Each phase is self-contained. Phases are ordered by dependency — earlier phases establish infrastructure that later phases build on.

References to design docs: `→ framework-state/<framework>/DOC.md`

**Depends on:** Phases 9–12 (Browser Lens complete). Framework state capture plugs into the existing EventPipeline, rolling buffer, persistence, and investigation tools.

---

## Current Status

**Phases 14–17 are complete.** Framework detection, React state observer, Vue state observer, and framework-aware investigation tools are all implemented and tested.

**Phases 18–19 (Solid, Svelte) are not implemented.** Only framework detection exists for Solid and Svelte (in `detector.ts`). No state observers, no bug pattern detectors. These remain future work, pending Solid's bridge script maturity and Svelte 5's devtools hooks (sveltejs/svelte#11389).

Browser Lens captures: network requests/responses, console output, page errors, navigation, user input (clicks, form submissions, field changes), DOM mutations, storage changes, screenshots, WebSocket frames, React component state/diffs/patterns, Vue component state/diffs/store mutations, and framework detection for React, Vue, Solid, and Svelte.

---

## Phase 14: Framework Detection & Infrastructure

**Goal:** Automatically detect React, Vue, Solid, and Svelte on any page. Establish the `FrameworkTracker` class, new event types, and config-gated injection. No state observation yet — just detection and wiring.

**Design focus:** Injection timing, framework shim installation, detection reporting, config schema extension, EventPipeline integration.

→ framework-state/APPROACH.md

### 14.1 — Event Type Extension

Add `framework_detect`, `framework_state`, `framework_error` to the `EventType` union in `src/browser/types.ts`. Define the data shapes from APPROACH.md. Update Zod schemas at the validation boundary.

**Tests:** Unit tests for new event type serialization/deserialization.

### 14.2 — Config Schema Extension

Extend `chrome_start` parameters with `features.frameworkState`:

```typescript
features?: {
  inputTracking?: boolean,       // default: true (existing)
  screenshots?: boolean,         // default: true (existing)
  frameworkState?: boolean | string[],  // default: false
  // true = auto-detect all supported frameworks
  // ["react"] = only install React observer
  // ["react", "vue"] = install both
}
```

Update Zod validation for MCP tool inputs and CLI command args. Wire config through `BrowserRecorder` → `EventPipeline`.

**Tests:** Unit tests for config validation (valid/invalid combinations). E2E test that config gates whether injection scripts run.

### 14.3 — FrameworkTracker Class

Create `src/browser/recorder/framework/index.ts` — the `FrameworkTracker` orchestrator. Parallel to `InputTracker`:

- Holds references to per-framework observers
- Provides `getDetectionScript()` and `getObserverScripts()` for injection
- Processes `__BL__` messages with `type: "framework_*"` prefix
- Routes to the correct observer based on detected framework
- Reports detection events back through the pipeline

Wire into `EventPipeline.process()` alongside the existing `InputTracker` intercept.

**Tests:** Unit tests with mock observers. Integration test that detection script runs and reports back via `__BL__`.

### 14.4 — Framework Detection Script

Create `src/browser/recorder/framework/detector.ts` — generates the detection injection script. The script:

1. Installs shims for `__REACT_DEVTOOLS_GLOBAL_HOOK__` and `__VUE_DEVTOOLS_GLOBAL_HOOK__` (if not already present)
2. Sets up `MutationObserver` + property checks for Solid/Svelte
3. Reports which framework(s) loaded via `console.debug('__BL__', ...)` with `framework_detect` type
4. Reports version, root count, and dev-mode status

Must handle: multiple frameworks on one page (micro-frontends), late-loading frameworks (SPAs with lazy routes), no framework detected (static pages).

→ framework-state/react/SPEC.md#Detection Criteria
→ framework-state/vue/SPEC.md#Detection Criteria
→ framework-state/solid/SPEC.md#Detection Criteria
→ framework-state/svelte/SPEC.md#Detection Criteria

**Tests:** E2E tests with minimal React/Vue apps in fixtures. Verify detection events appear in the buffer with correct framework name and version.

### 14.5 — Auto-Detection Rule Integration

Add framework-aware rules to `auto-detect.ts`:

- `framework_detect` events trigger a summary marker (informational, low severity)
- Prepare hooks for Phase 15/16 bug pattern detectors

**Tests:** Unit tests for new detection rules.

---

## Phase 15: React State Observer

**Goal:** Full React component state observation — tree walking, state change tracking, and bug pattern detection. The agent sees React-specific events in the timeline: component mounts/updates/unmounts, state diffs, and detected anti-patterns.

**Design focus:** Fiber tree traversal performance, hooks linked list parsing, throttled commit processing, stale closure detection.

→ framework-state/react/SPEC.md, INTERFACE.md, ARCH.md

### 15.1 — React Hook Shim

Create `src/browser/recorder/framework/react-observer.ts`. The `getInjectionScript()` method returns the hook shim that:

- Installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` with `supportsFiber: true`
- Implements `inject()` to capture renderer registration
- Implements `onCommitFiberRoot()` with throttled processing (RAF batching)
- Implements `onCommitFiberUnmount()` for cleanup tracking
- Reports via `__BL__` channel

The shim must use `var` only (no `let`/`const`) and work in all browsers. Must be installed before React loads — guaranteed by `Page.addScriptToEvaluateOnNewDocument`.

→ framework-state/react/ARCH.md#Injection Script

**Tests:** Integration test: load a minimal React app, verify the hook intercepts commits.

### 15.2 — Fiber Tree Walker

Implement depth-first fiber traversal in the injection script:

- Walk `child` → `sibling` → `return` (non-recursive, explicit stack to avoid stack overflow on deep trees)
- Extract component name: `type.displayName || type.name`
- Track WorkTag to filter: only visit FunctionComponent (0), ClassComponent (1), ForwardRef (11), MemoComponent (14/15)
- Skip HostComponent (5), HostText (6), Fragment (7) for state tracking (still count them)
- Configurable max depth (default: 50)

→ framework-state/react/INTERFACE.md#Fiber Tree Traversal

**Tests:** Integration test with nested component tree (10+ levels). Verify component names extracted correctly.

### 15.3 — State Extraction

Extract state from fiber nodes in the injection script:

- **Function components:** Walk `memoizedState` linked list. Identify hook types by shape (queue → useState, effect tag → useEffect, `{ current }` → useRef, `[value, deps]` → useMemo).
- **Class components:** Read `stateNode.state` directly.
- **Props:** Read `memoizedProps`. Diff against `alternate.memoizedProps` to detect prop changes.
- **Serialization:** Shallow serialize values (max depth 2, max string length 200, max array preview 5 items). Wrap in try/catch — fiber state can contain circular refs, DOM nodes, functions.

→ framework-state/react/INTERFACE.md#State Extraction

**Tests:** Integration test with a React app using useState, useReducer, useRef, useMemo, useContext. Verify state extracted and serialized correctly.

### 15.4 — Commit Diffing & Event Generation

On each throttled `onCommitFiberRoot`:

1. Walk the committed tree
2. Compare each fiber to its `alternate` (previous version)
3. For changed fibers: compute a state diff (which hooks changed, which props changed)
4. Generate `framework_state` events with component name, path, change type, and diff
5. Track per-component render count in a WeakMap

Throttle: process at most once per `requestAnimationFrame`. Batch multiple commits. Cap at 10 events per flush (overflow events get a summary: "12 more components updated").

→ framework-state/react/ARCH.md#Observer Flow

**Tests:** Integration test: trigger state updates in a React app, verify `framework_state` events appear with correct diffs. Test throttling: rapid updates produce batched events, not a flood.

### 15.5 — React Bug Pattern Detectors

Implement pattern detectors in `src/browser/recorder/framework/patterns/react-patterns.ts`:

| Pattern | Detection Logic | Severity |
|---------|----------------|----------|
| Infinite re-render | Same fiber commits >15 times in 1s | high |
| Stale closure | useCallback/useMemo deps unchanged across state changes where the callback captures stale values | medium |
| Missing effect cleanup | useEffect with non-null create but null destroy, where create references external subscriptions | low |
| Excessive context re-renders | >10 consumers re-render when context value changes | medium |
| Error boundary activation | DidCapture flag set on ClassComponent fiber | medium |

Each detector receives the current event + recent events window and returns 0 or more `framework_error` events.

→ framework-state/react/SPEC.md#Bug Pattern Definitions

**Tests:** Integration tests with purpose-built React fixture apps that trigger each pattern. Verify correct detection with appropriate severity.

### 15.6 — React E2E Tests

Full pipeline tests: `chrome_start` with `frameworkState: true` → load React app → interact → `chrome_mark` → verify persisted events include `framework_detect`, `framework_state`, and `framework_error` events. Test with `session_search` and `session_inspect` to verify events are queryable.

Fixture apps needed:
- `tests/fixtures/browser/react-counter/` — simple counter (useState, basic re-render tracking)
- `tests/fixtures/browser/react-bugs/` — app with stale closure, infinite loop, missing cleanup

---

## Phase 16: Vue State Observer

**Goal:** Full Vue component state observation for Vue 2 and Vue 3 — component lifecycle tracking, reactivity observation, Pinia/Vuex store integration, and bug pattern detection.

**Design focus:** Event emitter shim, Vue 2/3 compatibility branching, store auto-detection, reactivity gotcha detection.

→ framework-state/vue/SPEC.md, INTERFACE.md, ARCH.md

### 16.1 — Vue Hook Shim

Create `src/browser/recorder/framework/vue-observer.ts`. The `getInjectionScript()` method returns the hook shim that:

- Installs `__VUE_DEVTOOLS_GLOBAL_HOOK__` as an event emitter (on/emit/once/off)
- Initializes `apps` Set, `appRecords` array, `enabled: true`, `_buffer` array
- Sets a Vue 2 setter trap on `hook.Vue` to detect Vue 2 registration
- Listens for `app:init` for Vue 3 detection
- Listens for `component:added`, `component:updated`, `component:removed`
- Reports via `__BL__` channel

→ framework-state/vue/ARCH.md#Injection Script

**Tests:** Integration test: load a Vue 3 app, verify hook events intercepted.

### 16.2 — Component Tree Walker

Implement tree traversal for both Vue versions:

- **Vue 3:** Start from `app._instance`. Walk `instance.subTree` VNodes. For each VNode with `.component`, recurse into the child instance. Extract name from `instance.type.name || instance.type.__name || instance.type.__file`.
- **Vue 2:** Start from root instance. Walk `$children` array recursively. Extract name from `$options.name || $options._componentTag`.

Track component path (ancestor chain) for context in events.

→ framework-state/vue/INTERFACE.md#Component Tree Walking

**Tests:** Integration tests with both Vue 2 and Vue 3 apps with nested components.

### 16.3 — State Extraction

Extract state from component instances:

- **Vue 3:** Read `setupState` (Composition API), `data` (Options API), `props`, `provides`. Handle `proxyRefs` auto-unwrapping in setupState.
- **Vue 2:** Read `$data`, `$props`, `_computedWatchers` (computed values), `_watchers`.
- **Serialization:** Same shallow approach as React — max depth 2, try/catch for Proxy edge cases.

Diff strategy: Snapshot state on `component:added`, diff on `component:updated`, record final state on `component:removed`.

→ framework-state/vue/INTERFACE.md#State Extraction

**Tests:** Integration tests with Options API and Composition API components. Verify state diffs for reactive updates.

### 16.4 — Store Integration

Auto-detect Pinia and Vuex stores:

- **Pinia detection:** Check for `getActivePinia()` availability or `instance.appContext.app._context.provides` containing Pinia symbols. If found, iterate `pinia._s` Map and subscribe to each store via `store.$subscribe()` and `store.$onAction()`.
- **Vuex detection:** Check for `instance.proxy.$store` or `instance.appContext.config.globalProperties.$store`. If found, subscribe via `store.subscribe()` and `store.subscribeAction()`.

Report store mutations as `framework_state` events with `changeType: "store_mutation"`.

→ framework-state/vue/ARCH.md#Store Observation

**Tests:** Integration tests with Pinia and Vuex stores. Verify mutation events captured with correct store ID, mutation type, and state diff.

### 16.5 — Vue Bug Pattern Detectors

Implement in `src/browser/recorder/framework/patterns/vue-patterns.ts`:

| Pattern | Detection Logic | Severity |
|---------|----------------|----------|
| Watcher infinite loop | Same component updated >30 times in 2s | high |
| Lost reactivity (Vue 3) | Component re-renders but specific reactive prop doesn't trigger update (heuristic) | medium |
| Vue 2 missing $set() | Property added to reactive object without triggering update (observed via component:updated frequency vs DOM mutation frequency) | medium |
| Pinia mutation outside action | Store state change without preceding action (via $subscribe vs $onAction timing) | low |

→ framework-state/vue/SPEC.md#Bug Pattern Definitions

**Tests:** Integration tests with Vue fixture apps triggering each pattern.

### 16.6 — Vue E2E Tests

Same structure as 15.6:

Fixture apps:
- `tests/fixtures/browser/vue3-counter/` — Composition API counter
- `tests/fixtures/browser/vue2-legacy/` — Options API app (if Vue 2 support is prioritized)
- `tests/fixtures/browser/vue3-pinia/` — Pinia store integration
- `tests/fixtures/browser/vue-bugs/` — reactivity gotchas

---

## Phase 17: Framework-Aware Investigation

**Goal:** The investigation tools (session_search, session_inspect, session_diff) understand framework events natively. Agents can search by component name, filter by framework, and see framework context in diffs. This completes the React + Vue feature set end-to-end before moving to lower-priority frameworks.

**Design focus:** Query engine extension, renderer updates, agent-facing summaries.

### 17.1 — Query Engine Framework Filters

Extend `session_search` with framework-aware filters:

- `--framework react|vue|solid|svelte` — filter events by framework
- `--component "UserProfile"` — search by component name
- `--pattern "stale_closure"` — search by bug pattern name
- FTS5 index includes component names and pattern descriptions

**Tests:** E2E tests with recorded framework sessions. Verify search filters work.

### 17.2 — Framework-Aware Renderers

Update viewport renderers to present framework events compactly:

```
[14:23:01.445] [react] React 18.3.1 detected (1 root, 47 components)
[14:23:02.112] [react] UserProfile: isLoading false→true (render #3)
[14:23:02.118] [react] UserProfile: isLoading true→false, data null→{id:482} (render #4)
[14:23:02.200] [react:warn] SearchBar: useCallback deps stale — possible stale closure
[14:23:03.500] [react:error] CartContext: 23 re-renders in 500ms — infinite loop suspected
```

Respect existing token budgets. Framework events get the same priority as console errors in the budget allocation.

**Tests:** Snapshot tests for framework event rendering.

### 17.3 — Framework Context in Diffs

Extend `session_diff` to include framework state comparison:

- Component mount/unmount deltas between two moments
- State value changes per component
- Store state deltas (Pinia/Vuex mutations between moments)
- Active bug patterns at each moment

**Tests:** E2E diff tests with framework state changes.

---

## Phase 18: Solid State Observer (Tier 2)

**Goal:** Signal and store observation for SolidJS dev-mode builds. Component attribution via ownership tree. Clear documentation of limitations.

**Design focus:** DEV hook access challenge, signal interception strategy, graceful degradation for production builds.

→ framework-state/solid/SPEC.md, INTERFACE.md, ARCH.md

### 18.1 — Solid Detection & DEV Access

Create `src/browser/recorder/framework/solid-observer.ts`. Two-phase approach:

1. **Phase A (before app loads):** Inject a script that monkey-patches `Object.defineProperty` or `Function.prototype.call` to intercept when `createSignal` is first invoked. Wrap signal setters at creation time.
2. **Phase B (after app loads):** Check for `window.__SOLID_DEV__` (bridge script) or `window._$SOLID` (solid-devtools). If found, set `DEV.hooks.afterRegisterGraph` and `DEV.hooks.afterUpdate`.

Report `framework_detect` with `devMode: true/false`. If `devMode: false`, log a warning and fall back to DOM-level observation only.

→ framework-state/solid/ARCH.md#Injection Strategy

**Tests:** Integration test with a Solid dev-mode app. Verify detection and DEV hook access.

### 18.2 — Signal & Store Observation

If DEV is accessible:

- Set `DEV.hooks.afterRegisterGraph` to catalog all signals with names and initial values
- Set `DEV.hooks.afterUpdate` to trigger state snapshot collection
- Set store `DevHooks.onStoreNodeUpdate` for fine-grained store mutation tracking
- Optionally wrap signal setters (from 18.1 Phase A) for per-signal change tracking

Generate `framework_state` events on each update cycle.

→ framework-state/solid/INTERFACE.md#Signal Observation Strategies

**Tests:** Integration test with signals and stores. Verify change events captured.

### 18.3 — Ownership Tree & Component Attribution

Walk the ownership tree for component context:

- Start from `getOwner()` or intercepted root owners
- Walk `owner.owner` (parent) and `owner.owned` (children)
- Infer component boundaries from owner structure
- Limited component names without the Vite plugin — document this clearly

→ framework-state/solid/INTERFACE.md#Ownership Tree Traversal

**Tests:** Integration test with nested Solid components. Verify ownership tree captured (even with anonymous names).

### 18.4 — Solid Bug Pattern Detectors

Implement in `src/browser/recorder/framework/patterns/solid-patterns.ts`:

| Pattern | Detection Logic | Severity |
|---------|----------------|----------|
| Signal outside tracking scope | Signal read observed but zero observers registered | medium |
| Store mutation bypassing setter | DOM mutation observed without corresponding onStoreNodeUpdate | low |

Limited pattern detection compared to React/Vue due to Solid's fine-grained model. Document this.

**Tests:** Integration tests with Solid fixture apps.

---

## Phase 19: Svelte State Observer (Tier 3)

**Goal:** Svelte 4 component observation via `$$invalidate` interception and `$capture_state()`. Svelte 5 fallback to DOM-level heuristics. Designed to upgrade when Svelte ships devtools hooks (issue #11389).

**Design focus:** Version detection and branching, Svelte 4 prototype patching, Svelte 5 graceful degradation, version-adaptive observer factory.

→ framework-state/svelte/SPEC.md, INTERFACE.md, ARCH.md

### 19.1 — Svelte Detection & Version Branching

Create `src/browser/recorder/framework/svelte-observer.ts` with a factory:

```typescript
function createSvelteObserver(version: 4 | 5): Svelte4Observer | Svelte5Observer
```

Detection: Check for `SvelteComponentDev` in prototype chain (Svelte 4 dev), `SvelteComponent` (Svelte 4 prod), `__svelte_meta` on DOM elements (Svelte 5 dev). Report version in `framework_detect`.

→ framework-state/svelte/SPEC.md#Version Detection

**Tests:** Integration tests that correctly identify Svelte 4 vs 5.

### 19.2 — Svelte 4 Observer

Monkey-patch `SvelteComponentDev` (or `init()` from `svelte/internal`):

- Intercept component creation → register instance, wrap `$$invalidate`
- On `$$invalidate(index, value)`: use `$capture_state()` to get named state, compute diff
- On component destroy: report unmount
- Track per-component update count

→ framework-state/svelte/ARCH.md#Svelte 4 Observer Flow

**Tests:** Integration test with a Svelte 4 dev-mode app. Verify state changes captured with variable names.

### 19.3 — Svelte 5 Fallback

Until issue #11389 ships:

- MutationObserver on document for DOM changes
- Correlate DOM mutations with `__svelte_meta` element metadata (dev mode) for component attribution
- Report as `framework_state` events with reduced granularity (no variable names, no state values — only "component X updated")
- Log a note explaining the limitation

→ framework-state/svelte/ARCH.md#Svelte 5 Current Strategy

**Tests:** Integration test with a Svelte 5 app. Verify DOM-level events captured. Verify note about limitations.

### 19.4 — Svelte Bug Pattern Detectors

Implement in `src/browser/recorder/framework/patterns/svelte-patterns.ts`:

| Pattern | Detection Logic | Severity |
|---------|----------------|----------|
| Mutation without assignment (Svelte 4) | `$$invalidate` not called after DOM mutation in component scope | medium |
| Store subscription leak (Svelte 4) | `subscribe()` call without matching `unsubscribe` in `on_destroy` | low |

Svelte 5 patterns: deferred until hooks API ships.

**Tests:** Integration tests with Svelte 4 fixture apps.

---

## Dependency Graph

```
Phase 12: Browser Intelligence (existing)
    │
    └── Phase 14: Framework Detection & Infrastructure
            │
            ├── Phase 15: React State Observer  ─┐
            │                                    ├→ Phase 17: Investigation Integration
            └── Phase 16: Vue State Observer    ─┘
                                                    │
                                                    ├── Phase 18: Solid Observer (Tier 2, someday)
                                                    └── Phase 19: Svelte Observer (Tier 3, someday)
```

Phases 15 and 16 can run in parallel after Phase 14.
Phase 17 follows after both 15 and 16 — completes the React + Vue feature set end-to-end.
Phases 18 and 19 are future work, lower priority, can start after Phase 14 but benefit from Phase 17's investigation infrastructure.

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Start with React + Vue | Tier 1 | Mature global hooks, passive detection, work in production builds |
| Solid as Tier 2 | Requires dev builds | DEV hooks stripped in production. Bridge script or module interception needed |
| Svelte as Tier 3 | Svelte 5 hooks missing | sveltejs/svelte#11389 unresolved. Svelte 4 works but Svelte 5 is DOM-only fallback |
| Same `__BL__` channel | Reuse existing pipeline | No new transport mechanism. Framework events are just new event types in the same stream |
| Config-gated features | `features.frameworkState` | Keeps install lightweight. Agents not debugging frontend don't see framework tools |
| No new MCP tools | Extend existing search/inspect | Framework events are queryable through existing tools. Avoids tool sprawl |
| Throttle strategy | RAF + 10 events/flush cap | Prevents framework observer from flooding the buffer during rapid re-renders |
| Shallow serialization | Depth 2, 200 char strings | Deep state serialization is expensive and blows token budgets. Inspect on demand |
| Per-framework skills | Separate SKILL.md per framework | Agents working on React bugs load React-specific debugging knowledge. No cross-contamination |
