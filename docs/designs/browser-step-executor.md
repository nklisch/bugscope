# Design: Browser Step Executor (`chrome_run_steps`)

## Overview

Add a single new MCP tool `chrome_run_steps` that executes a sequence of browser actions via CDP, with optional naming for session-scoped replay. This gives agents batch browser control — set up reproduction scenarios, drive forms, navigate flows — in one tool call instead of requiring individual operations. All actions are recorded into the normal investigation pipeline (markers, screenshots, events).

**Depends on:** Phase 9–12 (browser recorder, storage, investigation, intelligence — all implemented)

---

## Implementation Units

### Unit 1: Step Schema Definitions

**File**: `src/browser/executor/types.ts` (new)

Define the step action vocabulary as a Zod discriminated union. Each action type has its own schema, and the top-level `StepSchema` is a discriminated union on the `action` field.

```typescript
import { z } from "zod";

// --- Action Schemas ---

export const STEP_ACTIONS = [
	"navigate", "reload",
	"click", "fill", "select", "submit", "type", "hover",
	"scroll_to", "scroll_by",
	"wait", "wait_for", "wait_for_navigation", "wait_for_network_idle",
	"screenshot", "mark",
	"evaluate",
] as const;
export const StepActionSchema = z.enum(STEP_ACTIONS);
export type StepAction = z.infer<typeof StepActionSchema>;

// Navigation
const NavigateStepSchema = z.object({
	action: z.literal("navigate"),
	url: z.string().describe("URL to navigate to (absolute or relative to current origin)"),
	screenshot: z.boolean().optional(),
});
const ReloadStepSchema = z.object({
	action: z.literal("reload"),
	screenshot: z.boolean().optional(),
});

// Input
const ClickStepSchema = z.object({
	action: z.literal("click"),
	selector: z.string().describe("CSS selector of element to click"),
	screenshot: z.boolean().optional(),
});
const FillStepSchema = z.object({
	action: z.literal("fill"),
	selector: z.string().describe("CSS selector of input/textarea element"),
	value: z.string().describe("Value to set"),
	screenshot: z.boolean().optional(),
});
const SelectStepSchema = z.object({
	action: z.literal("select"),
	selector: z.string().describe("CSS selector of <select> element"),
	value: z.string().describe("Option value to select"),
	screenshot: z.boolean().optional(),
});
const SubmitStepSchema = z.object({
	action: z.literal("submit"),
	selector: z.string().describe("CSS selector of <form> element"),
	screenshot: z.boolean().optional(),
});
const TypeStepSchema = z.object({
	action: z.literal("type"),
	selector: z.string().describe("CSS selector of element to type into"),
	text: z.string().describe("Text to type keystroke-by-keystroke"),
	delay_ms: z.number().optional().describe("Delay between keystrokes in ms. Default: 50"),
	screenshot: z.boolean().optional(),
});
const HoverStepSchema = z.object({
	action: z.literal("hover"),
	selector: z.string().describe("CSS selector of element to hover over"),
	screenshot: z.boolean().optional(),
});

// Scroll
const ScrollToStepSchema = z.object({
	action: z.literal("scroll_to"),
	selector: z.string().describe("CSS selector of element to scroll into view"),
	screenshot: z.boolean().optional(),
});
const ScrollByStepSchema = z.object({
	action: z.literal("scroll_by"),
	x: z.number().optional().describe("Horizontal scroll delta in pixels. Default: 0"),
	y: z.number().optional().describe("Vertical scroll delta in pixels. Default: 0"),
	screenshot: z.boolean().optional(),
});

// Waiting
const WaitStepSchema = z.object({
	action: z.literal("wait"),
	ms: z.number().describe("Milliseconds to wait"),
	screenshot: z.boolean().optional(),
});
const WaitForStepSchema = z.object({
	action: z.literal("wait_for"),
	selector: z.string().describe("CSS selector to wait for"),
	state: z.enum(["visible", "hidden", "attached"]).optional().describe("Element state to wait for. Default: visible"),
	timeout: z.number().optional().describe("Timeout in ms. Default: 5000"),
	screenshot: z.boolean().optional(),
});
const WaitForNavigationStepSchema = z.object({
	action: z.literal("wait_for_navigation"),
	url: z.string().optional().describe("URL substring to match. If omitted, waits for any navigation."),
	timeout: z.number().optional().describe("Timeout in ms. Default: 10000"),
	screenshot: z.boolean().optional(),
});
const WaitForNetworkIdleStepSchema = z.object({
	action: z.literal("wait_for_network_idle"),
	idle_ms: z.number().optional().describe("Required idle period in ms. Default: 500"),
	timeout: z.number().optional().describe("Timeout in ms. Default: 10000"),
	screenshot: z.boolean().optional(),
});

// Capture (explicit — beyond auto-capture)
const ScreenshotStepSchema = z.object({
	action: z.literal("screenshot"),
	label: z.string().optional().describe("Label for the screenshot"),
});
const MarkStepSchema = z.object({
	action: z.literal("mark"),
	label: z.string().describe("Label for the marker"),
});

// Evaluation
const EvaluateStepSchema = z.object({
	action: z.literal("evaluate"),
	expression: z.string().describe("JavaScript expression to evaluate in the page context"),
	screenshot: z.boolean().optional(),
});

// --- Discriminated Union ---

export const StepSchema = z.discriminatedUnion("action", [
	NavigateStepSchema,
	ReloadStepSchema,
	ClickStepSchema,
	FillStepSchema,
	SelectStepSchema,
	SubmitStepSchema,
	TypeStepSchema,
	HoverStepSchema,
	ScrollToStepSchema,
	ScrollByStepSchema,
	WaitStepSchema,
	WaitForStepSchema,
	WaitForNavigationStepSchema,
	WaitForNetworkIdleStepSchema,
	ScreenshotStepSchema,
	MarkStepSchema,
	EvaluateStepSchema,
]);
export type Step = z.infer<typeof StepSchema>;

// --- Capture Config ---

export const CAPTURE_SCREENSHOT_MODES = ["all", "none", "on_error"] as const;
export const CaptureScreenshotModeSchema = z.enum(CAPTURE_SCREENSHOT_MODES);

export const CaptureConfigSchema = z.object({
	screenshot: CaptureScreenshotModeSchema.optional().describe('When to auto-screenshot each step. Default: "all"'),
	markers: z.boolean().optional().describe("Auto-place a marker at each step. Default: true"),
});
export type CaptureConfig = z.infer<typeof CaptureConfigSchema>;

// --- Run Steps Params ---

export const RunStepsParamsSchema = z.object({
	steps: z.array(StepSchema).optional().describe("Ordered actions to execute. Required unless replaying a named scenario."),
	name: z.string().optional().describe("Name for saving or replaying a scenario"),
	save: z.boolean().optional().describe("Save steps under the given name for later replay. Requires name."),
	capture: CaptureConfigSchema.optional().describe("Capture configuration for all steps"),
});
export type RunStepsParams = z.infer<typeof RunStepsParamsSchema>;

// --- Step Result ---

export interface StepResult {
	index: number;
	action: StepAction;
	/** Short description of the step, e.g. "navigate /login" */
	label: string;
	status: "ok" | "error";
	durationMs: number;
	/** Screenshot file path, if captured */
	screenshotPath?: string;
	/** Marker ID, if placed */
	markerId?: string;
	/** Error message, if failed */
	error?: string;
	/** Return value from evaluate steps */
	returnValue?: string;
}

export interface RunStepsResult {
	/** Total steps attempted */
	totalSteps: number;
	/** Steps that completed successfully */
	completedSteps: number;
	/** Per-step results */
	results: StepResult[];
	/** Session ID of the recording (if auto-started or already active) */
	sessionId?: string;
	/** Total execution time */
	totalDurationMs: number;
}
```

