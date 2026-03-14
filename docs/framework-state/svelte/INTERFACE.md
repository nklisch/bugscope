# Svelte Internals — Debug Interface Reference

This document catalogs the internal APIs, runtime structures, and debug surfaces available in Svelte 4 and Svelte 5 that the Svelte observer can hook into. Stability status is marked for each.

---

## Svelte 4 Component Internals

Every Svelte 4 component instance has a `$$` object containing all internal state. This is the primary observation surface.

### The `$$` Object

```typescript
interface ComponentInternals {
  ctx: any[];                    // State array — one slot per variable
  dirty: Int32Array;             // Bitmask — which ctx slots need DOM update
  fragment: Fragment | null;     // Compiled DOM operations (c/m/p/d methods)
  callbacks: {
    on_mount: Function[];
    on_destroy: Function[];
    before_update: Function[];
    after_update: Function[];
  };
  bound: Record<string, Function>;  // Two-way binding updaters
  on_mount: Function[];           // Shortcut to callbacks.on_mount
  on_destroy: Function[];         // Shortcut to callbacks.on_destroy
  after_update: Function[];       // Shortcut to callbacks.after_update
  context: Map<any, any>;         // Component context (from setContext/getContext)
  props: Record<string, number>;  // Maps prop names → ctx indices (dev mode)
  skip_bound: boolean;            // Suppresses bound callbacks during init
  root: Element;                  // Target DOM element
}
```

**Stability:** The `$$` object structure has been stable across Svelte 4.x releases. It is not a public API but is relied upon by svelte-devtools and other tooling. It does not exist in Svelte 5.

### `$$invalidate(index, value)`

The core reactivity hook. Every reactive assignment in a Svelte 4 component compiles to a call to `$$invalidate`.

```javascript
// Compiler output for: count = count + 1
$$invalidate(0, count = count + 1);

// Compiler output for: items = [...items, newItem]
$$invalidate(3, items = [...items, newItem]);

// Compiler output for: $store = newValue (store binding)
set_store_value(store, $store = newValue);
// which internally calls component.$$.ctx update + store.set()
```

The `$$invalidate` function:
1. Updates `$$.ctx[index]` with the new value.
2. Sets the corresponding bit in `$$.dirty`.
3. Schedules a microtask to flush DOM updates if not already scheduled.

**Hook strategy:** Replace `$$invalidate` on each component instance to intercept all state changes. The replacement must call the original to preserve reactivity.

---

## `$capture_state()` and `$inject_state()`

Dev-mode-only APIs added by the compiler when `dev: true`.

### `$capture_state()`

```javascript
// Added to component prototype in dev mode
SvelteComponentDev.prototype.$capture_state = function() {
  // Returns plain object with all instance variables
  // { count: 0, doubled: 0, name: "world", items: [1, 2, 3] }
};
```

- Returns a shallow snapshot. Object/array values are references, not clones.
- Includes props, local state, and reactive declarations (`$:` labels).
- Does NOT include stores — store values are accessed via `$storeName` auto-subscription.
- Variable names match source code names (not mangled).
- Called internally by svelte-devtools to populate the component inspector.

### `$inject_state(partial)`

```javascript
// Overwrites matching state variables
componentInstance.$inject_state({ count: 42 });
// Internally calls $$invalidate for each key in the partial object
```

- Triggers re-render for all injected values.
- Krometrail does NOT use this (passive observation only) but documents it for completeness.

**Stability:** These exist in all Svelte 4.x dev builds. They are deliberately omitted in production builds.

---

## Component Enumeration

Svelte provides **no built-in API** for enumerating active component instances. This is a significant difference from React (fiber tree walking) and Vue (devtools hook component tracking).

### Approaches for CDP Injection

**1. Monkey-patch `SvelteComponent` or `SvelteComponentDev` prototype.**

```javascript
const originalInit = SvelteComponentDev.prototype.$$.init;
// Problem: init is not on the prototype — it's a standalone function
// called inside the constructor. Must patch the constructor or the
// internal init() function.
```

**2. Intercept the internal `init()` function.**

Svelte 4's compiled output calls a shared `init()` function from `svelte/internal`:

```javascript
import { init, SvelteComponentDev } from 'svelte/internal';
```

If we can intercept the module's `init` export before any component loads, we can track every component creation. This requires `Page.addScriptToEvaluateOnNewDocument` timing.

```javascript
// Injection strategy (simplified):
const originalInit = window.__svelte_internal_init; // captured before app loads
window.__svelte_internal_init = function(component, options, instance, ...) {
  originalInit.call(this, component, options, instance, ...);
  __BL__.trackComponent(component);
};
```

The challenge: Svelte's `init` is typically imported via ES modules, not exposed on `window`. The injection must either:
- Intercept the module via a service worker or `importScripts` shim.
- Patch `SvelteComponentDev.prototype` after the module loads but before components mount.
- Use `MutationObserver` on the DOM to detect new elements with `$$` or `__svelte` markers.

**3. DOM walking with MutationObserver fallback.**

Walk the DOM periodically or on mutation and check each element for Svelte component markers. Less precise but does not require module interception.

**Recommended approach:** Combination of (2) and (3). Attempt `SvelteComponentDev` prototype patching first (works in dev mode). Fall back to DOM walking if prototype is not available (production or Svelte 5).

