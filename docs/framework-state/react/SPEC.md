# React Observer -- Specification

This document defines the formal contracts, schemas, and detection criteria for the React framework state observer. It specifies what we hook into, what data shapes we produce, and what bug patterns we detect.

---

## Detection Criteria

React is detected when all of the following are true:

1. A renderer calls `__REACT_DEVTOOLS_GLOBAL_HOOK__.inject(renderer)` on our installed shim.
2. The renderer object has a `rendererPackageName` of `"react-dom"` (or `"react-native-renderer"`, `"react-art"`, etc.).
3. The renderer's `version` field is a semver string >= `16.8.0` (hooks support required).

Detection fires once per page load. If multiple renderers inject (e.g., micro-frontends), each gets tracked separately with its own renderer ID, but we emit a single `framework_detect` event for the first renderer and update `rootCount` on subsequent ones.

### Version Extraction

```typescript
// renderer.version is a string like "18.2.0" or "19.0.0-rc.1"
// We parse major.minor for compatibility branching:
const [major, minor] = renderer.version.split(".").map(Number);
```

If `renderer.version` is absent (rare, pre-16.8 builds), we fall back to checking `renderer.currentDispatcherRef` existence (React 16.8+) and assume `16.8.0`.

---

## Hook Contract

The injection script installs a shim on `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` before any script on the page runs. This is the exact shape React's reconciler looks for at module evaluation time.

```typescript
interface ReactDevtoolsGlobalHook {
	/** Checked by React to decide whether to call inject(). Always true. */
	supportsFiber: boolean;

	/**
	 * Called by each React renderer at module init time.
	 * We store the renderer and return a numeric renderer ID.
	 */
	inject(renderer: ReactRenderer): number;

	/**
	 * Called by the reconciler after every commit (sync render flush).
	 * `fiberRoot` is the FiberRoot node (container.current = HostRoot fiber).
	 */
	onCommitFiberRoot(rendererId: number, fiberRoot: FiberRoot, priorityLevel?: number): void;

	/**
	 * Called when a fiber is about to be unmounted.
	 * Used for cleanup tracking (effect cleanup detection).
	 */
	onCommitFiberUnmount(rendererId: number, fiber: Fiber): void;

	/**
	 * Called after passive effects have been flushed (React 18+).
	 * Used for effect timing analysis.
	 */
	onPostCommitFiberRoot?(rendererId: number, fiberRoot: FiberRoot): void;

	/** Map of rendererId -> ReactRenderer. Populated by inject(). */
	renderers: Map<number, ReactRenderer>;

	/**
	 * Returns the Set of FiberRoot objects for a given renderer.
	 * Used to enumerate all React roots on the page.
	 */
	getFiberRoots(rendererId: number): Set<FiberRoot>;

	// ---- Fields set during injection, used by React internally ----

	/** Checked at require-time. If present and truthy, React calls inject(). */
	isDisabled?: boolean;

	/** Injection timestamp. Set by our shim to track timing. */
	_injectedAt?: number;

	// ---- Our extensions (not part of React's contract) ----

	/** Krometrail observer callback registration. */
	_blObserver?: ReactObserverCallbacks;
}

interface ReactRenderer {
	/** Renderer package name, e.g. "react-dom" */
	rendererPackageName?: string;
	/** React version string, e.g. "18.2.0" */
	version?: string;
	/** Reference to the current dispatcher (hooks). Present since 16.8. */
	currentDispatcherRef?: { current: unknown };
	/** Bundle type: 0 = production, 1 = development */
	bundleType?: number;
	/** Reconciler version (may differ from react version in monorepos) */
	reconcilerVersion?: string;
	/** Used by DevTools to find fibers. */
	findFiberByHostInstance?(instance: unknown): Fiber | null;
}

interface ReactObserverCallbacks {
	onCommit(fiberRoot: FiberRoot, rendererId: number): void;
	onUnmount(fiber: Fiber, rendererId: number): void;
	onError(error: Error, componentStack?: string): void;
}
```

---

## Event Data Schemas

These are the React-specific shapes for the three framework event types defined in the parent [APPROACH.md](../APPROACH.md).

### `framework_detect`