**Implementation Notes**:
- The discriminated union on `action` gives Zod clean parse errors per action type
- Per-step `screenshot: boolean` override lets agents suppress auto-screenshots on noisy steps like `fill`
- `screenshot` and `mark` actions are always explicit and don't themselves have a `screenshot` override (they _are_ the capture action)

**Acceptance Criteria**:
- [ ] `StepSchema.parse()` accepts valid steps for all 17 action types
- [ ] `StepSchema.parse()` rejects unknown action types
- [ ] `RunStepsParamsSchema.parse()` rejects params with neither `steps` nor `name`
- [ ] Per-step `screenshot` override is optional on all action types except `screenshot` and `mark`
- [ ] All types are exported and match the signatures above

---

### Unit 2: Step Executor Engine

**File**: `src/browser/executor/step-executor.ts` (new)

The core engine that executes an array of `Step` objects against a CDP session. It is a pure domain class — it receives a port interface for CDP commands and screenshot capture, and does not depend on `BrowserRecorder` or `DaemonServer` directly.

```typescript
import type { Step, StepResult, CaptureConfig, RunStepsResult } from "./types.js";

/** Port interface for CDP operations needed by the executor. */
export interface StepExecutorPort {
	/** Evaluate JS in the page and return the stringified result. */
	evaluate(expression: string): Promise<string>;
	/** Navigate to a URL. Resolves after page load. */
	navigate(url: string): Promise<void>;
	/** Reload the current page. */
	reload(): Promise<void>;
	/** Dispatch a mouse click at the center of the element matching selector. */
	click(selector: string): Promise<void>;
	/** Set value on an input/textarea element (triggers input + change events). */
	fill(selector: string, value: string): Promise<void>;
	/** Select an option by value in a <select> element. */
	select(selector: string, value: string): Promise<void>;
	/** Submit a form via requestSubmit(). */
	submit(selector: string): Promise<void>;
	/** Type text keystroke-by-keystroke with delay between keys. */
	type(selector: string, text: string, delayMs: number): Promise<void>;
	/** Dispatch a mouseover event on the element matching selector. */
	hover(selector: string): Promise<void>;
	/** Scroll element into view. */
	scrollTo(selector: string): Promise<void>;
	/** Scroll the page by delta pixels. */
	scrollBy(x: number, y: number): Promise<void>;
	/** Wait for an element matching selector to reach the given state. */
	waitFor(selector: string, state: "visible" | "hidden" | "attached", timeoutMs: number): Promise<void>;
	/** Wait for a navigation event (optionally matching a URL substring). */
	waitForNavigation(urlMatch: string | undefined, timeoutMs: number): Promise<void>;
	/** Wait for network to be idle (no requests for idleMs). */
	waitForNetworkIdle(idleMs: number, timeoutMs: number): Promise<void>;
	/** Capture a screenshot, return the file path. */
	captureScreenshot(label?: string): Promise<string>;
	/** Place a marker, return the marker ID. */
	placeMarker(label: string): Promise<string>;
}

export class StepExecutor {
	constructor(private port: StepExecutorPort) {}

	/**
	 * Execute a sequence of steps. Stops on first error.
	 * Returns results for all attempted steps.
	 */
	async execute(steps: Step[], capture?: CaptureConfig): Promise<RunStepsResult> {
		const screenshotMode = capture?.screenshot ?? "all";
		const autoMarkers = capture?.markers !== false;
		const results: StepResult[] = [];
		const overallStart = Date.now();

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];
			const stepStart = Date.now();
			const label = this.formatStepLabel(step);
			let markerId: string | undefined;
			let screenshotPath: string | undefined;
			let returnValue: string | undefined;

			try {
				// Auto-marker before action
				if (autoMarkers) {
					markerId = await this.port.placeMarker(`step:${i + 1}:${label}`);
				}

				// Execute the action
				returnValue = await this.executeStep(step);

				// Auto-screenshot after action
				const shouldScreenshot = this.shouldCapture(step, screenshotMode);
				if (shouldScreenshot) {
					screenshotPath = await this.port.captureScreenshot(`step:${i + 1}:${label}`);
				}

				results.push({
					index: i + 1,
					action: step.action,
					label,
					status: "ok",
					durationMs: Date.now() - stepStart,
					screenshotPath,
					markerId,
					returnValue,
				});
			} catch (err) {
				// Capture screenshot on error if configured
				if (screenshotMode === "on_error" || screenshotMode === "all") {
					try {
						screenshotPath = await this.port.captureScreenshot(`step:${i + 1}:error:${label}`);
					} catch { /* ignore screenshot failure on error */ }
				}

				results.push({
					index: i + 1,
					action: step.action,
					label,
					status: "error",
					durationMs: Date.now() - stepStart,
					screenshotPath,
					markerId,
					error: err instanceof Error ? err.message : String(err),
				});
				break; // Stop on first error
			}
		}

		return {
			totalSteps: steps.length,
			completedSteps: results.filter((r) => r.status === "ok").length,
			results,
			totalDurationMs: Date.now() - overallStart,
		};
	}

	private async executeStep(step: Step): Promise<string | undefined> { /* dispatch per action type */ }
	private shouldCapture(step: Step, mode: "all" | "none" | "on_error"): boolean { /* see notes */ }
	private formatStepLabel(step: Step): string { /* e.g. "navigate:/login", "click:#submit" */ }
}
```

