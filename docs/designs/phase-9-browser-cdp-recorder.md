# Design: Phase 9 — Browser Lens: CDP Recorder

## Overview

Phase 9 adds passive browser recording to Krometrail. A recorder daemon connects to Chrome via the Chrome DevTools Protocol (CDP), captures network, console, page lifecycle, and user input events into an in-memory rolling buffer, and persists evidence around user-placed markers. The human drives the browser; the system records everything.

This is the foundation for Browser Lens — all subsequent phases (storage, investigation tools, intelligence) build on the event stream this recorder produces.

**Key principle:** The recorder is a passive observer. It listens to CDP events but does not modify page behavior, inject automation, or intercept requests. The only exception is a minimal input tracker script injected once per page load to capture clicks, form submissions, and field changes.

**Reference:** `docs/browser-lens-v3-design.md` contains the full standalone vision. This phase doc covers integration into Krometrail.

---

## Architecture

Browser Lens lives as a parallel subsystem alongside the existing DAP debug infrastructure. It does NOT use the `DebugAdapter` interface — CDP recording is fundamentally different from DAP debugging (passive timeline vs interactive stepping).

```
src/
  browser/                    # New — all Browser Lens code
    recorder/
      cdp-client.ts           # WebSocket connection to Chrome CDP
      event-normalizer.ts     # CDP events → RecordedEvent
      rolling-buffer.ts       # In-memory ring buffer
      input-tracker.ts        # Injected script for click/submit/change
      auto-detect.ts          # Smart marker rules (4xx, exceptions)
      tab-manager.ts          # Track and attach to browser tabs
    types.ts                  # RecordedEvent, Marker, EventType, etc.
  cli/
    commands/
      browser.ts              # New: start, mark, sessions subcommands
  mcp/
    tools/
      debug.ts                # Existing (unchanged)
      browser.ts              # Phase 11 — not this phase
```

### What This Phase Delivers

- CDP connection to Chrome (WebSocket)
- Tab discovery and per-tab recording
- Event normalization for: network, console, page errors, page lifecycle
- User input tracking via minimal page injection
- Rolling buffer with configurable max age
- Marker placement: CLI command, keyboard hotkey, auto-detection
- `krometrail browser start` launcher (Chrome + recorder in one command)
- `krometrail browser mark` CLI command
- `krometrail browser status` to see active recordings

### What This Phase Does NOT Deliver

- Persistence to disk (Phase 10)
- Investigation MCP tools (Phase 11)
- Diff, replay context, test scaffolds (Phase 12)

The rolling buffer holds events in memory only. When a marker is placed, a `marker_placed` event is emitted that Phase 10 will hook into for persistence. In this phase, markers annotate the buffer but don't trigger disk writes.

---

## Implementation Units

### Unit 1: CDP Client

**File**: `src/browser/recorder/cdp-client.ts`

WebSocket client that connects to Chrome's CDP endpoint. Unlike the DAP client (`src/core/dap-client.ts`), this manages a single browser-level connection multiplexed across tabs.

```typescript
import { EventEmitter } from "node:events";

export interface CDPClientOptions {
	/** Chrome CDP WebSocket URL, e.g. ws://localhost:9222/json/version */
	browserWsUrl: string;
	/** Reconnect on disconnect. Default: true */
	autoReconnect: boolean;
	/** Max reconnect attempts. Default: 10 */
	maxReconnectAttempts: number;
	/** Reconnect delay in ms. Default: 1000 */
	reconnectDelayMs: number;
}

export class CDPClient extends EventEmitter {
	private ws: WebSocket | null = null;
	private requestId = 0;
	private pending = new Map<number, { resolve: Function; reject: Function }>();
	private connected = false;

	constructor(private options: CDPClientOptions) {
		super();
	}

	/** Connect to the browser's CDP WebSocket endpoint. */
	async connect(): Promise<void>;

	/** Send a CDP command and wait for the response. */
	async send(method: string, params?: Record<string, unknown>): Promise<unknown>;

	/** Subscribe to a CDP domain (e.g., "Network.enable"). */
	async enableDomain(domain: string, params?: Record<string, unknown>): Promise<void>;

	/** Create a session for a specific target (tab). */
	async attachToTarget(targetId: string): Promise<string>; // returns sessionId

	/** Send a command to a specific target session. */
	async sendToTarget(sessionId: string, method: string, params?: Record<string, unknown>): Promise<unknown>;

	/** Disconnect and clean up. */
	async disconnect(): Promise<void>;
}
```

