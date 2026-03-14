# Design: Phase 14 — Framework Detection & Infrastructure

## Overview

Phase 14 establishes the infrastructure for framework-aware state observation in Browser Lens. It adds three new event types (`framework_detect`, `framework_state`, `framework_error`), extends the `chrome_start` config with `features.frameworkState`, creates the `FrameworkTracker` orchestrator class (parallel to `InputTracker`), and implements a detection injection script that identifies React, Vue, Solid, and Svelte on any page.

No state observation in this phase — just detection, wiring, and config gating.

---

## Implementation Units

### Unit 1: Event Type Extension

**File**: `src/browser/types.ts`

Extend the `EventType` union with three new framework event types. Define data shape interfaces for each.

```typescript
export type EventType =
	| "navigation"
	| "network_request"
	| "network_response"
	| "console"
	| "page_error"
	| "user_input"
	| "dom_mutation"
	| "form_state"
	| "screenshot"
	| "performance"
	| "websocket"
	| "storage_change"
	| "marker"
	// Framework state events (Phase 14+)
	| "framework_detect"
	| "framework_state"
	| "framework_error";

/** Data shape for framework_detect events. */
export interface FrameworkDetectData {
	framework: "react" | "vue" | "solid" | "svelte";
	version: string;
	rootCount: number;
	componentCount: number;
	/** Only React: production (0) or development (1) bundle. */
	bundleType?: 0 | 1;
	/** Detected state management library, if any. */
	storeDetected?: string;
}

/** Data shape for framework_state events. */
export interface FrameworkStateData {
	framework: string;
	componentName: string;
	componentPath?: string;
	changeType: "mount" | "update" | "unmount" | "store_mutation";
	changes?: Array<{ key: string; prev: unknown; next: unknown }>;
	renderCount?: number;
	triggerSource?: string;
	// Vue-specific extensions
	storeId?: string;
	mutationType?: string;
	actionName?: string;
}

/** Data shape for framework_error events. */
export interface FrameworkErrorData {
	framework: string;
	pattern: string;
	componentName: string;
	severity: "low" | "medium" | "high";
	detail: string;
	evidence: Record<string, unknown>;
}
```

**Implementation Notes**:
- These interfaces are documentation/type-safety aids — `RecordedEvent.data` remains `Record<string, unknown>` (the existing pattern). Consumers cast when they need typed access.
- No Zod schemas needed at this layer — the event types are produced internally, not validated from external input. Validation happens at the injection script → `__BL__` parse boundary in `FrameworkTracker.processFrameworkEvent()`.

**Acceptance Criteria**:
- [ ] `EventType` union includes `"framework_detect"`, `"framework_state"`, `"framework_error"`
- [ ] `FrameworkDetectData`, `FrameworkStateData`, `FrameworkErrorData` interfaces are exported
- [ ] Existing code compiles without changes (union extension is additive)

---

### Unit 2: Config Schema Extension

**Files**:
- `src/daemon/protocol.ts` — `BrowserStartParamsSchema`
- `src/mcp/tools/browser.ts` — `chrome_start` tool input schema
- `src/browser/recorder/index.ts` — `BrowserRecorderConfig`
- `src/daemon/server.ts` — `browser.start` handler

Add `features.frameworkState` to the config pipeline. The config flows: MCP tool input → daemon params → `BrowserRecorderConfig` → `FrameworkTracker`.

```typescript
// --- src/daemon/protocol.ts ---

export const FrameworkStateConfigSchema = z.union([
	z.boolean(),          // true = auto-detect all supported frameworks
	z.array(z.enum(["react", "vue", "solid", "svelte"])),  // specific frameworks
]).optional();

export const BrowserStartParamsSchema = z.object({
	port: z.number().default(9222),
	profile: z.string().optional(),
	attach: z.boolean().default(false),
	allTabs: z.boolean().default(false),
	tabFilter: z.string().optional(),
	url: z.string().optional(),
	screenshotIntervalMs: z.number().optional(),
	frameworkState: FrameworkStateConfigSchema,  // NEW
});
```