**Implementation Notes**:

- `executeStep()` is a switch on `step.action`:
  - `navigate`: call `this.port.navigate(step.url)` — if URL is relative (starts with `/`), the executor passes it as-is; the port adapter resolves it against the current page origin via `evaluate("location.origin")`
  - `reload`: call `this.port.reload()`
  - `click`: call `this.port.click(step.selector)`
  - `fill`: call `this.port.fill(step.selector, step.value)`
  - `select`: call `this.port.select(step.selector, step.value)`
  - `submit`: call `this.port.submit(step.selector)`
  - `type`: call `this.port.type(step.selector, step.text, step.delay_ms ?? 50)`
  - `hover`: call `this.port.hover(step.selector)`
  - `scroll_to`: call `this.port.scrollTo(step.selector)`
  - `scroll_by`: call `this.port.scrollBy(step.x ?? 0, step.y ?? 0)`
  - `wait`: `await new Promise(r => setTimeout(r, step.ms))`
  - `wait_for`: call `this.port.waitFor(step.selector, step.state ?? "visible", step.timeout ?? 5000)`
  - `wait_for_navigation`: call `this.port.waitForNavigation(step.url, step.timeout ?? 10000)`
  - `wait_for_network_idle`: call `this.port.waitForNetworkIdle(step.idle_ms ?? 500, step.timeout ?? 10000)`
  - `screenshot`: call `this.port.captureScreenshot(step.label)` — explicit screenshot, always taken
  - `mark`: call `this.port.placeMarker(step.label)` — explicit marker, always placed
  - `evaluate`: call `this.port.evaluate(step.expression)` and return the result

