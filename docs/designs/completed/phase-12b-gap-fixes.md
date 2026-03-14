# Design: Phase 12b — Search Filters, WebSocket Detection, CLS Detection

## Overview

Three gaps identified in the v3 design assessment. All are self-contained fixes that don't change any public API shapes — they wire up existing declared interfaces to actual behavior.

1. **Search filters**: `urlPattern`, `consoleLevels`, `containsText` are declared in `SearchParams` but silently ignored by `search()`. Add `around_marker` to the MCP tool and implement all four.
2. **WebSocket error/close detection**: The normalizer only handles frame events (`Network.webSocketFrameSent/Received`), producing events with `data.direction`. The auto-detect rule checks `data.type === "error"` / `"close"`, which never matches. Fix by handling `Network.webSocketClosed` and `Network.webSocketCreated` CDP events.
3. **CLS detection**: `Performance.metrics` CDP event doesn't include CLS (that's a PerformanceObserver metric). Fix by injecting a PerformanceObserver via the `__BL__` mechanism already used for input tracking.

---

## Implementation Units

### Unit 1: Wire up search filters in QueryEngine

**File**: `src/browser/investigation/query-engine.ts`

The `SearchParams` interface already declares these fields (lines 299-306). The `search()` method (lines 89-110) ignores `urlPattern`, `consoleLevels`, and `containsText`. All three are post-filters on the result set — no database schema changes needed.

```typescript
// In search(), after the existing statusCodes filter (line 107), add:

// Post-filter by URL pattern (glob-style, applied to summary which contains the URL)
if (params.filters?.urlPattern) {
	const pattern = params.filters.urlPattern;
	const regex = new RegExp(pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"), "i");
	results = results.filter((e) => regex.test(e.summary));
}

// Post-filter by console levels (parsed from summary "[level] message")
if (params.filters?.consoleLevels && params.filters.consoleLevels.length > 0) {
	const levels = params.filters.consoleLevels;
	results = results.filter((e) => {
		if (e.type !== "console") return false;
		const match = e.summary.match(/^\[(\w+)\]/);
		return match ? levels.includes(match[1]) : false;
	});
}

// Post-filter by text content in summary
if (params.filters?.containsText) {
	const text = params.filters.containsText.toLowerCase();
	results = results.filter((e) => e.summary.toLowerCase().includes(text));
}
```

**Implementation Notes**:
- `urlPattern` uses the same glob-to-regex approach as the v3 design's `**/api/patients**` examples. `**` → `.*`, `*` → `[^/]*`.
- `consoleLevels` relies on the normalizer's `[level] message` summary format (see `event-normalizer.ts:145`).
- `containsText` is a case-insensitive substring match on the summary string.
- The FTS path (`params.query` branch, line 91) already handles semantic text search, so `containsText` only applies to the structured filter path. This is correct — `containsText` is for precise substring matches, while `query` is for FTS5 ranked search.
- Over-fetching then filtering is fine for the expected result sizes (max ~1000 events per session).

**Acceptance Criteria**:
- [ ] `search()` filters results by `urlPattern` when provided (glob match on summary)
- [ ] `search()` filters results by `consoleLevels` when provided (only console events with matching level)
- [ ] `search()` filters results by `containsText` when provided (case-insensitive substring on summary)
- [ ] Existing behavior unchanged when these filters are absent

---

### Unit 2: Add `around_marker` filter to session_search MCP tool and QueryEngine

**File**: `src/browser/investigation/query-engine.ts`

Add `aroundMarker` to `SearchParams.filters`:

```typescript
export interface SearchParams {
	query?: string;
	filters?: {
		eventTypes?: string[];
		statusCodes?: number[];
		urlPattern?: string;
		consoleLevels?: string[];
		timeRange?: { start: number; end: number };
		containsText?: string;
		aroundMarker?: string; // ← NEW: marker ID, implies ±120s time range
	};
	maxResults?: number;
}
```

In `search()`, resolve the marker to a time range before querying:

```typescript
search(sessionId: string, params: SearchParams): EventRow[] {
	// Resolve aroundMarker into a timeRange
	if (params.filters?.aroundMarker && !params.filters.timeRange) {
		const markers = this.db.queryMarkers(sessionId);
		const marker = markers.find((m) => m.id === params.filters!.aroundMarker);
		if (!marker) throw new Error(`Marker not found: ${params.filters.aroundMarker}`);
		params = {
			...params,
			filters: {
				...params.filters,
				timeRange: { start: marker.timestamp - 120_000, end: marker.timestamp + 30_000 },
			},
		};
	}

	// ... rest of existing search logic unchanged
}
```

**File**: `src/mcp/tools/browser.ts`

Add `around_marker` to the `session_search` tool's Zod schema (after `time_range`, ~line 93):

```typescript
around_marker: z.string().optional().describe("Center search around this marker ID (±120s before, +30s after)"),
```

Wire it through to `queryEngine.search()`:

```typescript
// In the async handler, add to the search call:
const results = queryEngine.search(session_id, {
	query,
	filters: {
		eventTypes: event_types,
		statusCodes: status_codes,
		timeRange: time_range ? { start: new Date(time_range.start).getTime(), end: new Date(time_range.end).getTime() } : undefined,
		aroundMarker: around_marker, // ← NEW
	},
	maxResults: max_results ?? 10,
});
```

**Implementation Notes**:
- The ±120s/+30s window matches `ReplayContextGenerator.getRelevantEvents()` which uses the same window for `aroundMarker`.
- `aroundMarker` is mutually exclusive with `timeRange` — if both are provided, `timeRange` takes precedence (the `if (!params.filters.timeRange)` guard handles this).

**Acceptance Criteria**:
- [ ] `search()` resolves `aroundMarker` to a time range centered on the marker (120s before, 30s after)
- [ ] `search()` throws if `aroundMarker` references a nonexistent marker
- [ ] `aroundMarker` does not override an explicitly provided `timeRange`
- [ ] MCP tool `session_search` accepts `around_marker` parameter and passes it through

---

### Unit 3: Handle WebSocket lifecycle events in normalizer

**File**: `src/browser/recorder/event-normalizer.ts`

Add cases to the `normalize()` switch for WebSocket lifecycle events:

```typescript
case "Network.webSocketCreated":
	return this.normalizeWebSocketLifecycle(params, tabId, "open");
case "Network.webSocketClosed":
	return this.normalizeWebSocketLifecycle(params, tabId, "close");
case "Network.webSocketHandshakeResponseReceived":
	return null; // Don't need to emit for this, webSocketCreated covers "open"
case "Network.loadingFailed": {
	// Check if this is a WebSocket failure
	const rid = params.requestId as string;
	if (this.pendingWebSockets.has(rid)) {
		this.pendingWebSockets.delete(rid);
		return this.buildEvent("websocket", tabId, `WS error: ${(params.errorText as string) ?? "unknown"}`, {
			type: "error",
			url: this.pendingWebSockets.get(rid) ?? "",
			requestId: rid,
			errorText: params.errorText,
		});
	}
	return this.normalizeNetworkFailed(params, tabId);
}
```

Wait — `Network.loadingFailed` already has a case in the switch. We need a different approach. WebSocket errors come through `Network.loadingFailed` when the WS connection fails, but we need to distinguish WS from HTTP. Let's track pending WebSocket connections:

```typescript
// New field on EventNormalizer:
private pendingWebSockets = new Set<string>(); // requestId set

// New method:
private normalizeWebSocketLifecycle(params: Record<string, unknown>, tabId: string, wsType: "open" | "close"): RecordedEvent {
	const requestId = params.requestId as string;
	const url = (params.url as string) ?? "";

	if (wsType === "open") {
		this.pendingWebSockets.add(requestId);
	} else {
		this.pendingWebSockets.delete(requestId);
	}

	return this.buildEvent("websocket", tabId, `WS ${wsType}: ${url}`, {
		type: wsType,
		url,
		requestId,
	});
}
```

Update `normalizeNetworkFailed()` to detect WebSocket failures:

