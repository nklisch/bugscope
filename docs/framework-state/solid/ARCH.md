# Solid Observer — Architecture

This document describes the implementation architecture for Solid state observation in Krometrail: injection strategy, observer flow, state tracking, bug pattern detection, and integration with the existing event pipeline.

---

## Injection Strategy

Unlike React (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) and Vue (`__VUE_DEVTOOLS_GLOBAL_HOOK__`), Solid has no global hook that can be shimmed before the framework loads. The observer must either intercept Solid's primitives at the module level or require the app to expose its `DEV` export.

### Two-Phase Injection

The observer uses a two-phase approach, both executed via `Page.addScriptToEvaluateOnNewDocument`:

#### Phase 1: Monkey-Patch Primitives (Best-Effort Automatic)

Before the app's bundle loads, install traps on known patterns:

```javascript
// solid-observer-phase1.js — injected before any app script
(function() {
  "use strict";

  const BL = window.__BL_SOLID__ = {
    signals: new Map(),     // id → { name, value, observers, writeCount }
    owners: new Map(),      // id → Owner
    pendingChanges: [],     // queued during batch
    detected: false,
    devAvailable: false,
    nextId: 0,
  };

  // Strategy A: Intercept ESM imports in Vite dev server
  // Vite serves modules as native ESM — we can intercept via import map
  // or by patching the module's namespace object after first import.
  //
  // This only works in Vite dev mode (not production bundles).
  if (document.querySelector('script[type="module"][src*="/@vite/client"]')) {
    BL.viteDetected = true;
    // Vite's HMR client loads before app modules
    // We can use import.meta.hot to intercept solid-js module
  }

  // Strategy B: Wait for DEV to appear on window
  // If the app includes a bridge script, __SOLID_DEV__ will be set
  const checkDev = () => {
    if (window.__SOLID_DEV__) {
      BL.devAvailable = true;
      installDevHooks(window.__SOLID_DEV__);
    }
  };

  // Poll briefly, then fall back to MutationObserver for DOM-level detection
  let pollCount = 0;
  const poll = setInterval(() => {
    checkDev();
    if (BL.devAvailable || ++pollCount > 50) {
      clearInterval(poll);
      if (!BL.devAvailable) {
        detectSolidFromDOM();
      }
    }
  }, 100);

  window.__BL_SOLID_INSTALL__ = installDevHooks;

  function installDevHooks(DEV) {
    // ... Phase 2 hooks (see below)
  }
})();
```

#### Phase 2: Install DEV Hooks

Once `DEV` is accessible, install observation hooks:

```javascript
function installDevHooks(DEV) {
  const BL = window.__BL_SOLID__;
  BL.devAvailable = true;

  // Chain with existing hooks (solid-devtools compatibility)
  const existingAfterRegister = DEV.hooks.afterRegisterGraph;
  const existingAfterUpdate = DEV.hooks.afterUpdate;
  const existingAfterCreateOwner = DEV.hooks.afterCreateOwner;

  // 1. Track all reactive primitive creation
  DEV.hooks.afterRegisterGraph = (node) => {
    existingAfterRegister?.(node);

    const id = BL.nextId++;
    BL.signals.set(id, {
      name: node.name ?? `signal-${id}`,
      value: node.value,
      node: node,
      writeCount: 0,
    });
  };

  // 2. Batch boundary — flush accumulated changes
  DEV.hooks.afterUpdate = () => {
    existingAfterUpdate?.();

    if (BL.pendingChanges.length > 0) {
      const changes = BL.pendingChanges.splice(0);
      // Group by owner/component for consolidated reporting
      const grouped = groupChangesByComponent(changes);
      for (const [componentName, componentChanges] of grouped) {
        console.debug("__BL__", JSON.stringify({
          type: "framework_state",
          ts: Date.now(),
          data: {
            framework: "solid",
            componentName,
            componentPath: componentChanges[0]?.componentPath,
            changeType: "update",
            changes: componentChanges.map(c => ({
              key: c.signalName,
              prev: c.prev,
              next: c.next,
            })),
            triggerSource: "signal_write",
          }
        }));
      }
    }
  };

  // 3. Track ownership tree
  DEV.hooks.afterCreateOwner = (owner) => {
    existingAfterCreateOwner?.(owner);

    const id = BL.nextId++;
    BL.owners.set(id, owner);

    if (owner.name && /^[A-Z]/.test(owner.name)) {
      console.debug("__BL__", JSON.stringify({
        type: "framework_state",
        ts: Date.now(),
        data: {
          framework: "solid",
          componentName: owner.name,
          componentPath: getComponentPath(owner),
          changeType: "mount",
        }
      }));
    }
  };

  // 4. Patch writeSignal for fine-grained signal tracking
  if (typeof DEV.writeSignal === "function") {
    const origWrite = DEV.writeSignal.bind(DEV);
    DEV.writeSignal = function(node, value) {
      const prev = node.value;
      const result = origWrite(node, value);
      const next = node.value;

      if (prev !== next) {
        BL.pendingChanges.push({
          signalName: node.name ?? "anonymous",
          prev: summarizeValue(prev),
          next: summarizeValue(next),
          owner: node.owner,
          componentPath: node.owner ? getComponentPath(node.owner) : undefined,
        });
      }

      return result;
    };
  }

  // Emit detection event
  console.debug("__BL__", JSON.stringify({
    type: "framework_detect",
    ts: Date.now(),
    data: {
      framework: "solid",
      version: detectSolidVersion(),
      rootCount: countRoots(),
      componentCount: BL.owners.size,
      devMode: true,
    }
  }));
}
```