- `shouldCapture()` logic:
  - If mode is `"none"`, return false
  - If mode is `"on_error"`, return false (error screenshots are handled in the catch block)
  - If mode is `"all"`: return true, UNLESS the step has `screenshot: false` override, OR the step action is `screenshot`/`mark` (these are capture actions themselves)
  - The `screenshot` and `mark` action types never trigger auto-screenshots (they _are_ the capture)

- `formatStepLabel()` produces a short human-readable label:
  - `navigate:/login`, `click:#submit`, `fill:#email`, `wait:500ms`, `evaluate:...`, `screenshot:after-login`
  - Truncate long selectors/expressions to 40 chars

**Acceptance Criteria**:
- [ ] Executor runs all steps sequentially
- [ ] Execution stops on first error with partial results
- [ ] Auto-markers placed before each action (when `markers: true`)
- [ ] Auto-screenshots captured after each action (when `screenshot: "all"`)
- [ ] Per-step `screenshot: false` suppresses auto-screenshot for that step
- [ ] `screenshot: "on_error"` only captures on failure
- [ ] `screenshot: "none"` never auto-captures (explicit `screenshot` steps still work)
- [ ] `evaluate` step returns the JS result in `returnValue`
- [ ] All 17 action types are dispatched correctly

---

### Unit 3: CDP Port Adapter

**File**: `src/browser/executor/cdp-adapter.ts` (new)

Implements `StepExecutorPort` using the existing `CDPClient` and `BrowserRecorder`. This is the infrastructure adapter — it translates the port interface into actual CDP commands.

