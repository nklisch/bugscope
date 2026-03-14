# Svelte Observer — Architecture

This document describes the implementation architecture for the Svelte framework state observer in Krometrail. It covers the injection strategy, observation flow, component tracking, bug pattern detection, and integration with the broader Browser Lens pipeline.

---

## Svelte 4 Injection Strategy

Svelte 4 components are class-based and share a common initialization path through the internal `init()` function and the `SvelteComponent` / `SvelteComponentDev` base class.

### Monkey-Patching Approach

The injection script runs via `Page.addScriptToEvaluateOnNewDocument` before any application code loads. It installs a shim that intercepts component creation.

**Primary target: `SvelteComponentDev` prototype**

```javascript
// Injected before app loads
(function() {
  const observer = window.__BL_SVELTE__ = {
    instances: new Map(),   // component → tracking data
    version: null,
    devMode: false,
  };

  // Poll for SvelteComponentDev availability
  // (it's defined when svelte/internal module loads)
  const patchInterval = setInterval(() => {
    // Check for dev-mode base class
    const DevClass = window.__svelte_devtools_SvelteComponentDev
      || findSvelteDevClass();
    if (!DevClass) return;

    clearInterval(patchInterval);
    observer.devMode = true;
    observer.version = detectVersion(DevClass);

    const originalInit = DevClass.prototype.$$.constructor;
    // Patch the constructor to intercept component creation
    wrapConstructor(DevClass, observer);

    report('framework_detect', {
      framework: 'svelte',
      version: observer.version,
      devMode: true,
      runes: false,
    });
  }, 10);

  // Timeout after 5s — if no Svelte detected, clean up
  setTimeout(() => clearInterval(patchInterval), 5000);
})();
```

**Fallback: Intercept via `init()` function patching**

If prototype patching is not possible (e.g., the `init` function is captured in a closure before our patch runs), use a MutationObserver to detect when Svelte components mount to the DOM, then retroactively wrap their `$$invalidate`.

### Wrapping `$$invalidate`

For each detected component instance, replace `$$.update` (the invalidation scheduler) or directly wrap the component's bound `$$invalidate` reference:

```javascript
function wrapComponent(component, observer) {
  const $$ = component.$$;
  const originalInvalidate = $$.invalidate || findInvalidateRef(component);

  const tracking = {
    name: component.constructor.name || 'Unknown',
    renderCount: 0,
    lastState: null,
    createdAt: performance.now(),
  };
  observer.instances.set(component, tracking);

  // Wrap $$invalidate to intercept state changes
  const wrappedInvalidate = function(index, value) {
    const prev = $$.ctx[index];
    const result = originalInvalidate.call(this, index, value);

    // Capture the change
    const key = component.$capture_state
      ? Object.keys(component.$capture_state())[index] || `ctx[${index}]`
      : `ctx[${index}]`;

    bufferChange(tracking, { key, prev, next: $$.ctx[index] });
    return result;
  };

  // Install the wrapper
  patchInvalidateRef(component, wrappedInvalidate);

  // Track lifecycle
  $$.on_destroy.push(() => {
    observer.instances.delete(component);
    report('framework_state', {
      framework: 'svelte',
      componentName: tracking.name,
      changeType: 'unmount',
      renderCount: tracking.renderCount,
      svelteVersion: 4,
    });
  });

  // Report mount
  report('framework_state', {
    framework: 'svelte',
    componentName: tracking.name,
    changeType: 'mount',
    svelteVersion: 4,
  });
}
```

---

## Svelte 4 Observer Flow

```
Component created
    │
    ├─ init() called (internal)
    │   └─ Our shim intercepts → register instance
    │       └─ Wrap $$invalidate on this instance
    │       └─ Hook on_destroy for cleanup
    │       └─ Report framework_state { changeType: "mount" }
    │
    ├─ $$invalidate(index, value) called (assignment in component)
    │   └─ Wrapped $$invalidate fires
    │       ├─ Record prev = $$.ctx[index]
    │       ├─ Call original $$invalidate
    │       ├─ Record next = $$.ctx[index]
    │       ├─ If $capture_state available: resolve variable name
    │       ├─ Buffer change: { key, prev, next }
    │       └─ Schedule flush (microtask boundary)
    │
    ├─ Microtask flush (Svelte batches dirty updates)
    │   └─ Our flush handler fires
    │       ├─ Increment renderCount
    │       ├─ Collect all buffered changes for this component
    │       ├─ Run bug pattern detectors
    │       └─ Report framework_state { changeType: "update", changes: [...] }
    │
    └─ Component destroyed
        └─ on_destroy callback fires
            ├─ Remove from instances Map
            └─ Report framework_state { changeType: "unmount" }
```