```typescript
// --- src/mcp/tools/browser.ts (chrome_start tool inputs) ---
// Add to the tool's Zod schema:
framework_state: z.union([
	z.boolean(),
	z.array(z.enum(["react", "vue", "solid", "svelte"])),
]).optional().describe(
	"Enable framework state observation. " +
	"true = auto-detect all supported frameworks. " +
	'["react"] = only React. ' +
	'["react", "vue"] = both. ' +
	"Default: false (disabled)."
),
```

```typescript
// --- src/browser/recorder/index.ts ---

export interface BrowserRecorderConfig {
	// ... existing fields ...
	/** Framework state observation config. false/undefined = disabled. */
	frameworkState?: boolean | string[];
}
```

```typescript
// --- src/daemon/server.ts (browser.start handler) ---
// Pass frameworkState through to BrowserRecorderConfig:
this.browserRecorder = new BrowserRecorder({
	// ... existing fields ...
	frameworkState: p.frameworkState,
});
```

**Implementation Notes**:
- The `FrameworkStateConfigSchema` is defined once in `protocol.ts` and reused in the MCP tool schema (Single Source of Truth).
- `false` and `undefined` both mean "disabled" — no framework scripts injected.
- `true` means "auto-detect all" — inject all detection shims, report whichever framework loads.
- An array of framework names means "only inject those specific framework shims".
- The MCP tool parameter uses `framework_state` (snake_case, matching existing `all_tabs`, `tab_filter`, `screenshot_interval_ms` naming). The daemon param uses `frameworkState` (camelCase, matching existing `allTabs`, `tabFilter`, `screenshotIntervalMs`).

**Acceptance Criteria**:
- [ ] `BrowserStartParamsSchema` accepts `frameworkState: true`, `frameworkState: ["react"]`, `frameworkState: ["react", "vue"]`, and `frameworkState: undefined`
- [ ] `BrowserStartParamsSchema` rejects `frameworkState: ["angular"]` (not in enum)
- [ ] `chrome_start` MCP tool schema includes `framework_state` parameter with description
- [ ] `BrowserRecorderConfig.frameworkState` is typed as `boolean | string[] | undefined`
- [ ] Daemon handler passes `frameworkState` through to `BrowserRecorderConfig`

---

### Unit 3: FrameworkTracker Class

**File**: `src/browser/recorder/framework/index.ts`

The orchestrator class, parallel to `InputTracker`. Manages framework detection scripts, processes `__BL__` framework events, and produces `RecordedEvent` objects.