**Connection flow:**

1. Fetch `http://localhost:{port}/json/version` to get the browser WebSocket URL
2. Connect via WebSocket
3. Enable `Target` domain on the browser connection for tab discovery
4. For each tab to record, call `Target.attachToTarget` to get a session ID
5. Enable CDP domains (Network, Runtime, Page, Performance) on each tab session

**Reconnection:**

Chrome can restart or tabs can crash. The client:
- Detects WebSocket close events
- Waits `reconnectDelayMs`, then attempts to reconnect
- Re-enables domain subscriptions after reconnection
- Emits `"reconnected"` event so the recorder can re-attach to tabs
- Gives up after `maxReconnectAttempts` and emits `"disconnected"`

**Why not extend DAPClient:**

The DAP client uses Content-Length framed messages over TCP/stdin. CDP uses JSON-RPC over WebSocket with session multiplexing. The protocols are different enough that sharing code would create awkward abstractions. Both are ~150 lines of focused WebSocket/stream handling.

**Tests:** Unit tests with a mock WebSocket server. Test connection, reconnection, command/response correlation, session multiplexing, timeout handling.

---

### Unit 2: Tab Manager

**File**: `src/browser/recorder/tab-manager.ts`

Tracks browser tabs and manages which ones are being recorded.

```typescript
export interface TabInfo {
	targetId: string;
	sessionId: string | null; // CDP session ID once attached
	url: string;
	title: string;
	recording: boolean;
}

export class TabManager {
	private tabs = new Map<string, TabInfo>();

	constructor(private cdpClient: CDPClient) {}

	/** Discover all page targets. */
	async discoverTabs(): Promise<TabInfo[]>;

	/** Start recording a specific tab. Returns the CDP session ID. */
	async startRecording(targetId: string): Promise<string>;

	/** Stop recording a specific tab. */
	async stopRecording(targetId: string): Promise<void>;

	/** Handle new tabs appearing. */
	private onTargetCreated(target: CDP.Target.TargetInfo): void;

	/** Handle tabs closing. */
	private onTargetDestroyed(targetId: string): void;

	/** Handle tab URL changes. */
	private onTargetInfoChanged(target: CDP.Target.TargetInfo): void;
}
```

**Tab discovery:**

1. On connect, call `Target.getTargets()` to list existing page targets
2. Subscribe to `Target.targetCreated`, `Target.targetDestroyed`, `Target.targetInfoChanged`
3. Filter to `type === "page"` (ignore service workers, extensions, etc.)

**Recording scope:**

By default, record the tab that was active when `browser start` was called. The user can specify `--all-tabs` to record everything, or `--tab <url-pattern>` to filter.

**Tests:** Unit tests with mock CDP responses. Test tab discovery, new tab handling, tab close cleanup.

---

### Unit 3: Event Normalization Pipeline

**File**: `src/browser/recorder/event-normalizer.ts`

Transforms raw CDP events into the unified `RecordedEvent` format.

**File**: `src/browser/types.ts`

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
	| "marker";

export interface RecordedEvent {
	id: string;                    // UUID
	timestamp: number;             // Unix ms
	type: EventType;
	tabId: string;                 // CDP target ID
	summary: string;               // Human-readable one-liner for search/overview
	data: Record<string, unknown>; // Type-specific payload
}

export interface Marker {
	id: string;
	timestamp: number;
	label?: string;
	autoDetected: boolean;
	severity?: "low" | "medium" | "high";
}