### State Name Resolution

In dev mode, use `$capture_state()` to map `ctx` indices to variable names. Cache the mapping per component class (indices are stable for a given component definition).

```javascript
function buildIndexMap(component) {
  if (!component.$capture_state) return null;
  const state = component.$capture_state();
  const keys = Object.keys(state);
  // keys are ordered to match ctx indices
  return keys;
}
```

In production (no `$capture_state`), report as `ctx[0]`, `ctx[1]`, etc. The agent will see values but not names.

---

## Svelte 5 Strategy (Current)

Until sveltejs/svelte#11389 ships devtools hooks, Svelte 5 observation falls back to DOM-level heuristics.

### MutationObserver + Heuristic Detection

```javascript
function observeSvelte5(observer) {
  // Detect Svelte 5 via signal runtime
  if (!detectSvelte5Signals()) return false;

  observer.version = detectSvelte5Version();
  report('framework_detect', {
    framework: 'svelte',
    version: observer.version,
    devMode: hasSvelteMeta(),
    runes: true,
    componentCount: 0, // Cannot enumerate without hooks
  });

  // DOM-level observation only
  const mo = new MutationObserver((mutations) => {
    const changes = groupMutationsByComponent(mutations);
    for (const [componentName, domChanges] of changes) {
      report('framework_state', {
        framework: 'svelte',
        componentName,
        changeType: 'update',
        changes: domChanges,
        triggerSource: 'unknown', // Cannot determine without signal hooks
        svelteVersion: 5,
      });
    }
  });

  mo.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
}
```

### Component Attribution via `__svelte_meta`

In Svelte 5 dev mode, DOM elements carry `__svelte_meta` with source file location. Use this to attribute DOM mutations to components:

```javascript
function groupMutationsByComponent(mutations) {
  const groups = new Map();
  for (const mutation of mutations) {
    const target = mutation.target;
    const meta = findNearestSvelteMeta(target);
    const name = meta ? extractComponentName(meta.loc.file) : 'Unknown';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(describeMutation(mutation));
  }
  return groups;
}

function findNearestSvelteMeta(element) {
  let el = element;
  while (el && el !== document.body) {
    if (el.__svelte_meta) return el.__svelte_meta;
    el = el.parentElement;
  }
  return null;
}
```

### Limitations Clearly Reported

When Svelte 5 is detected without devtools hooks, the `framework_detect` event must include a `limitations` field:

```typescript
{
  framework: "svelte",
  version: "5.x.x",
  devMode: boolean,
  runes: true,
  limitations: [
    "No component enumeration — devtools hooks not shipped (sveltejs/svelte#11389)",
    "State changes reported at DOM level only — no reactive signal observation",
    "Component attribution requires dev mode (__svelte_meta)",
    "Bug pattern detection limited to DOM-observable symptoms",
  ],
}
```

---

## Svelte 5 Strategy (Future)

When issue #11389 ships, the observer should be updated to use the official hooks. The design is version-adaptive:

```javascript
function createSvelteObserver() {
  const version = detectSvelteVersion();

  if (version.major === 4 && version.devMode) {
    return new Svelte4DevObserver();      // Full observation via $$invalidate + $capture_state
  }
  if (version.major === 4) {
    return new Svelte4ProdObserver();     // Limited: ctx indices only, no names
  }
  if (version.major === 5 && version.hasDevtoolsHooks) {
    return new Svelte5HookObserver();     // Future: full observation via official hooks
  }
  if (version.major === 5) {
    return new Svelte5FallbackObserver(); // Current: MutationObserver + __svelte_meta
  }

  return null; // Unknown version — report detection only
}
```