---

## Svelte 5 Runes Runtime

Svelte 5 replaces the class-based component system with a signals-based runtime. Components are functions, not classes.

### Internal Signal Functions

These are exported from `svelte/internal` and are **not public API**. They are subject to change without notice.

| Source Syntax | Compiled Form | Internal Function |
|--------------|---------------|-------------------|
| `$state(value)` | `$.source(value)` | Creates a reactive source signal |
| `$state.raw(value)` | `$.source(value)` | Same as `$.source`, no deep proxy |
| `$derived(expr)` | `$.derived(() => expr)` | Creates a computed signal |
| `$derived.by(fn)` | `$.derived(fn)` | Same as `$.derived` with explicit function |
| `$effect(fn)` | `$.effect(fn)` | Creates a side-effect subscription |
| `$effect.pre(fn)` | `$.pre_effect(fn)` | Runs before DOM update |
| Read `$state` | `$.get(signal)` | Reads current value, registers dependency |
| Write `$state` | `$.set(signal, value)` | Updates value, notifies dependents |

### Signal Observation Challenges

- Signals are local variables in the compiled output, not properties on an observable object.
- There is no registry of active signals or effects.
- `$.source`, `$.get`, `$.set` could theoretically be monkey-patched, but:
  - They are imported via ES modules — same interception problem as Svelte 4's `init`.
  - The volume of `$.get` calls would be extremely high (every template read).
  - No way to associate a signal with a component name without source maps.

### Svelte 5 Component Structure

```javascript
// Svelte 5 compiled component (simplified)
function Counter($$anchor) {
  let count = $.source(0);
  // ... template setup using $.get(count), $.set(count, ...) ...
}
```

- No `$$` object.
- No `$capture_state` / `$inject_state`.
- No class prototype to patch.
- Component identity is the function reference, which may be anonymous after minification.

---

## `$inspect` Rune

Available in Svelte 5 dev mode only.

```svelte
<script>
  let count = $state(0);
  // Logs to console whenever count changes
  $inspect(count);
  // Custom callback
  $inspect(count).with((type, value) => {
    // type: "init" | "update"
    console.log(type, value);
  });
</script>
```

**Limitations for CDP injection:**
- Must be present in the source code at compile time.
- Cannot be added to an already-compiled component.
- Cannot be evaluated via `Runtime.evaluate` — runes require the Svelte compiler.
- Tracks only the specific reactive values passed as arguments.

---

## `{@debug}` Tag

```svelte
{@debug count, name}
<!-- Equivalent to: console.log({ count, name }); debugger; -->
```

- Template-only syntax — cannot appear in `<script>` block or be injected.
- In dev mode: logs values and triggers a `debugger` statement.
- In production: compiled out entirely.
- Useful if present in source, but not injectable.

---

## DOM Markers

### Svelte 4

- Components may set `__svelte` on their root DOM element (varies by version and devtools presence).
- The `$$` internal object is accessible on the component instance but not directly on DOM elements without devtools instrumentation.
- svelte-devtools injects markers by patching compiled output via RegExp — this is fragile and version-specific.

### Svelte 5

- Dev mode sets `__svelte_meta` on DOM elements:
  ```javascript
  element.__svelte_meta = {
    loc: { file: "src/Counter.svelte", line: 5, column: 2 }
  };
  ```
- This provides source location but not component state or identity.
- Not present in production builds.

---

## svelte-devtools Extension Architecture

Understanding how the existing devtools extension works informs our approach.

The Svelte devtools browser extension (for Svelte 4):

1. Intercepts `<script>` network requests via a content script or background service worker.
2. Applies RegExp transformations to the compiled Svelte output before the browser executes it.
3. These transformations inject tracking code into `init()` calls and component constructors.
4. Tracked components report to the devtools panel via `window.postMessage`.

**Why we cannot reuse this approach:**
- Requires a browser extension (not available via CDP).
- RegExp instrumentation is fragile and breaks across Svelte minor versions.
- The extension has been largely unmaintained for Svelte 5.

**What we can learn:**
- The general approach of intercepting `init()` is sound for Svelte 4.
- Component tree reconstruction requires tracking parent-child relationships during mount.
- The devtools used `$capture_state()` heavily — confirming it is the right API for state extraction.

---

## Performance Considerations

Svelte compiles to direct DOM manipulation — there is no virtual DOM diffing overhead. This has implications for observation:

- **State changes are fast.** A `$$invalidate` call schedules a microtask flush that directly patches the DOM. Observation hooks in `$$invalidate` must be lightweight to avoid perceptible overhead.
- **No reconciliation phase.** Unlike React or Vue, there is no diffing step where we can observe "what changed." Changes go directly from state to DOM.
- **MutationObserver captures all DOM effects** but cannot determine which state change caused which DOM mutation. Causality is lost at the DOM level.
- **Batching.** Multiple `$$invalidate` calls within the same microtask are batched — the `p()` (patch) method runs once with accumulated dirty bits. The observer should batch its reporting similarly.
- **Svelte 5 signals** add a dependency graph that could theoretically provide causality, but without hooks to observe it, we're limited to the same DOM-level observation.

**Guideline:** Keep per-`$$invalidate` hook work under 0.1ms. Buffer changes and report once per microtask flush, not per individual invalidation.