export interface BrowserSessionInfo {
	id: string;
	startedAt: number;
	tabs: Array<{ targetId: string; url: string; title: string }>;
	eventCount: number;
	markerCount: number;
	bufferAgeMs: number;           // Age of oldest event in buffer
}
```

**CDP domain → RecordedEvent mapping:**

| CDP Event | EventType | Summary Format |
|---|---|---|
| `Network.requestWillBeSent` | `network_request` | `GET https://api.example.com/users` |
| `Network.responseReceived` | `network_response` | `200 GET /users (143ms)` |
| `Network.loadingFailed` | `network_response` | `FAILED GET /users: net::ERR_CONNECTION_REFUSED` |
| `Network.webSocketFrameSent` | `websocket` | `WS SEND: {"type":"ping"}` |
| `Network.webSocketFrameReceived` | `websocket` | `WS RECV: {"type":"pong"}` |
| `Runtime.consoleAPICalled` | `console` | `[error] TypeError: Cannot read property 'id' of null` |
| `Runtime.exceptionThrown` | `page_error` | `Uncaught TypeError: Cannot read property 'id' of null at app.js:42` |
| `Page.frameNavigated` | `navigation` | `Navigated to https://app.example.com/dashboard` |
| `Page.loadEventFired` | `navigation` | `Page loaded (DOMContentLoaded)` |
| `Performance.metrics` | `performance` | `LCP: 2.3s, CLS: 0.12` |

```typescript
export class EventNormalizer {
	/** Process a raw CDP event and return a RecordedEvent, or null to skip. */
	normalize(method: string, params: Record<string, unknown>, tabId: string): RecordedEvent | null;

	/** Correlate network requests with responses (requestId tracking). */
	private correlateNetwork(requestId: string, event: RecordedEvent): void;
}
```

**Network correlation:**

CDP fires `requestWillBeSent` and `responseReceived` as separate events with a shared `requestId`. The normalizer:
1. On `requestWillBeSent`: create a `network_request` event, store requestId → event mapping
2. On `responseReceived`: create a `network_response` event, link to the request, compute duration
3. On `loadingFinished`: mark the response as complete (body available for Phase 10 extraction)
4. On `loadingFailed`: create a `network_response` event with error details

**Filtering:**

Not every CDP event is worth recording. Skip:
- `Network.dataReceived` (too granular, use `loadingFinished` instead)
- Internal Chrome extension requests (filter by URL pattern `chrome-extension://`)
- `Runtime.consoleAPICalled` with `__BL__` prefix (these are input tracker events, processed separately)

**Tests:** Unit tests with captured CDP event payloads. Test each mapping, network correlation, filtering.

---

### Unit 4: User Input Tracker

**File**: `src/browser/recorder/input-tracker.ts`

Captures user interactions (clicks, form submissions, field changes) that CDP doesn't expose natively.

**Approach:** Inject a minimal script via `Page.addScriptToEvaluateOnNewDocument` that listens for DOM events and reports them back via `console.debug('__BL__', JSON.stringify(event))`. The recorder filters these from the `Runtime.consoleAPICalled` stream and processes them as `user_input` events.

```typescript
export class InputTracker {
	/** Get the injection script source. */
	getInjectionScript(): string;

	/** Process a __BL__ prefixed console message into a RecordedEvent. */
	processInputEvent(data: string, tabId: string): RecordedEvent | null;
}
```

**Injected script:**

```javascript
(function() {
  function sel(el) {
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    return el.tagName.toLowerCase();
  }

  function report(type, detail) {
    try {
      console.debug('__BL__', JSON.stringify({ type: type, ts: Date.now(), ...detail }));
    } catch {}
  }

  document.addEventListener('click', function(e) {
    var t = e.target.closest('[id],[name],[data-testid],[role="button"],a,button,input,select,label');
    if (!t) return;
    report('click', { selector: sel(t), text: (t.textContent || '').slice(0, 80), tag: t.tagName });
  }, true);

  document.addEventListener('submit', function(e) {
    var form = e.target;
    var fields = {};
    var inputs = form.querySelectorAll('input,select,textarea');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var name = inp.name || inp.id || sel(inp);
      fields[name] = inp.type === 'password' ? '[MASKED]' : (inp.value || '').slice(0, 200);
    }
    report('submit', { selector: sel(form), action: form.action, fields: fields });
  }, true);

  document.addEventListener('change', function(e) {
    var t = e.target;
    report('change', {
      selector: sel(t),
      value: t.type === 'password' ? '[MASKED]' : (t.value || '').slice(0, 200),
      tag: t.tagName
    });
  }, true);
})();
```

