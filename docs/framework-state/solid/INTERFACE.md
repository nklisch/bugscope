# Solid Internals — Debug Interface Reference

This document describes the internal debugging surfaces in SolidJS that Krometrail hooks into for state observation. These are not stable public APIs — they exist for devtools and may change between minor versions.

---

## `DEV` Export

The primary entry point for Solid debugging instrumentation. Exported as a named export from `solid-js`:

```typescript
import { DEV } from "solid-js";
```

### The Bundler Problem

In a typical bundled application, `DEV` is imported internally by Solid's own code but is **not** exposed on `window` or any global. The injection script running via `addScriptToEvaluateOnNewDocument` cannot simply read `window.DEV` — it does not exist.

### Access Strategies

#### Strategy A: Monkey-Patch `createSignal` Before Bundle Loads

Intercept the module system before the app's bundle executes. Since the injection script runs before any `<script>` tag, we can patch the global scope to intercept Solid's primitives as they're first called.

```javascript
// Injected via addScriptToEvaluateOnNewDocument
(function() {
  const origDefineProperty = Object.defineProperty;
  // Intercept solid-js module registration in common bundlers
  // This works with webpack, vite, and esbuild module patterns

  let _createSignal = null;

  // Patch approach: override createSignal at the call site
  // The bundle will call createSignal from its module scope
  // We detect it via Function.prototype wrapping
  const origCall = Function.prototype.call;
  // ... (implementation details depend on bundler output format)
})();
```

**Tradeoff:** Fragile. Depends on bundler output format. Different behavior for Vite dev server (native ESM) vs production webpack build.

#### Strategy B: Require Bridge Script in App

Ask the developer to add a bridge script to their app entry point:

```typescript
// In the app's entry file (e.g., index.tsx)
import { DEV } from "solid-js";
if (DEV) {
  (window as any).__SOLID_DEV__ = DEV;
}
```

The injection script then reads `window.__SOLID_DEV__` after a short delay or via `MutationObserver` on the document.

**Tradeoff:** Requires app modification. Not automatic. But the most reliable approach.

#### Strategy C: Vite Plugin Injection

For Vite-based Solid apps (the most common setup), a Vite plugin can expose `DEV` automatically:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
// import krometrailPlugin from "krometrail/vite"; // hypothetical

export default defineConfig({
  plugins: [solidPlugin(), /* krometrailPlugin() */],
});
```

**Tradeoff:** Requires config change. Best DX but highest integration cost.

#### Recommended Approach

Strategy B (bridge script) for initial implementation. It is explicit, works with all bundlers, and clearly communicates the dev-mode requirement. Strategy A as a best-effort automatic fallback for Vite dev server environments where ESM imports are not bundled.

---

## DEV.hooks Callbacks

### `afterRegisterGraph(node)`

Called every time a reactive primitive (signal, memo, effect) is created and registered in the reactive graph.

```typescript
DEV.hooks.afterRegisterGraph = (node: {
  name?: string;      // debug name from createSignal options or auto-generated
  value?: unknown;     // initial value (for signals and memos)
  // The full node object also has internal fields:
  // observers, sources, fn, owner, etc.
}) => {
  // Called for every createSignal, createMemo, createEffect, createComputed
  // The node is fully initialized when this fires
};
```

**Timing:** Synchronous, called at the end of the primitive's constructor. The node is already in the reactive graph.

**Use case:** Building a registry of all reactive primitives. Wrapping signal setters for fine-grained tracking.

### `afterUpdate()`

Called after every reactive update cycle completes. A single user interaction may trigger multiple signal writes, but `afterUpdate` fires once after all synchronous reactive propagation is done.

```typescript
DEV.hooks.afterUpdate = () => {
  // All reactive computations for this batch are complete
  // Safe to read signal values — they reflect the final state
};
```

**Timing:** Synchronous, called at the end of `runUpdates()` (Solid's internal batch processor). If updates are nested (a signal write inside an effect triggers another effect), `afterUpdate` fires once after the outermost batch completes.

**Use case:** Batching state snapshots. This is the natural "tick" boundary for reporting state changes to the event pipeline.

### `afterCreateOwner(owner)`

Called when a new computation scope (Owner) is created.

```typescript
DEV.hooks.afterCreateOwner = (owner: Owner) => {
  // owner.owner is the parent
  // owner.name may be set (component name) or undefined (anonymous effect)
};
```

**Timing:** Synchronous, during component render or effect creation.

**Use case:** Building the ownership tree, detecting component mount/unmount.

### `afterCreateSignal(signal)` (Solid 1.8+)

```typescript
DEV.hooks.afterCreateSignal = (signal: SignalState<unknown>) => {
  // More specific than afterRegisterGraph — only fires for signals, not memos/effects
};
```

> **Version note.** Added in Solid 1.8. Not present in earlier versions. Check for existence before assigning.

---

## Store DevHooks

### `onStoreNodeUpdate(state, property, value, prev)`

Fine-grained store mutation tracking. Called on every individual property mutation through the store setter.

```typescript
import { DEV } from "solid-js/store";