---

## Observer Flow

```
┌─────────────────────────────────────────────────────────────┐
│  addScriptToEvaluateOnNewDocument                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  solid-observer-phase1.js                            │    │
│  │    • Install __BL_SOLID__ state container            │    │
│  │    • Detect Vite dev server                          │    │
│  │    • Poll for __SOLID_DEV__ (bridge script)          │    │
│  │    • Fallback: DOM-level Solid detection              │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │ DEV becomes available              │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │  installDevHooks(DEV)                                │    │
│  │    • DEV.hooks.afterRegisterGraph → signal registry  │    │
│  │    • DEV.hooks.afterCreateOwner → ownership tree     │    │
│  │    • DEV.writeSignal patch → fine-grained tracking   │    │
│  │    • DEV.hooks.afterUpdate → batch flush             │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │  Runtime Observation Loop                            │    │
│  │                                                      │    │
│  │  Signal write detected (via writeSignal patch)       │    │
│  │    → Queue change with prev/next + owner context     │    │
│  │    → ... more signal writes in same batch ...        │    │
│  │  afterUpdate() fires                                 │    │
│  │    → Group queued changes by component               │    │
│  │    → Emit framework_state via console.debug("__BL__")│    │
│  │    → Run bug pattern detection on batch              │    │
│  │    → Emit framework_error if patterns matched        │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ console.debug("__BL__", ...)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  EventPipeline (Node.js / BrowserRecorder)                  │
│    • Runtime.consoleAPICalled listener                       │
│    • Parse __BL__ events                                    │
│    • Buffer → Persistence → Investigation tools             │
└─────────────────────────────────────────────────────────────┘
```

---

## State Tracking

The observer maintains two primary data structures in the browser context:

### Signal Registry

```typescript
// window.__BL_SOLID__.signals
Map<number, {
  name: string;              // debug name
  value: unknown;            // current value (reference, not snapshot)
  node: SignalState;          // reference to Solid's internal signal node
  writeCount: number;         // total writes since creation
  lastWriteTs: number;        // timestamp of last write
  ownerName?: string;         // component that created this signal
}>
```

Used for: state snapshots on `session_inspect`, signal write counting for `excessive_signal_writes` detection, diffing on `afterUpdate`.

### Ownership Tree

```typescript
// window.__BL_SOLID__.owners
Map<number, Owner>
```

Used for: component path construction, mount/unmount detection, component attribution for signal writes, tree rendering for `session_inspect` with `?framework=tree` query.

Both structures are weak references where possible to avoid preventing garbage collection of disposed owners and signals.

---

## Store Observation

Solid stores (`createStore`) use a Proxy-based reactive system separate from signals. Store mutations through the setter function fire `onStoreNodeUpdate`:

```typescript
function installStoreHooks() {
  // Access the store dev hooks symbol
  const STORE_DEV = Symbol.for("store-dev-hooks");

  // Patch createStore to intercept new stores
  // (requires access to the store module's createStore function)

  // When a store node is created, attach our observer:
  function observeStore(storeProxy: StoreNode, storeName: string) {
    const devNode = storeProxy[STORE_DEV];
    if (!devNode) return;

    const existingHook = devNode.onStoreNodeUpdate;
    devNode.onStoreNodeUpdate = (state, property, value, prev) => {
      existingHook?.(state, property, value, prev);

      BL.pendingChanges.push({
        signalName: `${storeName}.${property}`,
        prev: summarizeValue(prev),
        next: summarizeValue(value),
        changeType: "store_mutation",
        owner: null,  // stores are not owned by a single component
      });
    };
  }
}
```

Store mutation events use `changeType: "store_mutation"` in `framework_state` and include the property path (e.g., `"todos[2].completed"`).

---

## Bug Pattern Detection

Pattern detection runs at the `afterUpdate` batch boundary, after all signal writes for the current cycle have been collected.

### Detection Flow

```typescript
function runPatternDetection(changes: QueuedChange[], batch: BatchInfo) {
  const errors: FrameworkError[] = [];

  // 1. Untracked signal read
  for (const [id, signal] of BL.signals) {
    if (signal.readCount > 0 && signal.node.observers?.size === 0) {
      errors.push({
        pattern: "untracked_signal_read",
        componentName: signal.ownerName ?? "unknown",
        severity: "medium",
        detail: `Signal "${signal.name}" was read but has no observers. ` +
                `The read occurred outside a tracking scope — changes to this ` +
                `signal will not trigger updates.`,
        evidence: { signalName: signal.name, observerCount: 0 },
      });
    }
  }

  // 2. Excessive signal writes
  const writeCounts = new Map<string, number>();
  for (const change of changes) {
    const key = change.signalName;
    writeCounts.set(key, (writeCounts.get(key) ?? 0) + 1);
  }
  for (const [name, count] of writeCounts) {
    if (count > 20) {  // threshold: 20 writes to same signal in one cycle
      errors.push({
        pattern: "excessive_signal_writes",
        componentName: changes.find(c => c.signalName === name)?.ownerName ?? "unknown",
        severity: "high",
        detail: `Signal "${name}" was written ${count} times in a single update cycle. ` +
                `This may indicate a reactive loop.`,
        evidence: { signalName: name, writeCount: count },
      });
    }
  }

  // 3. Missing cleanup (checked on owner disposal)
  // ... see SPEC.md for detection logic

  // 4. Destructured props (heuristic, checked on mount)
  // ... see SPEC.md for detection logic

  for (const error of errors) {
    console.debug("__BL__", JSON.stringify({
      type: "framework_error",
      ts: Date.now(),
      data: { framework: "solid", ...error },
    }));
  }
}
```

### Pattern Detection Limitations

| Pattern | Confidence | Notes |
|---------|-----------|-------|
| `untracked_signal_read` | High | Observable via `observers` set. May false-positive for intentional `untrack()` usage. |
| `destructured_props` | Low | Heuristic only. Cannot distinguish destructuring from other eager reads without AST access. |
| `missing_memo` | Medium | Requires tracking which signals are read inside which computations. Overhead scales with graph complexity. |
| `store_direct_mutation` | Very low | Direct mutations bypass the proxy entirely — they are invisible to us. Only detectable by user report. |
| `missing_cleanup` | Medium | Heuristic based on effect body analysis. Cannot inspect the closure source at runtime. |
| `excessive_signal_writes` | High | Direct count. Threshold is configurable. |

---

## Challenge: DEV Access

This is the single largest implementation challenge for the Solid observer. A summary of strategies and their tradeoffs:

| Strategy | Auto? | Bundler support | Reliability | Notes |
|----------|-------|----------------|-------------|-------|
| Bridge script (`window.__SOLID_DEV__`) | No | All | High | Requires app modification |
| Vite ESM interception | Yes | Vite dev only | Medium | Breaks on Vite config variations |
| Module loader patch | Yes | Webpack, esbuild | Low | Depends on bundle output format |
| Vite plugin | No | Vite | High | Best DX, highest setup cost |