**Why console.debug instead of Runtime.evaluate polling:**

- No separate polling mechanism needed — piggybacks on `Runtime.consoleAPICalled` which is already captured
- The recorder strips `__BL__` prefixed messages from the normal console output
- Simpler, fewer moving parts, no timing issues with evaluate callbacks
- `console.debug` is the lowest severity, unlikely to conflict with app logging

**Privacy:**

- Password field values are always masked (`[MASKED]`)
- Field values are truncated to 200 characters
- Only captures elements with identifiable attributes (id, name, data-testid, semantic tags)

**Tests:** Unit tests for selector generation, event processing, password masking.

---

### Unit 5: Rolling Buffer

**File**: `src/browser/recorder/rolling-buffer.ts`

In-memory ring buffer that holds recent events. Events age out after a configurable max age unless they're near a marker.

```typescript
import { z } from "zod";

export const BufferConfigSchema = z.object({
	/** Max age of events in buffer, in ms. Default: 30 minutes. */
	maxAgeMs: z.number().default(30 * 60 * 1000),
	/** Seconds of context to preserve around markers. Default: 120. */
	markerPaddingMs: z.number().default(120 * 1000),
	/** Max events in buffer (memory safety). Default: 100_000. */
	maxEvents: z.number().default(100_000),
});

export type BufferConfig = z.infer<typeof BufferConfigSchema>;

export class RollingBuffer {
	private events: RecordedEvent[] = [];
	private markers: Marker[] = [];

	constructor(private config: BufferConfig) {}

	/** Add an event to the buffer. */
	push(event: RecordedEvent): void {
		this.events.push(event);
		this.evict();
	}

	/** Place a marker at the current time. */
	placeMarker(label?: string, autoDetected = false, severity?: "low" | "medium" | "high"): Marker;

	/** Get all events within a time range. */
	getEvents(start: number, end: number): RecordedEvent[];

	/** Get all events within the padding window of a marker. */
	getEventsAroundMarker(markerId: string): RecordedEvent[];

	/** Get all markers. */
	getMarkers(): Marker[];

	/** Get buffer stats. */
	getStats(): { eventCount: number; markerCount: number; oldestTimestamp: number; newestTimestamp: number };

	/** Evict old events that aren't near any marker. */
	private evict(): void {
		const cutoff = Date.now() - this.config.maxAgeMs;

		this.events = this.events.filter((e) => {
			// Keep if within max age
			if (e.timestamp >= cutoff) return true;
			// Keep if within padding of any marker
			return this.markers.some(
				(m) => Math.abs(e.timestamp - m.timestamp) <= this.config.markerPaddingMs,
			);
		});

		// Also enforce max events (drop oldest first)
		while (this.events.length > this.config.maxEvents) {
			this.events.shift();
		}
	}
}
```

**Memory management:**

- `maxEvents` prevents unbounded memory growth for high-traffic pages
- `maxAgeMs` evicts old events (default 30 minutes)
- Events near markers are kept longer (marker padding)
- A typical web app generates ~1-5 events/second → ~9,000 events in 30 minutes → well within the 100K default limit

**Marker-aware eviction:**

When a marker is placed, events within ±`markerPaddingMs` are protected from eviction. The marker's "future window" means events arriving in the next `markerPaddingMs` are also protected. This ensures retroactive investigation always has context.

**Tests:** Unit tests for eviction logic, marker protection, max events enforcement, time range queries.

---

### Unit 6: Marker System

**File**: `src/browser/recorder/auto-detect.ts`

Auto-detection rules that place markers when anomalies are observed.