// The store's internal dev node exposes this hook
// Access pattern (internal, subject to change):
storeNode[Symbol.for("store-dev-hooks")] = {
  onStoreNodeUpdate(
    state: StoreNode,      // the store proxy target
    property: string,      // property name or path segment
    value: unknown,        // new value
    prev: unknown          // previous value
  ) {
    // Fires for every store.setX() call
    // For nested updates like setStore("users", 0, "name", "Alice"),
    // this fires once with property="name", value="Alice"
  }
};
```

**Timing:** Synchronous, inside the store setter's `batch()` call. Multiple mutations in a single setter call fire multiple `onStoreNodeUpdate` callbacks.

**Use case:** Precise store mutation tracking. Maps directly to `framework_state` events with `changeType: "store_mutation"`.

> **Unstable.** The symbol key and callback shape are internal. The solid-devtools package accesses this differently across Solid versions.

---

## Signal Observation Strategies

Solid has no equivalent of React's `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot` that captures all state changes globally. Fine-grained observation requires one of these approaches:

### Approach 1: `afterUpdate` Only (Coarse)

Use `DEV.hooks.afterUpdate` as the tick boundary. On each tick, diff the entire signal registry (`DEV.registry`) against the previous snapshot.

```typescript
let prevSnapshot = new Map<number, unknown>();

DEV.hooks.afterUpdate = () => {
  const changes: Change[] = [];
  for (const [id, node] of DEV.registry) {
    if (node.value !== prevSnapshot.get(id)) {
      changes.push({
        key: node.name ?? `signal-${id}`,
        prev: prevSnapshot.get(id),
        next: node.value,
      });
      prevSnapshot.set(id, node.value);
    }
  }
  if (changes.length > 0) {
    reportStateChange(changes);
  }
};
```

**Pros:** Simple. No monkey-patching beyond DEV.hooks.
**Cons:** O(n) per update cycle where n = total signals. No per-component attribution without additional tree walking. Misses intermediate values within a batch.

### Approach 2: Wrap Signal Setters (Fine-Grained)

Intercept `afterRegisterGraph` to wrap each signal's setter at creation time.

```typescript
DEV.hooks.afterRegisterGraph = (node) => {
  if (!node.observers) return; // not a signal

  const originalWrite = node.write;  // internal setter reference
  // Alternatively, wrap DEV.writeSignal globally
};
```

In practice, wrapping individual signal setters is difficult because the setter returned by `createSignal` is a closure, not a method on the signal node. The more practical variant:

### Approach 3: Monkey-Patch `DEV.writeSignal` (Comprehensive)

```typescript
const origWriteSignal = DEV.writeSignal;
DEV.writeSignal = function(node: SignalState<unknown>, value: unknown) {
  const prev = node.value;
  const result = origWriteSignal.call(this, node, value);

  // Report the signal write
  queueSignalChange({
    name: node.name,
    prev,
    next: node.value,  // may differ from `value` if signal has a comparator
    owner: findOwnerForSignal(node),
  });

  return result;
};
```

**Pros:** Captures every signal write with prev/next values. No per-signal wrapping needed.
**Cons:** `DEV.writeSignal` is internal. May be renamed or restructured. Adds overhead to every signal write.

**Recommended:** Approach 3 (patch `DEV.writeSignal`) combined with Approach 1 (`afterUpdate` as batch boundary). Signal writes are queued during the batch and flushed as a single `framework_state` event on `afterUpdate`.

---

## Ownership Tree Traversal

### `getOwner()`

Returns the currently active owner (the computation scope that is currently executing).

```typescript
import { getOwner } from "solid-js";

// Inside a component or effect:
const owner = getOwner();
// owner.owner → parent owner
// owner.owned → child owners (effects, memos, nested components)
```

### Tree Walking

To reconstruct the component tree from the ownership tree:

```typescript
function walkOwnerTree(owner: Owner, depth = 0): ComponentNode[] {
  const components: ComponentNode[] = [];

  if (owner.name && isComponentOwner(owner)) {
    components.push({
      name: owner.name,
      depth,
      signals: countSignals(owner),
      children: [],
    });
  }

  if (owner.owned) {
    for (const child of owner.owned) {
      const childComponents = walkOwnerTree(child, depth + 1);
      components.push(...childComponents);
    }
  }

  return components;
}