```typescript
private normalizeNetworkFailed(params: Record<string, unknown>, tabId: string): RecordedEvent | null {
	const requestId = params.requestId as string;
	const errorText = (params.errorText as string) ?? "Unknown error";

	// Check if this is a WebSocket failure
	if (this.pendingWebSockets.has(requestId)) {
		const pending = this.pendingRequests.get(requestId);
		const url = pending?.url ?? "";
		this.pendingWebSockets.delete(requestId);
		this.pendingRequests.delete(requestId);
		return this.buildEvent("websocket", tabId, `WS error: ${url}: ${errorText}`, {
			type: "error",
			url,
			requestId,
			errorText,
		});
	}

	// ... existing HTTP failure logic unchanged
	const pending = this.pendingRequests.get(requestId);
	if (!pending) return null;
	// ... rest as-is
}
```

**File**: `src/browser/recorder/index.ts`

No changes needed — `Network` domain is already enabled (line 39), which includes WebSocket lifecycle events.

**File**: `src/browser/recorder/auto-detect.ts`

No changes needed — the existing rule (lines 100-107) already checks `event.data.type === "error" || event.data.type === "close"`, which now matches the data shape produced by the normalizer.

**Implementation Notes**:
- `Network.webSocketCreated` fires when a WS connection is initiated. Its params: `{ requestId, url, initiator }`.
- `Network.webSocketClosed` fires when a WS connection is closed. Its params: `{ requestId, timestamp }`. It does NOT include `url`, so we need to look it up from `pendingRequests` or store it in `pendingWebSockets`.
- Actually, we need to store the URL. Change `pendingWebSockets` from `Set<string>` to `Map<string, string>` (requestId → url):

```typescript
private pendingWebSockets = new Map<string, string>(); // requestId → url

private normalizeWebSocketLifecycle(params: Record<string, unknown>, tabId: string, wsType: "open" | "close"): RecordedEvent {
	const requestId = params.requestId as string;
	let url: string;

	if (wsType === "open") {
		url = (params.url as string) ?? "";
		this.pendingWebSockets.set(requestId, url);
	} else {
		url = this.pendingWebSockets.get(requestId) ?? "";
		this.pendingWebSockets.delete(requestId);
	}

	return this.buildEvent("websocket", tabId, `WS ${wsType}: ${url}`, {
		type: wsType,
		url,
		requestId,
	});
}
```

- For `normalizeNetworkFailed`, look up from `pendingWebSockets`:

```typescript
if (this.pendingWebSockets.has(requestId)) {
	const url = this.pendingWebSockets.get(requestId) ?? "";
	this.pendingWebSockets.delete(requestId);
	this.pendingRequests.delete(requestId);
	return this.buildEvent("websocket", tabId, `WS error: ${url}: ${errorText}`, {
		type: "error",
		url,
		requestId,
		errorText,
	});
}
```

**Acceptance Criteria**:
- [ ] `Network.webSocketCreated` produces a `websocket` event with `data.type = "open"`
- [ ] `Network.webSocketClosed` produces a `websocket` event with `data.type = "close"` and correct URL
- [ ] `Network.loadingFailed` for a WebSocket produces a `websocket` event with `data.type = "error"`
- [ ] Auto-detect rule for WebSocket error/close now fires correctly
- [ ] Existing WebSocket frame normalization (`SEND`/`RECV`) unchanged
- [ ] Existing HTTP `loadingFailed` behavior unchanged

---

### Unit 4: Inject CLS observer via `__BL__` mechanism

**File**: `src/browser/recorder/input-tracker.ts`

Extend the injection script to include a PerformanceObserver for layout-shift entries:

```typescript
// Append to the end of the IIFE in getInjectionScript(), before the closing `})();`:

  // CLS observation via PerformanceObserver
  if (typeof PerformanceObserver !== 'undefined') {
    var clsValue = 0;
    var clsReported = false;
    try {
      new PerformanceObserver(function(list) {
        for (var entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        if (clsValue > 0.1 && !clsReported) {
          clsReported = true;
          report('cls', { metric: 'CLS', value: clsValue });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  }
```

Add `"cls"` to the `InputEventData.type` union:

```typescript
interface InputEventData {
	type: "click" | "submit" | "change" | "marker" | "cls";
	// ... rest unchanged
	metric?: string;
}
```

Handle `cls` in `processInputEvent`:

```typescript
// In processInputEvent(), after the marker check (line 93):
if (parsed.type === "cls") {
	return this.buildEvent("performance", tabId, parsed.ts, `CLS: ${parsed.value}`, {
		metric: "CLS",
		value: typeof parsed.value === "string" ? Number.parseFloat(parsed.value) : parsed.value,
	});
}
```

Wait — `parsed.value` is currently typed as `string | undefined` in `InputEventData`. For the CLS case we pass a number via JSON.stringify in the report call. Since it goes through `JSON.stringify` → `JSON.parse`, it preserves the number type. But to be safe:

```typescript
interface InputEventData {
	type: "click" | "submit" | "change" | "marker" | "cls";
	ts: number;
	selector?: string;
	text?: string;
	tag?: string;
	action?: string;
	fields?: Record<string, string>;
	value?: string | number; // ← widen to support CLS numeric value
	label?: string;
	metric?: string;
}
```

**File**: `src/browser/recorder/auto-detect.ts`

The existing CLS rule (lines 91-98) already checks `event.data.metric === "CLS"` and `event.data.value > 0.25`. With the input tracker now producing performance events with `{ metric: "CLS", value: number }`, the rule will fire correctly.

No changes needed to auto-detect.ts.

**Implementation Notes**:
- The `layout-shift` PerformanceObserver API is supported in Chrome 77+ (we require Chrome 74+ per cdp-client.ts). All modern Chrome versions support it.
- `hadRecentInput` is checked to exclude input-driven shifts per the standard CLS definition.
- We report CLS once it crosses 0.1 (any non-trivial shift), which is well below the auto-detect threshold of 0.25. This gives the auto-detect rule room to fire, while not spamming events for zero-shift pages.
- The `clsReported` flag prevents multiple CLS events per page. CLS accumulates, so we report the first significant one and let the detection rule decide if it's above threshold.
- Actually, the design should report continuously (on each shift that changes the accumulated value), because CLS can grow over time. But to avoid spam, report at thresholds:

```typescript
  if (typeof PerformanceObserver !== 'undefined') {
    var clsValue = 0;
    var lastReported = 0;
    try {
      new PerformanceObserver(function(list) {
        for (var entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        // Report when CLS changes significantly (at least 0.05 delta)
        if (clsValue - lastReported >= 0.05) {
          lastReported = clsValue;
          report('cls', { metric: 'CLS', value: clsValue });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
  }
```

This emits a performance event each time CLS grows by 0.05+. The auto-detect rule fires when it crosses 0.25.

**Acceptance Criteria**:
- [ ] CLS PerformanceObserver is injected into every page via the existing injection mechanism
- [ ] CLS shifts are accumulated and reported as `performance` events with `data.metric = "CLS"` and `data.value = number`
- [ ] Reports only when CLS delta ≥ 0.05 since last report (no spam)
- [ ] Auto-detect rule for large CLS now fires when CLS > 0.25
- [ ] PerformanceObserver gracefully no-ops in browsers that don't support `layout-shift` type
- [ ] Existing input tracking (click, submit, change, marker) unchanged

---

## Implementation Order