```typescript
export interface DetectionRule {
	/** Which event types trigger this rule. */
	eventTypes: EventType[];
	/** Condition to check. Return true to place a marker. */
	condition: (event: RecordedEvent, recentEvents: RecordedEvent[]) => boolean;
	/** Label for the auto-placed marker. */
	label: (event: RecordedEvent) => string;
	/** Severity of the detected anomaly. */
	severity: "low" | "medium" | "high";
	/** Cooldown in ms — don't fire again within this window. Default: 5000. */
	cooldownMs?: number;
}

export const DEFAULT_DETECTION_RULES: DetectionRule[] = [
	// HTTP 4xx/5xx responses
	{
		eventTypes: ["network_response"],
		condition: (e) => {
			const status = e.data.status as number;
			return status >= 400;
		},
		label: (e) => `HTTP ${e.data.status} on ${e.data.method} ${e.data.url}`,
		severity: "medium",
		cooldownMs: 2000,
	},

	// Console errors
	{
		eventTypes: ["console"],
		condition: (e) => e.data.level === "error",
		label: (e) => `Console error: ${e.summary.slice(0, 100)}`,
		severity: "medium",
		cooldownMs: 2000,
	},

	// Unhandled exceptions
	{
		eventTypes: ["page_error"],
		condition: () => true,
		label: (e) => `Uncaught: ${e.summary.slice(0, 100)}`,
		severity: "high",
	},

	// Slow network responses (> 5 seconds)
	{
		eventTypes: ["network_response"],
		condition: (e) => (e.data.durationMs as number) > 5000,
		label: (e) => `Slow response: ${e.data.url} (${e.data.durationMs}ms)`,
		severity: "low",
		cooldownMs: 10000,
	},

	// HTTP 5xx specifically get high severity
	{
		eventTypes: ["network_response"],
		condition: (e) => (e.data.status as number) >= 500,
		label: (e) => `Server error: HTTP ${e.data.status} on ${e.data.method} ${e.data.url}`,
		severity: "high",
		cooldownMs: 2000,
	},
];

export class AutoDetector {
	private lastFired = new Map<number, number>(); // rule index → timestamp

	constructor(private rules: DetectionRule[] = DEFAULT_DETECTION_RULES) {}

	/** Check an event against all rules. Returns markers to place. */
	check(event: RecordedEvent, recentEvents: RecordedEvent[]): Array<{ label: string; severity: "low" | "medium" | "high" }>;
}
```

**Marker placement sources:**

1. **CLI command:** `krometrail browser mark "form failed"` — sends a request to the recorder daemon via the existing Unix socket
2. **Keyboard hotkey:** The injected input tracker script also listens for `Ctrl+Shift+M`. On trigger, it sends a `__BL__` event with `type: "marker"`, which the recorder processes as a marker placement
3. **Auto-detection:** The `AutoDetector` checks every incoming event. When a rule fires, it places an auto-detected marker

**Cooldown logic:**

Auto-detection rules have a cooldown to prevent marker spam. A burst of 422 responses (e.g., rapid form resubmissions) produces one marker, not ten. The cooldown is per-rule, not global.

**Tests:** Unit tests for each detection rule, cooldown enforcement, hotkey event processing.

---

### Unit 7: Browser Launch Wrapper & CLI

**File**: `src/cli/commands/browser.ts`

CLI commands for browser recording.

```typescript
// krometrail browser start [--port 9222] [--profile "testing"] [--attach] [--all-tabs]
// krometrail browser mark ["label"]
// krometrail browser status
// krometrail browser stop
```

**`browser start` flow:**

1. Check if Chrome is already running with `--remote-debugging-port`
   - If `--attach` flag: connect to existing Chrome
   - If not: launch Chrome with `--remote-debugging-port={port}` and a separate user data dir
2. Start the CDP client and connect
3. Discover tabs, start recording the active tab (or all tabs with `--all-tabs`)
4. Start the auto-detector
5. Print status: `Recording: Chrome tab "Dashboard | Acme App" (https://app.acme.com/dashboard)`

**Chrome launch:**

```typescript
function launchChrome(port: number, profile?: string): ChildProcess {
	const chromePaths = [
		"google-chrome",
		"google-chrome-stable",
		"chromium",
		"chromium-browser",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	];

	const args = [
		`--remote-debugging-port=${port}`,
		"--no-first-run",
		"--no-default-browser-check",
	];

	if (profile) {
		args.push(`--user-data-dir=${resolve(homedir(), ".krometrail", "chrome-profiles", profile)}`);
	}

	// Find first available Chrome binary
	for (const chromePath of chromePaths) {
		try {
			return spawn(chromePath, args, { detached: true, stdio: "ignore" });
		} catch {
			continue;
		}
	}

	throw new Error("Chrome not found. Install Chrome or specify --attach to connect to an existing instance.");
}
```