function isComponentOwner(owner: Owner): boolean {
  // Component owners have a name that starts with uppercase (by convention)
  // and have a componentType or similar marker in dev mode
  return !!owner.name && /^[A-Z]/.test(owner.name);
}

function countSignals(owner: Owner): number {
  // Signals owned by this computation scope
  // Accessed via owner.sourceMap or by tracking afterRegisterGraph calls per owner
  return 0; // implementation depends on registry structure
}
```

### Component Path Construction

Building a component path (e.g., `"App > Layout > Counter"`) requires walking up the owner tree from a given owner to the root, collecting component names:

```typescript
function getComponentPath(owner: Owner): string {
  const parts: string[] = [];
  let current: Owner | null = owner;
  while (current) {
    if (current.name && isComponentOwner(current)) {
      parts.unshift(current.name);
    }
    current = current.owner;
  }
  return parts.join(" > ");
}
```

---

## Component Attribution

### Without solid-devtools Babel Plugin

Component names come from function names in the source code. After minification, these are typically single characters (`a`, `b`, `_c`). The `name` field on owners will reflect the minified name.

Source locations (`sourceMap` on Owner) are **not available** without the Babel plugin.

### With solid-devtools Babel Plugin

The `@solid-devtools/transform` Babel plugin (used via `vite-plugin-solid` with `dev: true`):

1. Preserves component function names through minification
2. Injects `sourceMap` metadata on owner nodes (file, line, column)
3. Adds debug names to signals created inside components
4. Wraps component functions to set `owner.name` explicitly

```typescript
// babel-plugin-solid-devtools transforms:
function Counter() { ... }
// into:
const Counter = /* @__PURE__ */ (() => {
  const _Counter = () => { ... };
  _Counter.displayName = "Counter";
  return _Counter;
})();
```

**Recommendation:** Document that component attribution quality depends heavily on whether the solid-devtools Babel plugin is active. Without it, names are best-effort.

---

## Performance Considerations

Solid's fine-grained reactivity means a single user interaction can trigger dozens or hundreds of signal writes. Unlike React (which batches into a single commit), each signal write in Solid immediately propagates through the reactive graph.

### Batching Strategy

```
User clicks button
  → setCount(count + 1)           // signal write #1
    → effect re-runs               // propagation
      → setDerived(count * 2)      // signal write #2
        → memo re-evaluates        // propagation
  → afterUpdate() fires            // batch boundary
    → flush all queued changes as one framework_state event
```

Reporting every individual signal write as a separate `__BL__` event would overwhelm the pipeline. The `afterUpdate` hook is the natural batch boundary — collect signal writes during the cycle, emit one consolidated event when the cycle completes.

### Throttling

If a component triggers signal writes at >60Hz (e.g., mouse tracking, animation), apply the same throttling rules as DOM event reporting. Cap at one `framework_state` event per component per 100ms, with a summary of dropped updates.

---

## solid-devtools Ecosystem

### `solid-devtools` (npm package)

The official devtools browser extension. Provides a Chrome DevTools panel for inspecting the component tree, signal values, and ownership graph. Uses its own injection mechanism that is separate from and incompatible with our CDP approach.

**Relevant source:** [`solid-devtools/debugger`](https://github.com/nicknisi/solid-devtools) — the `@solid-devtools/debugger` package contains the injection logic we can reference but should not depend on.

### `@solid-devtools/debugger`

The core debugging library. Installs its own hooks on `DEV.hooks` and maintains a shadow copy of the component tree. If this package is installed alongside our observer, the hooks will conflict (Solid's `DEV.hooks` are simple property assignments, not event emitters — last write wins).

**Mitigation:** Check if `DEV.hooks.afterRegisterGraph` is already assigned before overwriting. If it is, chain the existing callback:

```typescript
const existingHook = DEV.hooks.afterRegisterGraph;
DEV.hooks.afterRegisterGraph = (node) => {
  existingHook?.(node);
  ourHandler(node);
};
```

### `@solid-devtools/logger`

A standalone logging utility that dumps reactive graph state to the console. Useful as a reference for what data is available, but not something we integrate with. Our approach captures the same information at a lower level via `DEV.hooks` and `DEV.writeSignal`.

### How Our Approach Differs

| Aspect | solid-devtools | Krometrail |
|--------|---------------|------------|
| Injection | Extension content script | CDP `addScriptToEvaluateOnNewDocument` |
| Communication | Chrome extension messaging | `console.debug("__BL__", ...)` via CDP |
| Tree model | Full shadow tree in extension | Lightweight signal map + owner tree traversal |
| Interactivity | User browses tree in panel | Agent queries state via `session_inspect` |
| Bug detection | None | Pattern matching on signal/owner metadata |