The `Svelte5HookObserver` class is a placeholder. Its interface should mirror the Svelte 4 observer's output so the rest of the pipeline does not need version-specific handling.

---

## Component Tracking

### Instance Map

```typescript
interface SvelteComponentTracking {
  name: string;                    // Component name from constructor or metadata
  renderCount: number;             // Number of completed patch cycles
  lastState: Record<string, any> | null;  // Last $capture_state() snapshot (Svelte 4 dev)
  lastDirty: string | null;        // Hex of last dirty bitmask
  createdAt: number;               // performance.now() timestamp
  parentName: string | null;       // Parent component name (if tree tracking available)
  changeBuffer: StateChange[];     // Buffered changes pending flush
}

// Map<ComponentInstance, SvelteComponentTracking>
```

### Dirty Bitmask Decoding (Svelte 4)

The `$$.dirty` array tracks which state variables are invalidated. Decoding it identifies exactly which variables changed in an update:

```javascript
function decodeDirtyBitmask(dirty, indexMap) {
  const changed = [];
  for (let word = 0; word < dirty.length; word++) {
    for (let bit = 0; bit < 32; bit++) {
      if (dirty[word] & (1 << bit)) {
        const index = word * 32 + bit;
        const name = indexMap ? indexMap[index] : `ctx[${index}]`;
        if (name) changed.push(name);
      }
    }
  }
  return changed;
}
```

---

## Bug Pattern Detection

### Svelte 4 Detectors

**`mutation_without_assignment`**

The highest-value pattern. Svelte 4 requires reassignment to trigger reactivity — `array.push(item)` silently fails to update the DOM.

```javascript
function detectMutationWithoutAssignment(tracking, component) {
  // Compare current ctx values with last snapshot via deep equality
  // If a value changed (object/array contents differ) but no
  // $$invalidate was observed for that index, flag it.
  if (!component.$capture_state) return null;

  const current = component.$capture_state();
  const prev = tracking.lastState;
  if (!prev) return null;

  for (const [key, value] of Object.entries(current)) {
    if (isObject(value) && isObject(prev[key])) {
      if (!deepEqual(value, prev[key]) && !tracking.changeBuffer.some(c => c.key === key)) {
        return {
          pattern: 'mutation_without_assignment',
          severity: 'high',
          componentName: tracking.name,
          detail: `"${key}" was mutated without reassignment. Svelte 4 requires \`${key} = ${key}\` after mutation to trigger reactivity.`,
          evidence: { key, prev: prev[key], current: value },
        };
      }
    }
  }
  return null;
}
```

**`store_subscription_leak`**

```javascript
function detectStoreSubscriptionLeak(component) {
  // Check if on_destroy has unsubscribe callbacks for all detected store subscriptions
  // Auto-subscriptions ($store syntax) are safe — compiler generates cleanup
  // Manual .subscribe() calls without corresponding on_destroy cleanup are flagged
  const $$ = component.$$;
  // Heuristic: if component has stores in context but fewer on_destroy
  // callbacks than expected, flag potential leak
}
```

### Svelte 5 Detectors

Limited to DOM-level observation. These run against MutationObserver data:

```javascript
function detectDerivedObjectChurn(componentMutations) {
  // If the same DOM elements are repeatedly updated with structurally
  // identical content in rapid succession, suspect $derived returning
  // new object references unnecessarily.
  // Threshold: >5 identical-content updates to same element in 1 second.
}
```

---

## Version Detection and Branching

Detection runs once on page load. The result determines which observer implementation is instantiated.

```javascript
function detectSvelteVersion() {
  // 1. Check for SvelteComponentDev (Svelte 4 dev mode)
  const devClass = findGlobalClass('SvelteComponentDev');
  if (devClass) {
    return { major: 4, devMode: true, version: extractVersionFromDev(devClass) };
  }

  // 2. Check for SvelteComponent class-based (Svelte 4 production)
  const baseClass = findGlobalClass('SvelteComponent');
  if (baseClass && isClassBased(baseClass)) {
    return { major: 4, devMode: false, version: '4.x' };
  }

  // 3. Check for Svelte 5 signal runtime
  if (detectSvelte5Signals()) {
    const hasMeta = !!document.querySelector('[__svelte_meta]')
      || checkElementsForSvelteMeta();
    return {
      major: 5,
      devMode: hasMeta,
      version: '5.x',
      hasDevtoolsHooks: typeof window.__svelte_devtools_hook__ !== 'undefined',
    };
  }

  // 4. Check DOM for Svelte markers (fallback)
  if (findSvelteMarkers()) {
    return { major: null, devMode: false, version: 'unknown' };
  }

  return null; // Not Svelte
}
```

---

## Fallback Behavior

When neither Svelte 4 dev APIs nor Svelte 5 hooks are available:

1. **Report `framework_detect` only.** Confirm Svelte is present, report version if determinable, note `devMode: false`.
2. **Do not install state observers.** Without dev APIs, state observation adds overhead with minimal value.
3. **Rely on generic observation.** The existing Browser Lens DOM observation (MutationObserver), console capture, and network tracking continue to function. The agent gets DOM-level events without framework attribution.
4. **Inform the agent.** The `framework_detect` event includes a clear statement that framework-level state granularity is unavailable and why.

This ensures Krometrail never degrades the debugging experience — it either adds value or stays out of the way.

---

## Integration Point

### FrameworkTracker to EventPipeline

The Svelte observer is one of several framework observers managed by `FrameworkTracker`. The integration follows the same pattern as React and Vue observers:

```
BrowserRecorder
  └─ FrameworkTracker (orchestrator)
       ├─ detector.ts          — runs detection, selects observer
       ├─ react-observer.ts    — React fiber hooks
       ├─ vue-observer.ts      — Vue devtools hooks
       ├─ solid-observer.ts    — Solid DEV hooks
       └─ svelte-observer.ts   — Svelte observer (this feature)
             ├─ Svelte4DevObserver
             ├─ Svelte4ProdObserver
             ├─ Svelte5HookObserver (future)
             └─ Svelte5FallbackObserver