**`browser mark` flow:**

1. Connect to the recorder daemon (same Unix socket as debug commands)
2. Send a `browser.mark` RPC call with the label
3. Daemon places a marker in the rolling buffer
4. Print: `Marker placed: "form failed" at 14:35:22`

**`browser status` flow:**

1. Query daemon for browser session info
2. Print: recording status, tab URL, event count, marker count, buffer age

**`browser stop` flow:**

1. Stop all tab recordings
2. Disconnect CDP client
3. Optionally close Chrome (with `--close-browser` flag, default: leave Chrome running)

**Daemon integration:**

The browser recorder runs inside the existing Krometrail daemon process. New RPC methods:

```typescript
// In daemon protocol:
"browser.start": { params: BrowserStartParams; result: BrowserSessionInfo };
"browser.mark": { params: { label?: string }; result: Marker };
"browser.status": { params: {}; result: BrowserSessionInfo | null };
"browser.stop": { params: { closeBrowser?: boolean }; result: void };
```

**Tests:** Integration tests that launch Chrome with CDP, connect, verify event capture. E2E tests for CLI commands.

---

### Unit 8: Recorder Orchestrator

**File**: `src/browser/recorder/index.ts`

Ties all the pieces together. The orchestrator is the main entry point that the daemon instantiates.

```typescript
export class BrowserRecorder {
	private cdpClient: CDPClient;
	private tabManager: TabManager;
	private normalizer: EventNormalizer;
	private inputTracker: InputTracker;
	private buffer: RollingBuffer;
	private autoDetector: AutoDetector;
	private recording = false;

	constructor(private config: BrowserRecorderConfig) {
		this.cdpClient = new CDPClient(config.cdp);
		this.tabManager = new TabManager(this.cdpClient);
		this.normalizer = new EventNormalizer();
		this.inputTracker = new InputTracker();
		this.buffer = new RollingBuffer(config.buffer);
		this.autoDetector = new AutoDetector(config.detectionRules);
	}

	/** Connect to Chrome and start recording. */
	async start(options: { allTabs?: boolean; tabFilter?: string }): Promise<BrowserSessionInfo>;

	/** Place a marker. */
	placeMarker(label?: string): Marker;

	/** Get current session info. */
	getSessionInfo(): BrowserSessionInfo | null;

	/** Stop recording and disconnect. */
	async stop(): Promise<void>;

	/** Internal: handle a CDP event from any tab. */
	private onCDPEvent(sessionId: string, method: string, params: Record<string, unknown>): void {
		const tabId = this.tabManager.getTabIdForSession(sessionId);
		if (!tabId) return;

		// Check for input tracker events
		if (method === "Runtime.consoleAPICalled") {
			const args = params.args as Array<{ value?: string }>;
			if (args[0]?.value === "__BL__" && args[1]?.value) {
				const inputEvent = this.inputTracker.processInputEvent(args[1].value, tabId);
				if (inputEvent) {
					this.buffer.push(inputEvent);
					this.checkAutoDetect(inputEvent);
				}
				return; // Don't add to normal console events
			}
		}

		// Normalize the CDP event
		const event = this.normalizer.normalize(method, params, tabId);
		if (!event) return;

		// Add to buffer
		this.buffer.push(event);

		// Check auto-detection rules
		this.checkAutoDetect(event);
	}

	private checkAutoDetect(event: RecordedEvent): void {
		const recentEvents = this.buffer.getEvents(
			event.timestamp - 5000,
			event.timestamp,
		);
		const markers = this.autoDetector.check(event, recentEvents);
		for (const m of markers) {
			this.buffer.placeMarker(m.label, true, m.severity);
		}
	}
}
```

**CDP domain enablement per tab:**

When a tab starts recording, enable these CDP domains:

```typescript
const DOMAINS_TO_ENABLE = [
	{ domain: "Network", params: { maxPostDataSize: 65536 } },
	{ domain: "Runtime" },
	{ domain: "Page" },
	{ domain: "Performance", params: { timeDomain: "timeTicks" } },
];
```

And inject the input tracker script:

```typescript
await cdpClient.sendToTarget(sessionId, "Page.addScriptToEvaluateOnNewDocument", {
	source: this.inputTracker.getInjectionScript(),
});
```

**Event subscription:**

The CDP client emits events with their session ID. The orchestrator routes them:

```typescript
this.cdpClient.on("event", (sessionId, method, params) => {
	this.onCDPEvent(sessionId, method, params);
});
```

**Tests:** Integration test that connects to a real Chrome instance, loads a page, verifies events are captured in the buffer. Test with a simple HTTP server fixture.

---

## Testing

### Test Fixtures

#### `tests/fixtures/browser/simple-page/`

A minimal web app for browser recording tests:

```
tests/fixtures/browser/simple-page/
  index.html      # Form with inputs, submit button
  app.js          # Simple client-side logic
  server.js       # Bun HTTP server that serves the page + API endpoint
```

The server provides:
- `GET /` — serves the HTML page
- `POST /api/submit` — accepts form data, returns 200 or 422 based on validation
- `GET /api/data` — returns JSON data (for network capture testing)

#### `tests/helpers/browser-check.ts`

```typescript
/** Check if Chrome is available for browser tests. */
export async function isChromeAvailable(): Promise<boolean>;

/** Launch Chrome with CDP for testing and return the CDP port. */
export async function launchTestChrome(): Promise<{ port: number; cleanup: () => Promise<void> }>;
```

### Unit Tests

#### `tests/unit/browser/rolling-buffer.test.ts`

- Events are stored and retrievable by time range
- Events older than maxAge are evicted
- Events near markers are protected from eviction
- Marker's future window protects incoming events
- maxEvents limit enforced (oldest dropped first)
- Multiple markers create overlapping protection windows

#### `tests/unit/browser/event-normalizer.test.ts`

- Each CDP event type maps to correct RecordedEvent
- Network request/response correlation by requestId
- Console levels mapped correctly
- Chrome extension requests filtered out
- `__BL__` prefixed messages filtered out
- Summary format is readable and searchable

#### `tests/unit/browser/auto-detect.test.ts`

- HTTP 4xx triggers medium severity marker
- HTTP 5xx triggers high severity marker
- Console error triggers medium severity marker
- Unhandled exception triggers high severity marker
- Slow response triggers low severity marker
- Cooldown prevents rapid re-firing of same rule
- Multiple rules can fire on same event

#### `tests/unit/browser/input-tracker.test.ts`

- Click events produce correct selector and text
- Form submit captures all field values
- Password fields are masked
- Change events capture new value
- Selector generation prioritizes id > data-testid > name > tag

### Integration Tests

#### `tests/integration/browser/recorder.test.ts`

```typescript
describe.skipIf(!isChromeAvailable())("Browser recorder", () => {
	it("connects to Chrome CDP and discovers tabs");
	it("captures network requests and responses");
	it("captures console.log and console.error");
	it("captures page navigation events");
	it("captures user click events via input tracker");
	it("captures form submission with field values");
	it("places manual markers via placeMarker()");
	it("auto-detects 4xx responses and places markers");
	it("auto-detects unhandled exceptions and places markers");
	it("rolling buffer evicts old events");
	it("rolling buffer preserves events near markers");
	it("reconnects after Chrome tab crash");
});
```

These tests use the `simple-page` fixture, launching a test Chrome instance and a local HTTP server.

---

## Verification Checklist

```bash
# Lint
bun run lint

# Unit tests
bun run test tests/unit/browser/

# Integration tests (needs Chrome installed)
bun run test tests/integration/browser/

# Manual verification
krometrail browser start
# Browse to any page, click around, submit a form
krometrail browser status    # Should show event count increasing
krometrail browser mark "test marker"
krometrail browser status    # Should show 1 marker
krometrail browser stop
```

**Done when:** The recorder connects to Chrome, captures network/console/input events into the rolling buffer, places markers (manual + auto-detected), and the CLI commands work end-to-end.