1. **Unit 1** — Search filters (query-engine.ts only, pure logic)
2. **Unit 2** — `around_marker` in search (query-engine.ts + MCP tool, depends on understanding Unit 1's filter chain)
3. **Unit 3** — WebSocket lifecycle events (event-normalizer.ts, no dependencies on Units 1-2)
4. **Unit 4** — CLS observer injection (input-tracker.ts, no dependencies on Units 1-3)

Units 3 and 4 are independent and can be implemented in parallel with Units 1-2.

---

## Testing

### Unit Tests: `tests/unit/browser/query-engine-filters.test.ts`

New test file for search filter behavior. Uses the same `makeQueryEngine()` / `makeEventRow()` pattern from existing tests.

```typescript
describe("QueryEngine search filters", () => {
	describe("urlPattern", () => {
		it("filters events by glob pattern on summary", () => { /* summary containing "/api/patients" matches "**/api/patients**" */ });
		it("does not filter when urlPattern is absent", () => {});
		it("is case-insensitive", () => {});
	});
	describe("consoleLevels", () => {
		it("filters console events by parsed level", () => { /* summary "[error] msg" matches ["error"] */ });
		it("excludes non-console events", () => {});
	});
	describe("containsText", () => {
		it("filters by case-insensitive substring match on summary", () => {});
	});
	describe("aroundMarker", () => {
		it("resolves marker ID to ±120s/+30s time range", () => {});
		it("throws when marker not found", () => {});
		it("does not override explicit timeRange", () => {});
	});
});
```

Cannot use a real `QueryEngine` in unit tests (requires SQLite). Instead, test the filter logic directly. Two approaches:

**Option A (preferred)**: Extract the post-filter logic into a pure function `applyPostFilters(results: EventRow[], filters: SearchParams["filters"]): EventRow[]` and test that. This avoids needing to mock the database.

**Option B**: Keep tests at the integration level by constructing a real in-memory SQLite `BrowserDatabase`, inserting test events, and querying through `QueryEngine.search()`. This is heavier but tests the full path.

Go with **Option A** — extract `applyPostFilters` as a private method but make it testable by testing through `search()` with a mock database.

Actually, the simplest approach: the existing test pattern mocks `QueryEngine` entirely. For search filter tests, we need to test `QueryEngine.search()` itself, which calls `this.db.queryEvents()`. We can mock the database layer:

```typescript
function makeMockDb(events: EventRow[]): BrowserDatabase {
	return {
		queryEvents: () => events,
		searchFTS: () => events,
		queryMarkers: () => [],
		getSession: () => ({ /* ... */ }),
	} as unknown as BrowserDatabase;
}
```

Then construct a real `QueryEngine` with the mock database.

### Unit Tests: `tests/unit/browser/event-normalizer-ws.test.ts`

Add WebSocket lifecycle tests to existing normalizer test file (or create new one):

```typescript
describe("EventNormalizer WebSocket lifecycle", () => {
	it("normalizes webSocketCreated to websocket event with type='open'", () => {});
	it("normalizes webSocketClosed to websocket event with type='close' with correct URL", () => {});
	it("normalizes loadingFailed for WebSocket to websocket event with type='error'", () => {});
	it("still normalizes HTTP loadingFailed normally", () => {});
	it("existing frame normalization unchanged", () => {});
});
```

### Unit Tests: `tests/unit/browser/input-tracker-cls.test.ts`

```typescript
describe("InputTracker CLS processing", () => {
	it("processes cls event into performance RecordedEvent", () => {
		const tracker = new InputTracker();
		const event = tracker.processInputEvent(
			JSON.stringify({ type: "cls", ts: Date.now(), metric: "CLS", value: 0.32 }),
			"tab1"
		);
		expect(event).not.toBeNull();
		expect(event!.type).toBe("performance");
		expect(event!.data.metric).toBe("CLS");
		expect(event!.data.value).toBe(0.32);
	});

	it("getInjectionScript includes PerformanceObserver for layout-shift", () => {
		const tracker = new InputTracker();
		const script = tracker.getInjectionScript();
		expect(script).toContain("layout-shift");
		expect(script).toContain("PerformanceObserver");
	});
});
```

### Update existing tests: `tests/unit/browser/auto-detect-advanced.test.ts`

The existing WebSocket and CLS tests already test the rules in isolation with manually constructed events. They should still pass since the rules haven't changed. Add one integration-style test:

```typescript
it("fires WebSocket close rule for normalizer-produced close event", () => {
	// Construct event matching normalizer's new output shape
	const event = makeEvent("websocket", { type: "close", url: "wss://example.com/ws" });
	const markers = detector.check(event, []);
	expect(markers.some(m => m.label.includes("WebSocket close"))).toBe(true);
});
```

This test already exists and passes (line 142-146 of auto-detect-advanced.test.ts). The key is that the *normalizer* now actually produces events with this shape.

---

## Verification Checklist

```bash
bun run test:unit                    # All unit tests pass
bun run lint                         # No lint errors
bun run build                        # Compiles cleanly
```

Manual verification (requires Chrome):
- Start browser recorder, open a page with WebSocket connections, disconnect → verify WS close marker appears
- Open a page with layout shifts → verify CLS > 0.25 triggers auto-detect marker
- Use `session_search` with `around_marker` parameter → verify results centered on marker
- Use `session_search` with `url_pattern` filter → verify only matching URLs returned
