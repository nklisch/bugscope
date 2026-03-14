# Svelte Observer — Specification

This document defines the formal contracts, detection criteria, event schemas, and bug pattern definitions for Svelte framework state observation in Krometrail. Svelte is a Tier 3 target.

**Status summary:** Svelte 4 dev-mode observation is implementable today. Svelte 5 devtools hooks do not exist yet (sveltejs/svelte#11389). Production builds strip the APIs we depend on.

---

## Detection Criteria

Svelte has no global hook equivalent to `__REACT_DEVTOOLS_GLOBAL_HOOK__` or `__VUE_DEVTOOLS_GLOBAL_HOOK__`. Detection relies on multiple heuristics, checked in order:

1. **DOM element markers.** Walk `document.querySelectorAll('*')` and check for `__svelte` or `$$` properties on elements. Svelte 4 components attach `$$` (the internal state object) to the component instance, and devtools extensions look for `__svelte` markers on DOM nodes.

2. **Compiled output patterns.** Svelte compiles components to imperative DOM manipulation code. Look for characteristic function signatures in loaded scripts: `create_fragment`, `instance`, `SvelteComponent`, `$$invalidate`. These are present in both dev and production builds.

3. **Prototype chain.** Check if any constructor in the page's scope has `SvelteComponent` or `SvelteComponentDev` in its prototype chain. `SvelteComponentDev` is the dev-mode subclass and indicates that dev APIs are available.

4. **Svelte 5 signals.** Check for `$.source`, `$.get`, `$.set` in `svelte/internal` module exports, or for `__svelte_meta` on DOM elements (Svelte 5's element metadata in dev mode).

Detection must run after DOM content is loaded but should also be re-checked after dynamic imports, since Svelte components may be lazy-loaded.

---

## Version Detection

Distinguishing Svelte 4 from Svelte 5 at runtime:

| Signal | Svelte 4 | Svelte 5 |
|--------|----------|----------|
| `SvelteComponent` in prototype chain | Yes | No (components are functions, not classes) |
| `SvelteComponentDev` exists | Yes (dev mode) | No |
| `$$.ctx` array on component instance | Yes | No |
| `$$invalidate` in compiled output | Yes | No |
| `$.source` / `$.get` / `$.set` in internals | No | Yes |
| `$state` / `$derived` / `$effect` in source | No | Yes (but compiled away) |
| `__svelte_meta` on DOM elements | No | Yes (dev mode) |
| Component is a class | Yes | No (components are functions) |

**Strategy:** Check for `SvelteComponentDev` first (Svelte 4 dev mode — best case). Then check for `SvelteComponent` class-based components (Svelte 4 production). Then check for Svelte 5 signals runtime. Report version in `framework_detect` event.

---

## Svelte 4 API Contract

These APIs are available in **dev-mode builds only** (compiled with `dev: true` or `svelte-loader`/`vite-plugin-svelte` in development mode).

### `$capture_state()`

Returns a plain object snapshot of all instance variables (props, let bindings, reactive declarations).

```javascript
// Returns: { count: 0, doubled: 0, name: "world" }
const state = componentInstance.$capture_state();
```

- Bound to `$$self` in the component constructor during dev compilation.
- Returns current values, not reactive references.
- **Not available in production builds** — the compiler strips it.

### `$inject_state(newState)`

Overwrites component state with the provided partial object. Triggers re-render.

```javascript
componentInstance.$inject_state({ count: 5 });
```

- Also dev-mode only.
- Calls `$$invalidate` internally for each changed key.
- Useful for debugging but Krometrail treats this as read-only observation (passive observation principle).

### `$$.ctx` Array

The component's state array. Each slot corresponds to a variable declared in the component's `<script>` block. Index mapping is determined at compile time.

```javascript
// $$.ctx = [count, name, doubled, items, ...]
// Indices are stable per component class but not across recompilations.
```

- Available in both dev and production builds.
- In production, variable names are mangled — indices are meaningless without source maps.
- In dev mode, `$capture_state()` provides named access (preferred).

### `$$.dirty` Bitmask

Tracks which `ctx` slots have been invalidated since the last DOM update.

```javascript
// $$.dirty is an Int32Array (or array of 32-bit integers for >32 variables)
// Bit N set = ctx[N] has been invalidated
// $$.dirty[0] === -1 means "all dirty" (initial render)
```

- Each 32-bit integer tracks 32 variables.
- Components with >32 variables use `$$.dirty[1]`, `$$.dirty[2]`, etc.
- After each microtask flush, dirty bits are cleared.

### `$$invalidate(index, value)`

The core reactivity mechanism. Every assignment in a Svelte 4 component compiles to a `$$invalidate` call.

```javascript
// Source:     count += 1;
// Compiled:   $$invalidate(0, count += 1);
```

- This is the hook point for state change observation.
- The `index` parameter maps to `$$.ctx` position.
- Wrapping `$$invalidate` per component is the primary observation strategy.

### Fragment Lifecycle Methods

Each component's compiled fragment has four methods:

| Method | Purpose |
|--------|---------|
| `c()` | **Create** — allocate DOM elements |
| `m(target, anchor)` | **Mount** — insert into DOM |
| `p(ctx, dirty)` | **Patch** — update DOM based on dirty bits |
| `d(detaching)` | **Destroy** — remove from DOM, run cleanup |

These are internal compiler output, not a public API. Useful for tracking mount/unmount lifecycle.

---

## Svelte 5 Status

**No devtools hooks have shipped.** sveltejs/svelte#11389 tracks the request for a devtools API. Until this is resolved, programmatic observation of Svelte 5 internals is not reliably possible.

### What Exists

**`$inspect()` rune.** Re-runs its callback whenever tracked state changes. Supports `.with(callback)` for custom handling. However:
- Must be written in source code at compile time — cannot be injected via CDP.
- Dev-mode only — compiled out in production.
- Tracks the specific signals referenced in its argument, not all component state.

**`{@debug}` tag.** Logs values and triggers a `debugger` breakpoint. Template-only syntax, cannot be injected.

**Internal signal functions.** `$state` compiles to `$.source()`, `$derived` compiles to a computed signal, `$effect` compiles to an effect subscription. These live in `svelte/internal` and are explicitly not part of the public API. They are subject to change without notice.

### What Does Not Exist

- No global hook for component registration.
- No equivalent to `$capture_state()` or `$inject_state()`.
- No programmatic way to enumerate active components.
- No way to inject `$inspect()` into already-compiled code.

---

## Event Data Schemas

### `framework_detect` (Svelte-specific fields)

```typescript
{
  framework: "svelte",
  version: string,           // "4.2.8" or "5.1.0" — best-effort from runtime
  rootCount: number,         // Number of root-level component mounts detected
  componentCount: number,    // Total tracked component instances
  devMode: boolean,          // Whether dev-mode APIs ($capture_state, etc.) are available
  runes: boolean,            // true if Svelte 5 runes runtime detected
}
```

### `framework_state` (Svelte-specific fields)

```typescript
{
  framework: "svelte",
  componentName: string,       // From compiler metadata (dev) or "Unknown" (prod)
  componentPath?: string,      // "App > Layout > Counter" — if tree tracking available
  changeType: "mount" | "update" | "unmount",
  changes?: Array<{
    key: string,               // Variable name (dev) or "ctx[N]" (prod)
    prev: unknown,
    next: unknown,
  }>,
  renderCount?: number,
  triggerSource?: "invalidate" | "store" | "prop" | "unknown",
  dirtyBitmask?: string,       // Hex representation of $$.dirty for debugging
  svelteVersion: 4 | 5,
}
```

### `framework_error` (Svelte-specific patterns)

```typescript
{
  framework: "svelte",
  pattern: string,             // See "Bug Pattern Definitions" below
  componentName: string,
  severity: "low" | "medium" | "high",
  detail: string,
  evidence: Record<string, unknown>,
  svelteVersion: 4 | 5,
}
```

---

## Bug Pattern Definitions

### Svelte 4 Patterns

| Pattern ID | Severity | Description |
|------------|----------|-------------|
| `mutation_without_assignment` | high | Array or object mutated (e.g., `array.push()`) without reassignment. `$$invalidate` is never called, so the DOM does not update. This is the most common Svelte 4 bug. Evidence: `$$.ctx[N]` value changed (detected via deep comparison) but no `$$invalidate(N, ...)` was observed. |
| `store_subscription_leak` | medium | Component subscribes to a store (via `$storeName` syntax or manual `.subscribe()`) but the subscription is not cleaned up on destroy. Evidence: `on_destroy` callbacks do not include an unsubscribe for a detected subscription. Auto-subscriptions (`$store`) handle this automatically; manual `.subscribe()` calls are the risk. |
| `lifecycle_timing` | low | State mutation inside `beforeUpdate` that triggers another `beforeUpdate`. Can cause infinite update loops. Evidence: same component's `beforeUpdate` fires >5 times in a single tick. |
| `missing_key_block` | medium | `{#each}` block without a keyed identifier when list items have identity. Evidence: DOM nodes destroyed and recreated on list reorder (detected via MutationObserver) when items could have been moved. |

### Svelte 5 Patterns

These are detected with **reduced confidence** since observation is limited to DOM-level heuristics until devtools hooks ship.

| Pattern ID | Severity | Description |
|------------|----------|-------------|
| `derived_object_not_proxied` | medium | `$derived` returning a new object/array on every evaluation, causing downstream effects to re-run unnecessarily. Svelte 5 does not deeply proxy `$derived` return values. Evidence: rapid repeated DOM updates to the same elements with structurally identical content. |
| `class_instance_not_proxied` | medium | Class instance assigned to `$state` — Svelte 5 proxies do not intercept class property mutations. Evidence: state update expected (class method called) but no DOM update observed. |
| `side_effect_in_derived` | high | `$derived` performing side effects (network requests, DOM manipulation). `$derived` should be pure. Evidence: network requests or DOM mutations correlated with `$derived` recalculation timing. Detection is heuristic. |
| `rune_boundary_js` | low | Runes (`$state`, `$derived`, `$effect`) used in `.js` files instead of `.svelte.js` files. Runes are only processed by the Svelte compiler in `.svelte` and `.svelte.js` files. Evidence: runtime error or unexpected behavior when rune-like syntax appears in non-Svelte-processed files. This is primarily a static analysis concern; runtime detection is limited. |

---

## Production Limitations

In production builds (compiled with `dev: false`):

- `$capture_state()` and `$inject_state()` are stripped by the compiler.
- `$$.ctx` exists but variable names are mangled. Without source maps, ctx indices are opaque.
- `$inspect()` is compiled out entirely.
- `SvelteComponentDev` does not exist — only `SvelteComponent`.
- `{@debug}` tags are compiled out.
- Component names may be minified.
- Svelte 5's `__svelte_meta` on DOM elements is not present.

**Fallback in production:** Report `framework_detect` with `devMode: false`. State observation is limited to DOM-level changes via MutationObserver. Bug pattern detection is limited to DOM-observable symptoms (e.g., elements being destroyed/recreated when they could be moved). The agent should be informed that framework-level state granularity is unavailable.