**Recommendation for v1:** Require the bridge script approach. Document it clearly in the `chrome_start` tool description when `frameworkState` includes `"solid"`. Attempt automatic Vite dev server detection as a best-effort enhancement.

---

## Fallback Behavior

When Solid is detected but `DEV` is not accessible (production build or bridge script not installed):

1. Emit `framework_detect` with `devMode: false` and a `warning` field:

```typescript
{
  type: "framework_detect",
  ts: Date.now(),
  data: {
    framework: "solid",
    version: "unknown",     // cannot read version without DEV
    rootCount: 0,
    componentCount: 0,
    devMode: false,
    warning: "Solid detected but DEV hooks unavailable. " +
             "Signal-level observation requires a dev-mode build. " +
             "Falling back to DOM-level observation only."
  }
}
```

2. Fall back to `MutationObserver`-based DOM observation. This captures:
   - DOM node additions/removals (component mount/unmount approximation)
   - Attribute changes (reactive binding updates)
   - Text content changes

3. Do not emit `framework_state` or `framework_error` events — these require signal-level access that is only available through `DEV` hooks.

---

## Integration Point

### FrameworkTracker

`SolidObserver` plugs into the `FrameworkTracker` orchestrator (see [APPROACH.md](../APPROACH.md)):

```typescript
// src/browser/recorder/framework/index.ts
class FrameworkTracker {
  private observers: Map<string, FrameworkObserver>;

  async initialize(page: CDPSession, config: FrameworkConfig) {
    if (config.includes("solid") || config.includes("auto")) {
      this.observers.set("solid", new SolidObserver());
    }
    // ... other frameworks ...

    // Inject all observer scripts before page load
    for (const observer of this.observers.values()) {
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: observer.getInjectionScript(),
      });
    }
  }
}
```

### EventPipeline Integration

Framework events arrive through the existing `Runtime.consoleAPICalled` listener that already handles `__BL__` events from the input tracker and screenshot modules. No new listeners are needed.

```
Runtime.consoleAPICalled
  → args[0] === "__BL__"
    → parse args[1] as JSON
      → event.type === "framework_detect" → FrameworkTracker.onDetect()
      → event.type === "framework_state"  → EventPipeline.push()
      → event.type === "framework_error"  → EventPipeline.push() + AutoDetect.evaluate()
```

---

## File Layout

```
src/browser/
  recorder/
    framework/
      index.ts                    # FrameworkTracker orchestrator
      detector.ts                 # Framework auto-detection logic
      solid-observer.ts           # SolidObserver class
        • getInjectionScript()    # Returns the Phase 1 + Phase 2 JS string
        • onDetect(data)          # Handles framework_detect events
        • getStateSnapshot()      # Returns current signal/owner state for session_inspect
      patterns/
        solid-patterns.ts         # Bug pattern detection functions
          • checkUntrackedRead()
          • checkDestructuredProps()
          • checkMissingMemo()
          • checkExcessiveWrites()
          • checkMissingCleanup()
```

### Class Structure

```typescript
// src/browser/recorder/framework/solid-observer.ts

interface FrameworkObserver {
  readonly framework: string;
  getInjectionScript(): string;
  onDetect(data: FrameworkDetectData): void;
  getStateSnapshot(): Promise<FrameworkStateSnapshot>;
  dispose(): void;
}

class SolidObserver implements FrameworkObserver {
  readonly framework = "solid";

  private detected = false;
  private devMode = false;
  private version: string | null = null;

  getInjectionScript(): string {
    // Returns the combined Phase 1 + Phase 2 JavaScript
    // as a self-executing function string
    return `(function() { /* ... */ })();`;
  }

  onDetect(data: SolidDetectData): void {
    this.detected = true;
    this.devMode = data.devMode;
    this.version = data.version;
  }

  async getStateSnapshot(): Promise<SolidStateSnapshot> {
    // Evaluate in browser context to read __BL_SOLID__ state
    // Called by session_inspect when ?framework query is present
    return {
      signals: [], // current signal names + values
      owners: [],  // component tree
      stores: [],  // store state
    };
  }

  dispose(): void {
    this.detected = false;
  }
}
```