```typescript
import type { CDPClient } from "../recorder/cdp-client.js";
import type { BrowserRecorder } from "../recorder/index.js";
import type { ScreenshotCapture } from "../storage/screenshot.js";
import type { StepExecutorPort } from "./step-executor.js";

export interface CDPAdapterConfig {
	cdpClient: CDPClient;
	tabSessionId: string;
	recorder: BrowserRecorder;
	screenshotCapture: ScreenshotCapture | null;
	screenshotDir: string | null;
}

export class CDPPortAdapter implements StepExecutorPort {
	constructor(private config: CDPAdapterConfig) {}

	async evaluate(expression: string): Promise<string> { /* Runtime.evaluate */ }
	async navigate(url: string): Promise<void> { /* resolve relative URL + Page.navigate + wait for load */ }
	async reload(): Promise<void> { /* Page.reload + wait for load */ }
	async click(selector: string): Promise<void> { /* evaluate: querySelector.click() */ }
	async fill(selector: string, value: string): Promise<void> { /* evaluate: native setter + input/change events */ }
	async select(selector: string, value: string): Promise<void> { /* evaluate: set .value + change event */ }
	async submit(selector: string): Promise<void> { /* evaluate: requestSubmit() */ }
	async type(selector: string, text: string, delayMs: number): Promise<void> { /* Input.dispatchKeyEvent per char */ }
	async hover(selector: string): Promise<void> { /* evaluate + dispatch mouseover/mouseenter */ }
	async scrollTo(selector: string): Promise<void> { /* evaluate: scrollIntoView() */ }
	async scrollBy(x: number, y: number): Promise<void> { /* evaluate: window.scrollBy() */ }
	async waitFor(selector: string, state: string, timeoutMs: number): Promise<void> { /* poll with timeout */ }
	async waitForNavigation(urlMatch: string | undefined, timeoutMs: number): Promise<void> { /* listen Page.frameNavigated */ }
	async waitForNetworkIdle(idleMs: number, timeoutMs: number): Promise<void> { /* track Network.requestWillBeSent/loadingFinished */ }
	async captureScreenshot(label?: string): Promise<string> { /* delegate to ScreenshotCapture.capture() */ }
	async placeMarker(label: string): Promise<string> { /* delegate to BrowserRecorder.placeMarker() */ }
}
```

**Implementation Notes**:

- **`evaluate`**: Use `Runtime.evaluate` with `returnByValue: true` via `cdpClient.sendToTarget()`. Return `String(result.value)`. Throw `StepExecutionError` if `result.exceptionDetails` is present.
- **`navigate`**: Resolve relative URLs by first evaluating `location.origin`, then `Page.navigate`. Wait for `Page.loadEventFired` or a 5s timeout.
- **`click`**: Evaluate `document.querySelector(selector)?.click()`. Throw if element not found. Use the same JS pattern as the test harness. Add a 100ms settle delay.
- **`fill`**: Reuse the exact `fill()` JS from the test harness — native setter + input/change events. This triggers React/Vue internal value tracking correctly.
- **`type`**: Use `Input.dispatchKeyEvent` with `type: "keyDown"` + `type: "keyUp"` for each character. Insert `delayMs` pause between characters.
- **`hover`**: Evaluate JS to dispatch `mouseenter` + `mouseover` events on the element. Use `new MouseEvent("mouseover", { bubbles: true })`.
- **`scrollTo`**: Evaluate `document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "center" })`.
- **`scrollBy`**: Evaluate `window.scrollBy(x, y)`.
- **`waitFor`**: Poll via `Runtime.evaluate` checking element existence/visibility. Poll every 100ms until state matches or timeout. For `"visible"`, check `offsetParent !== null && getComputedStyle(el).visibility !== "hidden"`. For `"hidden"`, inverse. For `"attached"`, just check `querySelector !== null`.
- **`waitForNavigation`**: Set up a CDP event listener for `Page.frameNavigated`, resolve when `frame.url` contains `urlMatch` (or any navigation if no match). Reject on timeout.
- **`waitForNetworkIdle`**: Track inflight requests via `Network.requestWillBeSent` (increment) and `Network.loadingFinished`/`Network.loadingFailed` (decrement). When count hits 0, start an idle timer. If no new requests for `idleMs`, resolve. Reject on timeout.
- **`captureScreenshot`**: If `screenshotCapture` and `screenshotDir` are available, delegate to `screenshotCapture.capture()`. Otherwise return `""` (no-op).
- **`placeMarker`**: Delegate to `recorder.placeMarker(label)`, return `marker.id`.

**Acceptance Criteria**:
- [ ] All `StepExecutorPort` methods are implemented
- [ ] `fill` uses native setter pattern (React/Vue compatible)
- [ ] `type` dispatches individual key events with delay
- [ ] `waitFor` respects timeout and polls at 100ms intervals
- [ ] `waitForNavigation` resolves on matching frame navigation
- [ ] `waitForNetworkIdle` tracks inflight requests correctly
- [ ] Relative URLs in `navigate` are resolved against current page origin
- [ ] All methods throw `StepExecutionError` with actionable messages on failure

---

### Unit 4: Scenario Store (Session-Scoped)

**File**: `src/browser/executor/scenario-store.ts` (new)