```

All observers emit events through the `__BL__` console.debug channel:

```javascript
function report(type, data) {
  console.debug(JSON.stringify({
    __BL__: true,
    type,            // "framework_detect" | "framework_state" | "framework_error"
    timestamp: Date.now(),
    data,
  }));
}
```

The `EventPipeline` in the Node.js process picks up these `__BL__` messages via CDP `Runtime.consoleAPICalled` events, parses them, and adds them to the session's event buffer. No framework-specific handling is needed in the pipeline — the event schema is uniform across all framework observers.

### FrameworkTracker Lifecycle

```
chrome_start (with features.frameworkState enabled)
    │
    ├─ BrowserRecorder creates FrameworkTracker
    ├─ FrameworkTracker injects detection + observer scripts
    │   via Page.addScriptToEvaluateOnNewDocument
    │
    ├─ Page loads → detection script runs
    │   └─ Reports framework_detect via __BL__
    │   └─ Selected observer starts capturing state changes
    │
    ├─ State changes → framework_state events via __BL__
    ├─ Bug patterns → framework_error events via __BL__
    │
    └─ chrome_stop
        └─ FrameworkTracker disposes observers
        └─ MutationObservers disconnected
        └─ Instance maps cleared
```

---

## File Layout

```
src/browser/
  recorder/
    framework/
      index.ts                  # FrameworkTracker class
      detector.ts               # Auto-detect framework + version
      svelte-observer.ts        # Main entry — version detection, observer selection
      svelte/
        svelte4-dev.ts          # Svelte 4 dev-mode observer (full)
        svelte4-prod.ts         # Svelte 4 production observer (limited)
        svelte5-fallback.ts     # Svelte 5 MutationObserver fallback
        svelte5-hooks.ts        # Svelte 5 devtools hooks (placeholder)
        patterns.ts             # Bug pattern detectors for Svelte
        types.ts                # Shared types for Svelte tracking
      react-observer.ts
      vue-observer.ts
      solid-observer.ts
      patterns/
        react-patterns.ts
        vue-patterns.ts
        solid-patterns.ts
        svelte-patterns.ts      # Re-exports from svelte/patterns.ts
```

The Svelte observer is split into version-specific implementations under `svelte/` to keep each file focused. The top-level `svelte-observer.ts` acts as a factory, selecting the appropriate implementation based on runtime detection.