```typescript
import type { EventType, RecordedEvent } from "../../types.js";
import { getDetectionScript } from "./detector.js";

/** Parsed __BL__ framework event from the injection script. */
export interface FrameworkBLEvent {
	type: "framework_detect" | "framework_state" | "framework_error";
	ts: number;
	data: Record<string, unknown>;
}

/** Normalized config for the framework tracker. */
export interface FrameworkTrackerConfig {
	/** Which frameworks to observe. Empty array = disabled. */
	frameworks: string[];
}

export class FrameworkTracker {
	private config: FrameworkTrackerConfig;

	constructor(frameworkState: boolean | string[] | undefined) {
		if (!frameworkState) {
			this.config = { frameworks: [] };
		} else if (frameworkState === true) {
			this.config = { frameworks: ["react", "vue", "solid", "svelte"] };
		} else {
			this.config = { frameworks: frameworkState };
		}
	}

	/** Whether framework tracking is enabled. */
	isEnabled(): boolean {
		return this.config.frameworks.length > 0;
	}

	/**
	 * Returns injection scripts to install via Page.addScriptToEvaluateOnNewDocument.
	 * In Phase 14, this returns only the detection script.
	 * Phase 15+ adds per-framework observer scripts.
	 */
	getInjectionScripts(): string[] {
		if (!this.isEnabled()) return [];
		return [getDetectionScript(this.config.frameworks)];
	}

	/**
	 * Try to parse a __BL__ console message as a framework event.
	 * Returns a RecordedEvent if the message is a framework_* event, null otherwise.
	 *
	 * Called by EventPipeline when it receives a __BL__ message that InputTracker
	 * does not recognize.
	 */
	processFrameworkEvent(rawJson: string, tabId: string): RecordedEvent | null {
		let parsed: FrameworkBLEvent;
		try {
			parsed = JSON.parse(rawJson);
		} catch {
			return null;
		}

		if (!parsed.type?.startsWith("framework_") || !parsed.ts || !parsed.data) {
			return null;
		}

		const type = parsed.type as EventType;
		const summary = this.buildSummary(parsed);

		return {
			id: crypto.randomUUID(),
			timestamp: parsed.ts,
			type,
			tabId,
			summary,
			data: parsed.data,
		};
	}

	private buildSummary(event: FrameworkBLEvent): string {
		const d = event.data;
		const fw = (d.framework as string) ?? "unknown";

		switch (event.type) {
			case "framework_detect":
				return `[${fw}] ${fw.charAt(0).toUpperCase() + fw.slice(1)} ${d.version ?? "?"} detected` +
					(d.rootCount != null ? ` (${d.rootCount} root${(d.rootCount as number) !== 1 ? "s" : ""})` : "");

			case "framework_state": {
				const name = (d.componentName as string) ?? "?";
				const change = (d.changeType as string) ?? "update";
				const count = d.renderCount != null ? ` (render #${d.renderCount})` : "";
				return `[${fw}] ${name}: ${change}${count}`;
			}

			case "framework_error": {
				const pattern = (d.pattern as string) ?? "unknown";
				const comp = (d.componentName as string) ?? "?";
				const severity = (d.severity as string) ?? "medium";
				return `[${fw}:${severity}] ${pattern} in ${comp}`;
			}

			default:
				return `[${fw}] framework event`;
		}
	}
}
```

**Implementation Notes**:
- The constructor normalizes the `boolean | string[] | undefined` config into a consistent internal shape.
- `processFrameworkEvent` is designed to be called from `EventPipeline.process()` when `InputTracker.processInputEvent()` returns `null` for a `__BL__` message. This way framework events flow through the same `__BL__` channel without modifying `InputTracker`.
- `buildSummary` follows the existing convention: summaries are human-readable one-liners used in `session_overview` and `session_search` renderers. The `[react]` prefix mirrors the `[react:warn]` / `[react:error]` format shown in the ROADMAP Phase 17 mockups.
- Phase 15+ will add per-framework observer classes managed by this tracker. For now it only returns the detection script.

**Acceptance Criteria**:
- [ ] `FrameworkTracker` constructed with `undefined` → `isEnabled()` returns `false`, `getInjectionScripts()` returns `[]`
- [ ] `FrameworkTracker` constructed with `true` → `isEnabled()` returns `true`, `getInjectionScripts()` returns `[detectionScript]`
- [ ] `FrameworkTracker` constructed with `["react"]` → `isEnabled()` returns `true`
- [ ] `processFrameworkEvent` parses valid `framework_detect` JSON → returns `RecordedEvent` with correct type, timestamp, summary
- [ ] `processFrameworkEvent` returns `null` for invalid JSON, non-framework types, missing fields
- [ ] Summary format: `[react] React 18.2.0 detected (1 root)` for detect events
- [ ] Summary format: `[react] UserProfile: update (render #3)` for state events
- [ ] Summary format: `[react:high] infinite_rerender in Counter` for error events

---

### Unit 4: Framework Detection Script

**File**: `src/browser/recorder/framework/detector.ts`

Generates the detection injection script. This script runs before any page JS and installs devtools hook shims that intercept framework registration. When a framework registers, it reports a `framework_detect` event via `__BL__`.

```typescript
/**
 * Generate the framework detection injection script.
 * This script installs shims for React and Vue devtools hooks,
 * plus MutationObserver-based detection for Solid and Svelte.
 *
 * @param frameworks - Which frameworks to detect. If empty, returns empty string.
 */
export function getDetectionScript(frameworks: string[]): string {
	// Returns a self-contained IIFE string
}
```

The generated script is a `var`-only IIFE (no `let`/`const`, no ES modules — max browser compat). It:

1. **React detection** (if `frameworks` includes `"react"`):
   - Checks if `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` already exists.
   - If not, installs a minimal shim with `supportsFiber: true`, `inject()`, `onCommitFiberRoot()`, `onCommitFiberUnmount()`, `renderers`, `getFiberRoots()`.
   - If it already exists (React DevTools installed), patches `inject()` to intercept renderer registration without breaking existing functionality.
   - On first `inject()` call: counts roots by walking `fiberRoot.current.child` siblings, reports `framework_detect` via `__BL__`.

2. **Vue detection** (if `frameworks` includes `"vue"`):
   - Checks if `window.__VUE_DEVTOOLS_GLOBAL_HOOK__` already exists.
   - If not, installs a minimal event-emitter shim with `on/emit/off/once`, `apps` Set, `appRecords` array, `enabled: true`, `_buffer` array.
   - If it already exists, patches `emit()` to intercept `app:init`.
   - Installs a setter trap on `hook.Vue` for Vue 2 detection.
   - Listens for `app:init` (Vue 3) and `hook.Vue` set (Vue 2).
   - On detection: reports `framework_detect` via `__BL__` with version and root count.

3. **Solid detection** (if `frameworks` includes `"solid"`):
   - After DOM ready, check for `window._$SOLID` or `window.__SOLID_DEV__`.
   - Also check for `data-hk` attributes on DOM elements (SolidJS hydration markers).
   - If found: report `framework_detect` with `devMode` flag.

4. **Svelte detection** (if `frameworks` includes `"svelte"`):
   - After DOM ready, check for DOM elements with `__svelte_meta` property (Svelte 5 dev) or elements whose constructor prototype chain includes `SvelteComponent` (Svelte 4).
   - If found: report `framework_detect` with version (4 or 5).

5. **Deferred detection**: For Solid and Svelte (which don't have global hooks), use a `MutationObserver` that watches for new `<script>` elements. When new scripts load, re-check detection conditions. Stop observing after 10 seconds or after detection.

6. **Reporting**: All detection reports use the existing `__BL__` channel:
   ```javascript
   console.debug('__BL__', JSON.stringify({
       type: 'framework_detect',
       ts: Date.now(),
       data: {
           framework: 'react',
           version: '18.2.0',
           rootCount: 1,
           componentCount: 0,  // initial — only accurate after Phase 15 tree walking
           bundleType: 1       // React-specific
       }
   }));
   ```

**Implementation Notes**:
- The script must handle **multiple frameworks on one page** (micro-frontends). Each detected framework emits its own `framework_detect` event.
- If both a pre-existing hook and our shim need to coexist, wrap the existing hook's methods rather than replacing them.
- React's hook must be installed before React's module body executes — `Page.addScriptToEvaluateOnNewDocument` guarantees this.
- Vue's hook must also be installed before Vue's `createApp` — same guarantee.
- For Solid/Svelte, detection is best-effort since they don't have standardized global hooks. The `MutationObserver` approach catches late-loading frameworks.
- `componentCount: 0` is reported initially. Accurate counts require tree walking (Phase 15/16). Detection-time count is a bonus if the hook shim happens to see a commit during detection, but it's not required.
- The script conditionally includes framework-specific blocks based on the `frameworks` parameter. If only `["react"]` is passed, Vue/Solid/Svelte detection code is not included.

**Acceptance Criteria**:
- [ ] `getDetectionScript([])` returns `""`
- [ ] `getDetectionScript(["react"])` returns a string containing `__REACT_DEVTOOLS_GLOBAL_HOOK__` but not `__VUE_DEVTOOLS_GLOBAL_HOOK__`
- [ ] `getDetectionScript(["react", "vue"])` returns a string containing both hooks
- [ ] Script uses only `var` declarations (no `let`/`const`)
- [ ] Script is a self-contained IIFE — no global leaks except the hook objects
- [ ] If `__REACT_DEVTOOLS_GLOBAL_HOOK__` already exists, it patches rather than replaces
- [ ] If `__VUE_DEVTOOLS_GLOBAL_HOOK__` already exists, it patches rather than replaces
- [ ] React detection: on `inject()` call, emits `__BL__` with `framework_detect` type, `framework: "react"`, and version string
- [ ] Vue 3 detection: on `app:init` event, emits `__BL__` with `framework: "vue"` and version
- [ ] Vue 2 detection: on `hook.Vue` setter trigger, emits `__BL__` with `framework: "vue"` and version
- [ ] Solid detection: checks for `window._$SOLID` and `data-hk` attributes
- [ ] Svelte detection: checks for `__svelte_meta` property on DOM elements
- [ ] Multiple frameworks: each detected framework emits its own event

---

### Unit 5: EventPipeline Integration

**File**: `src/browser/recorder/event-pipeline.ts`

Modify the `__BL__` message handling to route framework events through `FrameworkTracker` when `InputTracker` doesn't handle them.

```typescript
// Updated EventPipelineConfig:
export interface EventPipelineConfig {
	// ... existing fields ...
	/** Framework state tracker. Processes __BL__ framework_* events. */
	frameworkTracker?: FrameworkTracker;
}
```

The change is in the `process()` method's `__BL__` handling block. Currently:

```typescript
if (args?.[0]?.value === "__BL__" && args[1]?.value) {
    const inputEvent = inputTracker.processInputEvent(args[1].value, tabId);
    if (inputEvent) { /* handle */ }
    return;
}
```

After change:

```typescript
if (args?.[0]?.value === "__BL__" && args[1]?.value) {
    const raw = args[1].value;
    const inputEvent = inputTracker.processInputEvent(raw, tabId);
    if (inputEvent) {
        // ... existing input event handling (unchanged) ...
    } else if (this.config.frameworkTracker) {
        const fwEvent = this.config.frameworkTracker.processFrameworkEvent(raw, tabId);
        if (fwEvent) {
            buffer.push(fwEvent);
            this.config.invalidateSessionCache();
            this.checkAutoDetect(fwEvent);
            if (persistence) {
                persistence.onNewEvent(fwEvent, this.config.getSessionInfo());
            }
        }
    }
    return;
}
```

**Implementation Notes**:
- This is a minimal change — add an `else if` branch in the existing `__BL__` handler.
- `InputTracker.processInputEvent` already returns `null` for unrecognized `__BL__` messages (it tries `JSON.parse`, then checks for known `type` values). Framework events have `type: "framework_detect"` etc., which `InputTracker` doesn't recognize, so it returns `null`.
- The framework event follows the same flow as other events: push to buffer, invalidate cache, check auto-detect, persist. No special handling needed.
- `frameworkTracker` is optional on the config — when `undefined`, the `else if` branch is skipped.

**Acceptance Criteria**:
- [ ] `EventPipelineConfig` has optional `frameworkTracker` field
- [ ] `__BL__` messages with `type: "framework_detect"` are routed to `frameworkTracker.processFrameworkEvent()`
- [ ] Resulting `RecordedEvent` is pushed to buffer, persisted, and auto-detect checked
- [ ] `InputTracker`-handled events (`click`, `submit`, etc.) are unaffected
- [ ] When `frameworkTracker` is undefined, behavior is identical to current code

---

### Unit 6: BrowserRecorder Wiring

**File**: `src/browser/recorder/index.ts`

Wire `FrameworkTracker` into `BrowserRecorder` — construct it from config, pass it to `EventPipeline`, and inject its scripts during tab setup.

```typescript
import { FrameworkTracker } from "./framework/index.js";

export class BrowserRecorder {
    // ... existing fields ...
    private frameworkTracker: FrameworkTracker;

    constructor(config: BrowserRecorderConfig) {
        // ... existing initialization ...
        this.frameworkTracker = new FrameworkTracker(config.frameworkState);
    }

    async start(): Promise<BrowserSessionInfo> {
        // ... existing code ...

        // Wire up the event pipeline — add frameworkTracker to config:
        this.eventPipeline = new EventPipeline({
            // ... existing fields ...
            frameworkTracker: this.frameworkTracker.isEnabled() ? this.frameworkTracker : undefined,
        });

        // ... rest of existing code ...
    }

    private async startRecordingTab(targetId: string): Promise<void> {
        // ... existing code (enable domains, inject input tracker, setup control panel) ...

        // Inject framework detection scripts (after input tracker, before control panel is fine)
        for (const script of this.frameworkTracker.getInjectionScripts()) {
            await this.cdpClient
                .sendToTarget(sessionId, "Page.addScriptToEvaluateOnNewDocument", { source: script })
                .catch(() => {});
        }

        // ... rest of existing code ...
    }
}
```

**Implementation Notes**:
- `FrameworkTracker` is always constructed (even when disabled) — `isEnabled()` returns `false` and `getInjectionScripts()` returns `[]` when disabled, so there's no overhead.
- Framework scripts are injected via the same `Page.addScriptToEvaluateOnNewDocument` pattern as the input tracker script. Order matters: the framework detection script should be injected **before** the input tracker script if possible (so hooks are installed as early as possible), but the current `Page.addScriptToEvaluateOnNewDocument` runs scripts in registration order for each new document, so registering the framework script first is sufficient. Actually, looking at the code, the input tracker is injected first — that's fine. Both run before any page JS. The framework hooks just need to be there before React/Vue module evaluation, which happens well after all `addScriptToEvaluateOnNewDocument` scripts have run.
- The `frameworkTracker` is passed as `undefined` to the pipeline when disabled, so the `else if` branch in `EventPipeline.process()` is a no-op.

**Acceptance Criteria**:
- [ ] `BrowserRecorder` constructs `FrameworkTracker` from `config.frameworkState`
- [ ] `EventPipeline` receives `frameworkTracker` when enabled
- [ ] Framework injection scripts are added via `Page.addScriptToEvaluateOnNewDocument` in `startRecordingTab`
- [ ] When `frameworkState` is `undefined`/`false`, no scripts are injected and pipeline has no `frameworkTracker`
- [ ] When `frameworkState` is `true` or `["react"]`, scripts are injected

---

### Unit 7: Auto-Detection Rules for Framework Events

**File**: `src/browser/recorder/auto-detect.ts`

Add detection rules that trigger auto-markers for framework events.

```typescript
export const FRAMEWORK_DETECTION_RULES: DetectionRule[] = [
	// Framework detected — informational marker
	{
		eventTypes: ["framework_detect"],
		condition: () => true,
		label: (e) => `Framework: ${e.data.framework} ${e.data.version ?? ""} detected`,
		severity: "low",
		cooldownMs: 60000, // Once per minute (unlikely to fire more than once)
	},

	// High-severity framework bug patterns
	{
		eventTypes: ["framework_error"],
		condition: (e) => e.data.severity === "high",
		label: (e) => `${e.data.pattern}: ${(e.data.detail as string)?.slice(0, 100) ?? e.data.componentName}`,
		severity: "high",
		cooldownMs: 5000,
	},

	// Medium-severity framework bug patterns
	{
		eventTypes: ["framework_error"],
		condition: (e) => e.data.severity === "medium",
		label: (e) => `${e.data.pattern}: ${e.data.componentName}`,
		severity: "medium",
		cooldownMs: 10000,
	},
];
```

Update the `ALL_DETECTION_RULES` export:

```typescript
export const ALL_DETECTION_RULES: DetectionRule[] = [
	...DEFAULT_DETECTION_RULES,
	...PHASE_12_DETECTION_RULES,
	...FRAMEWORK_DETECTION_RULES,
];
```

**Implementation Notes**:
- The `framework_detect` rule fires once to place an informational marker when a framework is first detected. The 60s cooldown means it won't spam if multiple renderers inject (React micro-frontends).
- `framework_error` rules with `severity: "high"` (infinite re-renders) trigger auto-markers immediately. Medium-severity patterns (stale closures) have a longer cooldown.
- Low-severity `framework_error` events (missing cleanup) don't get auto-markers — they're visible in `session_search` but not noisy in the timeline.
- These rules use the new `"framework_detect"` and `"framework_error"` event types, which requires Unit 1 (EventType extension) to be implemented first.

**Acceptance Criteria**:
- [ ] `FRAMEWORK_DETECTION_RULES` is exported as an array of `DetectionRule`
- [ ] `ALL_DETECTION_RULES` includes the framework rules
- [ ] `framework_detect` event triggers a low-severity marker with framework name and version
- [ ] `framework_error` with `severity: "high"` triggers a high-severity marker
- [ ] `framework_error` with `severity: "medium"` triggers a medium-severity marker
- [ ] `framework_error` with `severity: "low"` does NOT trigger a marker (no rule matches)

---

## Implementation Order

1. **Unit 1: Event Type Extension** (`src/browser/types.ts`) — no dependencies, purely additive
2. **Unit 2: Config Schema Extension** (`protocol.ts`, `browser.ts`, `index.ts`, `server.ts`) — no code dependencies on Unit 1
3. **Unit 4: Detection Script** (`src/browser/recorder/framework/detector.ts`) — standalone, no imports from other new units
4. **Unit 3: FrameworkTracker Class** (`src/browser/recorder/framework/index.ts`) — imports from Unit 1 (types) and Unit 4 (detector)
5. **Unit 7: Auto-Detection Rules** (`auto-detect.ts`) — depends on Unit 1 (new EventType values)
6. **Unit 5: EventPipeline Integration** (`event-pipeline.ts`) — depends on Unit 3 (FrameworkTracker type)
7. **Unit 6: BrowserRecorder Wiring** (`index.ts`) — depends on Units 3, 5 (FrameworkTracker, updated EventPipeline)

Units 1, 2, 3, and 4 can be implemented in any order (or in parallel). Units 5, 6, 7 depend on earlier units.

---

## Testing

### Unit Tests: `tests/unit/browser/framework-tracker.test.ts`

Tests for `FrameworkTracker`:

```typescript
describe("FrameworkTracker", () => {
    describe("constructor normalization", () => {
        it("undefined → disabled")
        it("false → disabled")
        it("true → all frameworks enabled")
        it('["react"] → only react enabled')
        it('["react", "vue"] → both enabled')
    })

    describe("isEnabled", () => {
        it("returns false when disabled")
        it("returns true when enabled")
    })

    describe("getInjectionScripts", () => {
        it("returns empty array when disabled")
        it("returns [detectionScript] when enabled")
    })

    describe("processFrameworkEvent", () => {
        it("parses valid framework_detect JSON")
        it("parses valid framework_state JSON")
        it("parses valid framework_error JSON")
        it("returns null for invalid JSON")
        it("returns null for non-framework type")
        it("returns null for missing ts field")
        it("returns null for missing data field")
        it("generates correct summary for detect event")
        it("generates correct summary for state event")
        it("generates correct summary for error event with severity")
        it("uses crypto.randomUUID() for event id")
        it("preserves timestamp from parsed data")
    })
})
```

### Unit Tests: `tests/unit/browser/framework-detector.test.ts`

Tests for `getDetectionScript`:

```typescript
describe("getDetectionScript", () => {
    it("returns empty string for empty frameworks array")

    it("includes React hook shim when react is in list")
    it("does not include React hook when react is not in list")

    it("includes Vue hook shim when vue is in list")
    it("does not include Vue hook when vue is not in list")

    it("includes Solid detection when solid is in list")
    it("includes Svelte detection when svelte is in list")

    it("uses only var declarations (no let/const)")
    it("is a self-contained IIFE")
    it("contains __BL__ reporting")
    it("includes framework_detect type in reports")

    describe("React shim", () => {
        it("sets supportsFiber: true")
        it("implements inject() that returns numeric id")
        it("implements onCommitFiberRoot")
        it("implements onCommitFiberUnmount")
        it("implements getFiberRoots")
        it("handles pre-existing hook by patching inject")
    })

    describe("Vue shim", () => {
        it("implements on/emit/off/once event emitter")
        it("initializes apps Set and appRecords array")
        it("sets enabled: true")
        it("initializes _buffer array")
        it("installs Vue 2 setter trap on hook.Vue")
        it("handles pre-existing hook by patching emit")
    })
})
```

### Unit Tests: `tests/unit/browser/auto-detect-framework.test.ts`

Tests for the framework auto-detection rules:

```typescript
describe("FRAMEWORK_DETECTION_RULES", () => {
    it("fires low-severity marker on framework_detect event")
    it("fires high-severity marker on framework_error with severity=high")
    it("fires medium-severity marker on framework_error with severity=medium")
    it("does not fire on framework_error with severity=low")
    it("does not fire on non-framework event types")
    it("respects cooldown on framework_detect (60s)")
    it("respects cooldown on high-severity framework_error (5s)")
})
```

### Unit Tests: `tests/unit/browser/config-validation.test.ts`

Tests for the config schema changes:

```typescript
describe("BrowserStartParamsSchema frameworkState", () => {
    it("accepts undefined (disabled)")
    it("accepts true (auto-detect all)")
    it("accepts false (disabled)")
    it('accepts ["react"]')
    it('accepts ["react", "vue"]')
    it('accepts ["react", "vue", "solid", "svelte"]')
    it('rejects ["angular"] — not in enum')
    it('rejects ["react", "angular"] — invalid entry in array')
    it("rejects non-boolean, non-array value")
})
```

### Integration Tests: `tests/unit/browser/event-pipeline-framework.test.ts`

Tests for the EventPipeline integration (uses mock FrameworkTracker):

```typescript
describe("EventPipeline framework event routing", () => {
    it("routes __BL__ framework_detect to FrameworkTracker")
    it("routes __BL__ framework_state to FrameworkTracker")
    it("routes __BL__ framework_error to FrameworkTracker")
    it("pushes framework events to buffer")
    it("calls persistence.onNewEvent for framework events")
    it("runs auto-detect check on framework events")
    it("still routes click/submit/change to InputTracker")
    it("does not route framework events when frameworkTracker is undefined")
})
```

### E2E Tests: `tests/e2e/browser/framework-detection.test.ts`

Full pipeline test with real Chrome and a minimal React/Vue fixture app:

```typescript
describe("Framework detection E2E", () => {
    it("detects React on a React app page")
    it("detects Vue on a Vue app page")
    it("framework_detect event appears in session_search results")
    it("framework_detect auto-marker is placed")
    it("no framework events when frameworkState is disabled")
})
```

Fixture apps needed:
- `tests/fixtures/browser/react-app/` — minimal React 18 counter app (single component, `<script>` tag with CDN React)
- `tests/fixtures/browser/vue-app/` — minimal Vue 3 app (single component, `<script>` tag with CDN Vue)

These are tiny HTML files with inline `<script>` tags loading React/Vue from CDN — no build step.

---

## Verification Checklist

```bash
# All tests pass
bun run test:unit -- --grep "framework"
bun run test:unit -- --grep "FrameworkTracker"
bun run test:unit -- --grep "detection"

# Lint passes
bun run lint

# Type check passes
bunx tsc --noEmit

# E2E tests (requires Chrome)
bun run test:e2e -- --grep "Framework detection"

# Existing tests still pass (no regressions)
bun run test:unit
bun run test:e2e
```