Emitted once when the first renderer calls `inject()`, and updated (re-emitted) if additional renderers register.

```typescript
interface ReactFrameworkDetectData {
	framework: "react";
	/** React version from the first renderer, e.g. "18.2.0" */
	version: string;
	/** Number of FiberRoot objects across all renderers */
	rootCount: number;
	/** Total component count at detection time (initial render) */
	componentCount: number;
	/** Production (0) or development (1) bundle */
	bundleType: 0 | 1;
	/** Detected state management library, if any */
	storeDetected?: "redux" | "zustand" | "jotai" | "recoil" | "mobx" | null;
	/** Renderer IDs registered */
	rendererIds: number[];
}
```

### `framework_state`

Emitted after each commit, throttled to the configured rate limit.

```typescript
interface ReactFrameworkStateData {
	framework: "react";
	componentName: string;
	/** Ancestor chain, e.g. "App > Layout > UserProfile" */
	componentPath?: string;
	changeType: "mount" | "update" | "unmount";
	/** State/prop changes. Only present for "update". */
	changes?: Array<{
		key: string;
		prev: unknown;
		next: unknown;
	}>;
	/** Cumulative render count for this component instance */
	renderCount?: number;
	/** What triggered the update */
	triggerSource?: "state" | "props" | "context" | "parent" | "forceUpdate";
	/** Hook indices that changed (for function components) */
	changedHookIndices?: number[];
}
```

### `framework_error`