In-memory store for named scenarios. Lives on the `DaemonServer` instance — scenarios are lost when the daemon stops.

```typescript
import type { Step } from "./types.js";

export interface SavedScenario {
	name: string;
	steps: Step[];
	savedAt: number;
}

export class ScenarioStore {
	private scenarios = new Map<string, SavedScenario>();

	save(name: string, steps: Step[]): void {
		this.scenarios.set(name, { name, steps, savedAt: Date.now() });
	}

	get(name: string): SavedScenario | undefined {
		return this.scenarios.get(name);
	}

	list(): SavedScenario[] {
		return [...this.scenarios.values()];
	}

	delete(name: string): boolean {
		return this.scenarios.delete(name);
	}

	clear(): void {
		this.scenarios.clear();
	}
}
```

**Implementation Notes**:
- Simple `Map`-backed store, no disk persistence
- The `DaemonServer` holds a single `ScenarioStore` instance, shared across all `browser.run-steps` calls
- Cleared on daemon shutdown (natural behavior since it's in-memory)

**Acceptance Criteria**:
- [ ] `save` + `get` round-trips correctly
- [ ] `list` returns all saved scenarios
- [ ] `delete` removes a named scenario
- [ ] `clear` empties the store

---

### Unit 5: Step Result Renderer

**File**: `src/browser/executor/renderer.ts` (new)

Formats `RunStepsResult` into a concise text summary for the MCP tool response.

```typescript
import type { RunStepsResult } from "./types.js";

export function renderStepResults(result: RunStepsResult): string { /* ... */ }
```

**Implementation Notes**:

Output format:

```
Step Results (5/5 completed, 2.1s total):

 1. navigate /login              ✓  320ms  📸 screenshot_001.jpg
 2. fill #email                  ✓   45ms
 3. fill #password               ✓   38ms
 4. click #submit                ✓   12ms  📸 screenshot_004.jpg
 5. wait_for .dashboard          ✓ 1240ms  📸 screenshot_005.jpg

Session: abc-123 (use session_overview to investigate)
```

On error:

```
Step Results (3/5 completed, 1.8s total — STOPPED on step 4):

 1. navigate /login              ✓  320ms  📸 screenshot_001.jpg
 2. fill #email                  ✓   45ms
 3. click #submit                ✓   12ms  📸 screenshot_003.jpg
 4. wait_for .dashboard          ✗ 5003ms  📸 screenshot_err.jpg
    Error: Timeout waiting for selector ".dashboard" (5000ms)

Session: abc-123 (use session_overview to investigate)
```

- Use `✓` / `✗` for status
- Right-align duration column
- Include screenshot path if present (just the filename, not full path)
- Include `returnValue` for `evaluate` steps: `evaluate ...  ✓  12ms  → "42"`
- Append session ID at the bottom for easy follow-up with investigation tools

**Acceptance Criteria**:
- [ ] All-success case renders correctly with step count and total time
- [ ] Partial-failure case shows stop point and error message
- [ ] Evaluate steps show return value
- [ ] Screenshot filenames are included where captured
- [ ] Session ID is always shown at the bottom

---

### Unit 6: Daemon RPC Method `browser.run-steps`

**File**: `src/daemon/protocol.ts` (modify) + `src/daemon/server.ts` (modify)

Add the RPC method definition and handler.

**protocol.ts additions:**

```typescript
import {
	RunStepsParamsSchema,
	type RunStepsParams,
} from "../browser/executor/types.js";

// Add to RpcMethods:
"browser.run-steps": { params: BrowserRunStepsParams; result: BrowserRunStepsResult };

// Param schema for the daemon boundary:
export const BrowserRunStepsParamsSchema = RunStepsParamsSchema;
export type BrowserRunStepsParams = RunStepsParams;

// Result type reuses RunStepsResult from executor types
export type BrowserRunStepsResult = import("../browser/executor/types.js").RunStepsResult;
```

**server.ts handler:**

```typescript
case "browser.run-steps": {
	const p = BrowserRunStepsParamsSchema.parse(params);

	// Resolve steps: from params or from saved scenario
	let steps: Step[];
	if (p.steps) {
		steps = p.steps;
	} else if (p.name) {
		const scenario = this.scenarioStore.get(p.name);
		if (!scenario) throw new BrowserRecorderStateError(`No saved scenario named "${p.name}"`);
		steps = scenario.steps;
	} else {
		throw new BrowserRecorderStateError("Either steps or name is required");
	}

	// Save scenario if requested
	if (p.save && p.name) {
		this.scenarioStore.save(p.name, steps);
	}

	// Auto-start recording if not already active
	if (!this.browserRecorder?.isRecording()) {
		throw new BrowserRecorderStateError(
			"No active browser recording. Call browser.start first, then run steps."
		);
	}

	// Build the CDP port adapter
	const adapter = this.buildStepExecutorAdapter();
	const executor = new StepExecutor(adapter);

	// Execute
	const result = await executor.execute(steps, p.capture);
	result.sessionId = this.browserRecorder.getSessionInfo()?.id;

	return result;
}
```

**Implementation Notes**:
- The handler requires an active recording session (via `browser.start`). We do NOT auto-start a recording because `browser.start` has important config (profile, URL, framework_state) that can't be inferred.
- The `buildStepExecutorAdapter()` private method on `DaemonServer` constructs a `CDPPortAdapter` from the active recorder's internals. This requires exposing a few additional getters on `BrowserRecorder` (see Unit 7).
- The `ScenarioStore` is an instance field on `DaemonServer`, initialized in the constructor.

**Acceptance Criteria**:
- [ ] `browser.run-steps` with `steps` array executes and returns results
- [ ] `browser.run-steps` with `name` + `save: true` stores the scenario
- [ ] `browser.run-steps` with just `name` replays a saved scenario
- [ ] `browser.run-steps` without active recording returns a clear error
- [ ] `browser.run-steps` with neither `steps` nor `name` returns validation error

---

### Unit 7: BrowserRecorder Accessors for Executor

**File**: `src/browser/recorder/index.ts` (modify)

Expose the internals needed by `CDPPortAdapter` without breaking encapsulation.

```typescript
// Add to BrowserRecorder class:

/** Get the CDP client (for step executor). Returns null if not recording. */
getCDPClient(): CDPClient | null {
	return this.cdpClient;
}

/** Get the primary tab session ID (for step executor). */
getPrimaryTabSession(): string | null {
	return this.getPrimaryTabSessionId();
}

/** Get the screenshot capture instance. */
getScreenshotCapture(): ScreenshotCapture | null {
	return this.screenshotCapture;
}

/** Get the session screenshot directory. */
getScreenshotDir(): string | null {
	if (!this.persistence) return null;
	const sessDir = this.persistence.getSessionDir(this.sessionId);
	return sessDir ? `${sessDir}/screenshots` : null;
}
```

**Implementation Notes**:
- These are simple getters exposing existing private fields
- Only the `CDPPortAdapter` should call these (via the daemon server's `buildStepExecutorAdapter()`)

**Acceptance Criteria**:
- [ ] `getCDPClient()` returns the active CDP client or null
- [ ] `getPrimaryTabSession()` returns the first tab session ID or null
- [ ] `getScreenshotCapture()` returns the instance or null
- [ ] `getScreenshotDir()` returns the screenshot directory path or null

---

### Unit 8: MCP Tool Registration

**File**: `src/mcp/tools/browser.ts` (modify)

Register the `chrome_run_steps` MCP tool that delegates to the daemon via `browser.run-steps`.

```typescript
// Add inside registerBrowserTools():

server.tool(
	"chrome_run_steps",
	"Execute a sequence of browser actions (navigate, click, fill, wait, etc.) in one call. " +
		"Requires an active recording session (chrome_start). " +
		"Each step is auto-marked and auto-screenshotted by default for investigation. " +
		"Use name + save to store a scenario for replay. Pass just name to replay a saved scenario.",
	{
		steps: z.array(StepSchema).optional().describe(
			"Ordered actions to execute. Each step has an 'action' field: " +
			"navigate, reload, click, fill, select, submit, type, hover, " +
			"scroll_to, scroll_by, wait, wait_for, wait_for_navigation, " +
			"wait_for_network_idle, screenshot, mark, evaluate"
		),
		name: z.string().optional().describe("Scenario name. Use with save=true to store, or alone to replay."),
		save: z.boolean().optional().describe("Save the steps as a named scenario for later replay"),
		capture: CaptureConfigSchema.optional().describe(
			"Capture config. screenshot: 'all' (default), 'none', 'on_error'. markers: true (default) or false."
		),
	},
	async ({ steps, name, save, capture }) => {
		return withDaemonClient(
			(client) => client.call<RunStepsResult>("browser.run-steps", { steps, name, save, capture }),
			(result) => renderStepResults(result),
			120_000, // 2 minute timeout for step sequences
		);
	},
);
```

**Implementation Notes**:
- Extended timeout of 120s (vs 30s default) since step sequences can take a while
- The tool description lists all action types so agents know what's available
- The tool delegates entirely to the daemon — no direct CDP from the MCP process

**Acceptance Criteria**:
- [ ] Tool is registered with name `chrome_run_steps`
- [ ] Tool description documents all action types
- [ ] Tool delegates to daemon via `browser.run-steps` RPC
- [ ] Timeout is 120 seconds
- [ ] Result is formatted via `renderStepResults()`

---

### Unit 9: StepExecutionError

**File**: `src/core/errors.ts` (modify)

Add a typed error for step execution failures.

```typescript
export class StepExecutionError extends KrometrailError {
	constructor(
		public readonly stepIndex: number,
		public readonly action: string,
		public readonly selector?: string,
		cause?: string,
	) {
		const loc = selector ? ` on "${selector}"` : "";
		super(
			`Step ${stepIndex} (${action}${loc}) failed: ${cause ?? "unknown error"}`,
			"STEP_EXECUTION_FAILED",
		);
		this.name = "StepExecutionError";
	}
}
```

**Acceptance Criteria**:
- [ ] Error includes step index, action, and optional selector in the message
- [ ] Code is `"STEP_EXECUTION_FAILED"`
- [ ] Extends `KrometrailError`

---

## Implementation Order

1. **Unit 9**: `StepExecutionError` — needed by all other units
2. **Unit 1**: Step schema definitions — foundation types used everywhere
3. **Unit 4**: Scenario store — simple, no dependencies
4. **Unit 5**: Step result renderer — simple, depends only on types
5. **Unit 2**: Step executor engine — core logic, depends on types
6. **Unit 3**: CDP port adapter — infrastructure adapter, depends on port interface
7. **Unit 7**: BrowserRecorder accessors — expose internals for adapter
8. **Unit 6**: Daemon RPC method — wires everything together
9. **Unit 8**: MCP tool registration — top-level entry point

---

## Testing

### Unit Tests: `tests/unit/browser/executor/`

**`step-schema.test.ts`**:
- Validate all 17 action types parse correctly
- Reject unknown action types
- Validate per-step screenshot override
- Validate `RunStepsParamsSchema` with steps, name, save, capture combinations

**`step-executor.test.ts`**:
- Use a mock `StepExecutorPort` implementation
- Test sequential execution of mixed action types
- Test stop-on-first-error behavior with partial results
- Test capture modes: `"all"`, `"none"`, `"on_error"`
- Test per-step `screenshot: false` override
- Test auto-marker labeling format
- Test `evaluate` step returns value in result

**`scenario-store.test.ts`**:
- Test save/get/list/delete/clear lifecycle

**`renderer.test.ts`**:
- Test all-success rendering format
- Test partial-failure rendering format
- Test evaluate return value rendering
- Test screenshot filename inclusion

### Integration Tests: `tests/integration/browser/`

**`step-executor.integration.test.ts`**:
- Use `setupBrowserTest()` harness with a real Chrome instance
- Execute a multi-step flow: navigate → fill → click → wait_for → screenshot
- Verify markers appear in the recording timeline
- Verify screenshots are captured on disk
- Verify the recording session has all expected events
- Test error case: wait_for timeout produces correct error result

### E2E Tests: `tests/e2e/browser/`

**`run-steps.e2e.test.ts`**:
- Full MCP tool call flow via daemon
- Call `chrome_start`, then `chrome_run_steps` with a multi-step scenario
- Call `chrome_stop` and verify `session_overview` reflects the step actions
- Test named scenario save + replay
- Test error messages when no recording is active

---

## Verification Checklist

```bash
# Type check
bun run build

# Unit tests
bun run test:unit -- --grep "step-executor\|step-schema\|scenario-store\|renderer"

# Integration tests (requires Chrome)
bun run test:integration -- --grep "step-executor"

# E2E tests (requires Chrome)
bun run test:e2e -- --grep "run-steps"

# Lint
bun run lint
```