Emitted when a bug pattern is detected. See [Bug Pattern Definitions](#bug-pattern-definitions) below.

```typescript
interface ReactFrameworkErrorData {
	framework: "react";
	pattern: "stale_closure" | "infinite_rerender" | "missing_cleanup" | "excessive_context_rerender";
	componentName: string;
	severity: "low" | "medium" | "high";
	/** Human-readable explanation for the agent */
	detail: string;
	/** Machine-readable evidence supporting the detection */
	evidence: Record<string, unknown>;
}
```

---

## Fiber Node Contract

A Fiber is React's internal work unit representing a component instance or DOM element. We read fibers but never write to them.

### Key Properties

```typescript
interface Fiber {
	/** Numeric tag identifying the fiber type. See WorkTag values below. */
	tag: WorkTag;

	/**
	 * Component constructor/function, or host element string.
	 * - FunctionComponent/ClassComponent: the function/class itself
	 * - HostComponent: tag name string, e.g. "div"
	 * - ForwardRef: { $$typeof, render }
	 * - MemoComponent: { $$typeof, type, compare }
	 */
	type: any;

	/**
	 * For ClassComponent: the class instance (this).
	 * For HostComponent: the DOM node.
	 * For HostRoot: the FiberRoot container.
	 */
	stateNode: any;

	/** Parent fiber. null for HostRoot. */
	return: Fiber | null;
	/** First child fiber. */
	child: Fiber | null;
	/** Next sibling fiber. */
	sibling: Fiber | null;
	/** Index among siblings (used in reconciliation). */
	index: number;

	/** Ref attached via ref prop or useRef callback. */
	ref: ((instance: any) => void) | { current: any } | null;

	/** Props from the previous render (committed). */
	memoizedProps: any;
	/** Props from the current render (may differ during work-in-progress). */
	pendingProps: any;

	/**
	 * State from the previous committed render.
	 * - ClassComponent: this.state object
	 * - FunctionComponent: head of the hooks linked list
	 * - HostRoot: { element, ... }
	 */
	memoizedState: any;

	/**
	 * Context dependencies. Shape varies by React version:
	 * - React 16: contextDependencies (renamed in 17+)
	 * - React 17+: dependencies
	 */
	dependencies?: FiberDependencies | null;

	/**
	 * Side-effect flags.
	 * - React 16: `effectTag` (number)
	 * - React 17+: `flags` (number)
	 */
	flags: number;
	/** React 16 only; renamed to `flags` in 17. */
	effectTag?: number;

	/**
	 * The work-in-progress counterpart (double-buffering).
	 * During commit, `current.alternate` is the WIP tree that just rendered.
	 * After commit, they swap. Comparing current vs alternate reveals what changed.
	 */
	alternate: Fiber | null;

	/** React key prop. */
	key: string | null;

	/** Debug source info (dev mode only). */
	_debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
	/** Owner fiber (dev mode only). */
	_debugOwner?: Fiber;
}

interface FiberRoot {
	/** The HostRoot fiber. */
	current: Fiber;
	/** The DOM container element. */
	containerInfo: Element;
	/** Pending work priority lanes (React 18+). */
	pendingLanes?: number;
}

interface FiberDependencies {
	/** Linked list of context dependencies */
	firstContext: ContextDependency | null;
	/** Lanes that triggered this dependency check (React 18+) */
	lanes?: number;
}

interface ContextDependency {
	context: ReactContext;
	next: ContextDependency | null;
	/** Observed bits mask (React 16 only, removed in 17+) */
	observedBits?: number;
}

interface ReactContext {
	_currentValue: any;
	_currentValue2?: any;  // concurrent mode secondary value
	Provider: any;
	Consumer: any;
}
```

---

## WorkTag Values

The `fiber.tag` field is a numeric enum identifying the fiber's role. These values are internal to React and have been stable since React 16, with additions in later versions.

| Value | Name | Description |
|-------|------|-------------|
| 0 | `FunctionComponent` | Function component (including hooks-based) |
| 1 | `ClassComponent` | Class component extending React.Component/PureComponent |
| 2 | `IndeterminateComponent` | Not yet resolved (function vs class). Resolved on first render. |
| 3 | `HostRoot` | Root of a React tree (container). `stateNode` is the FiberRoot. |
| 4 | `HostPortal` | ReactDOM.createPortal target |
| 5 | `HostComponent` | DOM element (div, span, etc.). `type` is the tag name string. |
| 6 | `HostText` | Text node. |
| 7 | `Fragment` | React.Fragment |
| 8 | `Mode` | StrictMode, ConcurrentMode, ProfilerMode wrappers |
| 9 | `ContextConsumer` | Context.Consumer |
| 10 | `ContextProvider` | Context.Provider |
| 11 | `ForwardRef` | React.forwardRef wrapper |
| 12 | `Profiler` | React.Profiler |
| 13 | `SuspenseComponent` | React.Suspense boundary |
| 14 | `MemoComponent` | React.memo wrapper |
| 15 | `SimpleMemoComponent` | React.memo of a function with no custom `compare` |
| 16 | `LazyComponent` | React.lazy wrapper |
| 17 | `IncompleteClassComponent` | Class component that errored during render |
| 18 | `DehydratedFragment` | Server-side rendered content not yet hydrated |
| 19 | `SuspenseListComponent` | SuspenseList (experimental) |
| 20 | `ScopeComponent` | Event scope (experimental) |
| 21 | `OffscreenComponent` | Offscreen/Activity (React 18+, used by Suspense internally) |
| 22 | `LegacyHiddenComponent` | Legacy hidden component (React 18) |
| 23 | `CacheComponent` | React.cache boundary (React 18+) |
| 24 | `TracingMarkerComponent` | Tracing marker (experimental) |
| 25 | `HostHoistable` | Hoistable DOM element like `<title>`, `<meta>` (React 19) |
| 26 | `HostSingleton` | Singleton DOM elements like `<html>`, `<head>`, `<body>` (React 19) |

For our purposes, the observer cares about tags 0 (FunctionComponent), 1 (ClassComponent), 10 (ContextProvider), 11 (ForwardRef), 14/15 (MemoComponent/SimpleMemoComponent), and 13 (SuspenseComponent). All other tags are traversed but not reported as component state changes.

---

## Hook Linked List

For function components (tag 0, 11, 14, 15), `fiber.memoizedState` is the head of a singly-linked list of hook objects. Each hook's shape depends on its type.

### Traversal

```typescript
function walkHooks(fiber: Fiber): HookNode[] {
	const hooks: HookNode[] = [];
	let hook = fiber.memoizedState;
	let index = 0;
	while (hook !== null) {
		hooks.push({ index, hook });
		hook = hook.next;
		index++;
	}
	return hooks;
}
```

### Hook Type Identification

Hooks are untyped objects. We identify them by structural inspection:

| Hook type | Distinguishing shape |
|-----------|---------------------|
| `useState` | `hook.queue !== null && hook.queue.dispatch !== undefined` and no `hook.queue.lastRenderedReducer` name containing "basicStateReducer" -- or the reducer itself is `basicStateReducer`. In practice, presence of `queue` without `create` marks it as useState/useReducer. |
| `useReducer` | Same as useState but `hook.queue.lastRenderedReducer` is a user-provided function (not `basicStateReducer`). In practice, we treat useState and useReducer identically for state extraction. |
| `useEffect` | `hook.memoizedState` has shape `{ create: Function, destroy: Function \| undefined, deps: Array \| null, tag: number }`. The `tag` is a bitmask: `HasEffect = 0b0001`, `Layout = 0b0100 (useLayoutEffect)`, `Passive = 0b1000 (useEffect)`. |
| `useLayoutEffect` | Same as useEffect but `tag & Layout !== 0`. |
| `useRef` | `hook.memoizedState` has shape `{ current: any }` and no `queue`, no `create`. |
| `useMemo` | `hook.memoizedState` is a tuple `[computedValue, deps]` where `deps` is an `Array` or `null`. No `queue` on the hook, no `create` on memoizedState. |
| `useCallback` | Identical shape to useMemo: `[callbackFn, deps]`. We cannot distinguish useCallback from useMemo structurally (they share the same hook implementation). |
| `useContext` | Does not appear in the hooks linked list. Context is read via `fiber.dependencies`. |
| `useId` | `hook.memoizedState` is a string (the generated ID). |
| `useTransition` | `hook.memoizedState` is a boolean (isPending), and the hook has a `queue`. |
| `useDeferredValue` | `hook.memoizedState` is the deferred value. Structurally ambiguous; identified by position heuristics or dev info. |

### useState/useReducer Queue Detail

```typescript
interface HookQueue {
	/** The most recently computed state (same as hook.memoizedState for useState). */
	lastRenderedState: any;
	/** The reducer function. For useState, this is basicStateReducer. */
	lastRenderedReducer: ((state: any, action: any) => any) | null;
	/** The dispatch function (setState or dispatch). */
	dispatch: ((action: any) => void) | null;
	/** Pending update queue (circular linked list during render). */
	pending: HookUpdate | null;
}

interface HookUpdate {
	action: any;
	next: HookUpdate; // circular
	lane: number;
	// ... other internal fields
}
```

### Effect Object Detail

```typescript
interface EffectObject {
	/** The effect function passed to useEffect/useLayoutEffect. */
	create: () => (() => void) | void;
	/** The cleanup function returned by create, or undefined. */
	destroy: (() => void) | undefined;
	/** Dependency array, or null if no deps provided. */
	deps: any[] | null;
	/** Bitmask: HasEffect=1, Insertion=2, Layout=4, Passive=8. */
	tag: number;
	/** Linked list of effects on this fiber (circular). */
	next: EffectObject;
}
```

---

## Version Compatibility

### React 16.8 -- 16.x

- Side-effect field is `fiber.effectTag` (not `flags`).
- DOM fiber lookup prefix: `__reactInternalInstance$` on DOM nodes.
- Context dependencies field: `fiber.contextDependencies` (with `observedBits`).
- No `onPostCommitFiberRoot` hook callback.
- No lanes model; uses `expirationTime` for priority.
- `SuspenseComponent` exists but has limited features.

### React 17.x

- `effectTag` renamed to `flags`.
- DOM fiber lookup prefix changed to `__reactFiber$`.
- Props accessible directly via `__reactProps$` prefix on DOM nodes.
- `contextDependencies` renamed to `dependencies` (and `observedBits` removed).
- `onPostCommitFiberRoot` added to hook interface.

### React 18.x

- Concurrent features: lanes model replaces expiration times.
- `OffscreenComponent` (tag 21) added for Suspense internals.
- `CacheComponent` (tag 23) added.
- `useSyncExternalStore`, `useInsertionEffect` added (new hook shapes in linked list).
- `createRoot` API: multiple roots common.

### React 19.x

- `HostHoistable` (tag 25) and `HostSingleton` (tag 26) added.
- `use()` hook: may suspend during render (not in hooks linked list, uses fiber.memoizedState differently when pending).
- Actions: `useActionState` (formerly `useFormState`), `useOptimistic`. These add new hook shapes.
- `ref` is a regular prop (no longer special `ref` handling on the fiber).
- `propTypes` and `defaultProps` removed from function components.
- Server Components: client references have `$$typeof: Symbol.for('react.client.reference')`. The observer only sees client components.

### Compatibility Branching Strategy

```typescript
function getEffectFlags(fiber: Fiber): number {
	// React 17+ uses `flags`, React 16 uses `effectTag`
	return fiber.flags ?? fiber.effectTag ?? 0;
}

function getFiberFromDOM(domNode: Element): Fiber | null {
	// Try React 17+ key first, then 16
	const key = Object.keys(domNode).find(
		(k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
	);
	return key ? (domNode as any)[key] : null;
}

function getDependencies(fiber: Fiber): FiberDependencies | null {
	return (fiber as any).dependencies ?? (fiber as any).contextDependencies ?? null;
}
```

---

## Bug Pattern Definitions

### Stale Closure

**Severity:** medium

**Criteria:** A function component re-renders, and an effect or callback's dependency array has not changed across N renders (configurable, default 5), while the component's state has changed. This indicates the closure captures an outdated value.

**Formal definition:**

```
STALE_CLOSURE(fiber, hookIndex) :=
  hook[hookIndex] is an effect or memoized callback
  AND hook[hookIndex].deps !== null           -- deps array present
  AND shallowEqual(hook[hookIndex].deps, prevDeps[hookIndex])   -- deps unchanged
  AND fiber.renderCount >= threshold          -- enough renders observed
  AND stateChanged(fiber)                     -- at least one useState hook value differs
```

**Evidence:**

```typescript
{
	hookIndex: number;
	unchangedDeps: unknown[];
	rendersSinceLastDepsChange: number;
	changedStateIndices: number[];
}
```

### Infinite Re-render

**Severity:** high

**Criteria:** A single component instance commits more than 15 times within a 1-second sliding window.

**Formal definition:**

```
INFINITE_RERENDER(componentKey) :=
  renderTimestamps[componentKey].filter(t => now - t < 1000).length > 15
```

**Evidence:**

```typescript
{
	rendersInWindow: number;
	windowMs: 1000;
	lastState: unknown;
	triggerPattern: string;  // e.g. "setState in useEffect with no deps"
}
```

### Missing Cleanup

**Severity:** low

**Criteria:** An effect's `create` function sets up a subscription-like pattern (calls `addEventListener`, `subscribe`, `setInterval`, `setTimeout`, `on(`) but the `destroy` function is `undefined` or does not call a corresponding teardown.

Because we cannot reliably inspect function source at runtime in production builds, this detection works heuristically:

```
MISSING_CLEANUP(fiber, hookIndex) :=
  hook[hookIndex] is a passive effect (tag & Passive)
  AND hook[hookIndex].destroy === undefined
  AND fiber has been mounted for > 2 seconds
  AND fiber has been unmounted/remounted (alternate tracking)
```

In development builds, we can additionally check `create.toString()` for subscription patterns, though this is unreliable with minified code.

**Evidence:**

```typescript
{
	hookIndex: number;
	effectTag: number;
	hasDestroyFn: boolean;
	mountDuration: number;
	componentMountCount: number;
}
```

### Excessive Context Re-render

**Severity:** medium

**Criteria:** A context provider's value changes, causing more than 20 consumer components to re-render within a single commit. This indicates the context value is not memoized or the context is too broad.

**Formal definition:**

```
EXCESSIVE_CONTEXT_RERENDER(contextProvider) :=
  provider.memoizedProps.value !== provider.alternate.memoizedProps.value
  AND countAffectedConsumers(provider) > 20
```

We count affected consumers by walking the fiber tree from the provider and finding all fibers with a `dependencies.firstContext` chain that includes this context.

**Evidence:**

```typescript
{
	contextDisplayName: string;
	affectedConsumerCount: number;
	consumerNames: string[];  // first 10
	valueSizeEstimate: number;
}
```
