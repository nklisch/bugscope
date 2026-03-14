# Browser Lens v3 — Design Document

*Record. Mark. Investigate. Fix.*

**Status:** Draft  
**Paradigm shift:** Agent doesn't drive the browser. Human drives, agent investigates the recording.  
**Stack:** Bun + TypeScript + Chrome DevTools Protocol  
**Interfaces:** MCP (stdio + HTTP/SSE) + CLI  
**No Chrome extension.** Pure CDP listener — zero browser modification beyond a minimal input tracker.

---

## The Insight

Every existing browser automation MCP — Microsoft's, Playwriter, Stagehand — assumes the same model: **the agent controls the browser.** The agent clicks, fills, navigates, observes. This is expensive (tokens per action), fragile (bot detection, auth loops), and fundamentally backwards for the most common real-world use case:

> *"Something went wrong while I was using the app. Help me figure out what happened."*

The user already knows how to use their app. They don't need an AI to click buttons for them. What they need is an AI that can **watch what they did, understand the full context, and help them diagnose, reproduce, or fix the problem.**

This is the DVR model: **the human drives, the system records everything, the agent scrubs through the tape.**

### Why This Is Better

| | Agent-drives-browser | Human-drives, agent-investigates |
|---|---|---|
| Token cost per session | High (observe + act per step) | Near zero during recording, pay only for investigation |
| Auth / bot detection | Constant problem | Non-issue — it's the user's real browser |
| Session state | Fragile, must be managed | Natural — it's the user's real session |
| Context richness | Limited to what agent requests | Everything captured: DOM, network, console, screenshots |
| User trust | "What is this AI doing in my browser?" | "I'm in control, AI helps after the fact" |
| Debugging value | Agent can't easily reproduce user issues | Agent has the full evidence trail |
| Latency | Blocked on LLM round-trips during browsing | Zero latency — recording is passive |

### Lineage

The investigation tools use the same token-budgeted viewport concept from Krometrail. Instead of viewing live page state, the agent views recorded session state at a specific point in time. The viewport engine, focus strategies, and token budgeting all carry over — just applied to a timeline of events rather than a live page.

---

## How It Works

### The User's Experience

```
1. User starts Browser Lens (`browser-lens start` launches Chrome + daemon)
2. Daemon records continuously in a rolling buffer
3. User browses normally — logs into their app, navigates, fills forms, 
   encounters a bug, sees weird behavior
4. User hits "Mark" at the moment something goes wrong 
   (or retroactively: "Mark 30 seconds ago")
5. User opens Claude / their coding agent and says:
   "The form submission failed silently. Check my browser session 
    around the mark I just placed."
6. Agent uses Browser Lens MCP tools to search the recorded session:
   - Finds the network request that returned a 422
   - Reads the response body showing validation errors
   - Sees the console error that fired
   - Checks the form state at the moment of submission
   - Compares the DOM before and after the failed submit
7. Agent reports: "The API returned a 422 because the phone field 
   was sending the format (555) 123-4567 but the API expects 
   5551234567. The frontend validation passed because it accepts 
   both formats, but the backend doesn't."
```

No agent-driven browser automation. No token burn during browsing. The cost is entirely in the investigation phase, where the agent is doing high-value analytical work.

### The Recording

The daemon captures a continuous structured log of everything happening in the browser:

```typescript
interface SessionRecording {
  id: string;
  startedAt: string;           // ISO timestamp
  url: string;                 // Starting URL
  
  // The timeline — ordered sequence of events
  events: RecordedEvent[];
  
  // User-placed markers
  markers: Marker[];
  
  // Metadata
  browser: { name: string; version: string };
  viewport: { width: number; height: number };
}

interface RecordedEvent {
  id: string;
  timestamp: string;           // Millisecond precision
  type: EventType;
  data: EventData;             // Type-specific payload
}

type EventType = 
  | "navigation"               // URL change, pushState, replaceState
  | "network_request"          // Fetch/XHR outgoing
  | "network_response"         // Response received (status, headers, body)
  | "console"                  // console.log/warn/error/info
  | "dom_mutation"             // Meaningful DOM changes (not every reflow)
  | "user_input"               // Click, keystroke, scroll, form input
  | "page_error"               // Uncaught exceptions, unhandled rejections
  | "storage_change"           // localStorage/sessionStorage/cookie changes
  | "form_state"               // Periodic snapshots of form field values
  | "screenshot"               // Periodic visual snapshots (configurable interval)
  | "performance"              // Long tasks, layout shifts, resource timing
  | "websocket"                // WS messages sent/received
  | "marker";                  // User-placed investigation marker

interface Marker {
  id: string;
  timestamp: string;
  label?: string;              // Optional user annotation
  autoDetected?: boolean;      // True if system detected an anomaly
}
```

### What Gets Captured (and What Doesn't)

**Captured:**
- Every network request and response (URL, method, status, headers, body — with configurable body size limits)
- Console output (all levels)
- DOM mutations (debounced, meaningful changes — not every React re-render)
- User interactions (clicks, form inputs, navigation — not mouse movement pixel data)
- Page errors and unhandled exceptions
- Storage changes (localStorage, sessionStorage, cookies)
- Form state snapshots (periodic + on submit attempts)
- Periodic screenshots (configurable: every 5s, every navigation, on markers)
- WebSocket messages
- Performance entries (long tasks, layout shifts, resource timing)

**Not captured by default (opt-in):**
- Raw mouse movement coordinates (high volume, rarely useful)
- Every DOM mutation (React re-renders would be overwhelming)
- Full video recording (too much data — periodic screenshots are usually sufficient)
- Sensitive field values (password fields are masked unless explicitly opted in)

**Never captured:**
- Cross-origin iframe content (can't access it)
- Content from other tabs (scoped to recorded tab)
- System-level data outside the browser

### Storage

Recordings persist only around markers. The rolling buffer handles the rest in memory. Persisted data uses JSONL for raw events and SQLite for queryable index.

```
~/.browser-lens/recordings/
├── sessions.db                # SQLite — master index of all sessions + events
├── 2026-03-07_14-30-22_acme-dashboard/
│   ├── events/
│   │   ├── 0000-0999.jsonl   # Raw events chunked by sequence number
│   │   ├── 1000-1999.jsonl
│   │   └── ...
│   ├── network/
│   │   ├── req_001_body.json  # Large request/response bodies stored separately
│   │   ├── res_001_body.json
│   │   └── ...
│   └── screenshots/
│       ├── 1709826622000.png  # Timestamp-named screenshots
│       └── ...
```

**SQLite schema (investigation queries):**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT,
  tab_url TEXT,
  event_count INTEGER,
  marker_count INTEGER,
  error_count INTEGER
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  timestamp INTEGER,           -- Unix ms for fast range queries
  type TEXT,                   -- EventType enum value
  summary TEXT,                -- Human-readable one-liner
  detail_ref TEXT,             -- Path to JSONL chunk + offset for full data
  UNIQUE(session_id, timestamp, id)
);

CREATE TABLE markers (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  timestamp INTEGER,
  label TEXT,
  auto_detected BOOLEAN,
  severity TEXT
);

-- Indexes for investigation queries
CREATE INDEX idx_events_session_time ON events(session_id, timestamp);
CREATE INDEX idx_events_type ON events(session_id, type);
CREATE INDEX idx_markers_session ON markers(session_id, timestamp);

-- FTS for searching network bodies, console messages, etc.
CREATE VIRTUAL TABLE events_fts USING fts5(summary, content=events, content_rowid=rowid);
```

File-per-request for network bodies means the agent can load exactly the evidence it needs without pulling the entire session into context. SQLite handles the "find me all 422 responses between 14:35 and 14:36" queries efficiently. FTS5 handles "search for 'validation error' across all events."

---

## MCP Tool Surface

The agent investigates sessions through 6 tools. These are investigation tools, not automation tools — the mental model is "forensic analyst examining evidence," not "robot clicking buttons."

### `session_list`

List available recorded sessions. The starting point for investigation.

```typescript
interface SessionListParams {
  filter?: {
    after?: string;            // ISO timestamp
    before?: string;
    url_contains?: string;     // Filter by URL pattern
    has_markers?: boolean;     // Only sessions with user markers
    has_errors?: boolean;      // Only sessions with captured errors
  };
  limit?: number;              // Default: 10
}

// Returns:
interface SessionListResult {
  sessions: {
    id: string;
    started_at: string;
    duration_seconds: number;
    url: string;
    event_count: number;
    marker_count: number;
    error_count: number;
    summary: string;           // Auto-generated: "Browsed acme dashboard, 
                               //  3 form submissions, 1 failed API call, 
                               //  2 console errors, 1 user marker"
  }[];
}
```

### `session_overview`

Get a structured overview of a session — the "table of contents" before diving in. Token-budgeted, just like Krometrail viewports.

```typescript
interface SessionOverviewParams {
  session_id: string;
  
  // What to include in the overview
  include?: ("timeline" | "markers" | "errors" | "network_summary" | 
             "navigation_history" | "form_activity" | "console_errors")[];
  
  // Token control
  token_budget?: number;       // Default: 3000
  
  // Time range focus
  around_marker?: string;      // Center overview on a specific marker
  time_range?: {               // Or specify a time window
    start: string;
    end: string;
  };
}

// Returns something like:
// 
// Session: acme-dashboard | 2026-03-07 14:30 – 14:47 (17 min)
// URL: https://app.acme.com/dashboard
//
// Navigation Path:
//   14:30:00  /login
//   14:30:12  /dashboard
//   14:31:45  /patients/new
//   14:35:22  /patients/new  (form submitted — 422 response)  ← MARKER #1
//   14:35:30  /patients/new  (still on page, form not cleared)
//   14:36:01  /patients/new  (resubmitted — 200 response)
//   14:36:05  /patients/12345
//
// Markers:
//   [M1] 14:35:22 — "form failed" (user-placed)
//   [M2] 14:35:22 — network error detected (auto)
//
// Errors:
//   14:35:22  [network] POST /api/patients → 422 (validation error)
//   14:35:22  [console] Error: Unhandled form submission error
//
// Network Summary:
//   47 requests | 45 succeeded | 1 failed (422) | 1 failed (timeout)
//   Notable: POST /api/patients (422), GET /api/insurance/verify (timeout)
```

This is the viewport concept applied to time instead of space. The agent sees a compressed, navigable summary and can drill into any moment.

### `session_search`

Semantic + structured search across session events. This is the RAG-like query tool.

```typescript
interface SessionSearchParams {
  session_id: string;
  
  // What to search for
  query?: string;              // Natural language: "form validation error"
  
  // Or structured filters
  filters?: {
    event_types?: EventType[];  // e.g., ["network_response", "console"]
    status_codes?: number[];    // e.g., [400, 422, 500]
    url_pattern?: string;       // e.g., "**/api/patients**"
    console_level?: string[];   // e.g., ["error", "warn"]
    time_range?: { start: string; end: string };
    around_marker?: string;     // Within ±N seconds of a marker
    contains_text?: string;     // Body/message contains this string
  };
  
  // Control
  token_budget?: number;       // Default: 2000
  max_results?: number;        // Default: 10
}
```

The agent can search semantically ("find where the patient form failed") or precisely ("show me all 4xx network responses between 14:35 and 14:36"). Both query modes matter.

### `session_inspect`

Deep-dive into a specific event or moment. This is where the agent gets full detail.

```typescript
interface SessionInspectParams {
  session_id: string;
  
  // What to inspect — one of:
  event_id?: string;           // Specific event by ID
  timestamp?: string;          // Moment in time
  marker_id?: string;          // Jump to a marker
  
  // What to include
  include?: ("event_detail" | "surrounding_events" | "dom_snapshot" | 
             "screenshot" | "network_body" | "form_state" | 
             "console_context" | "storage_state")[];
  
  // Context window
  context_window?: number;     // Seconds of surrounding events (default: 5)
  
  // Token control
  token_budget?: number;       // Default: 3000
}

// Example response for inspecting a failed form submission:
//
// Event: POST /api/patients → 422 (at 14:35:22.456)
//
// Request:
//   Method: POST
//   URL: https://api.acme.com/api/patients
//   Headers: Content-Type: application/json, Authorization: Bearer [redacted]
//   Body: {
//     "first_name": "Jane",
//     "last_name": "Doe",
//     "phone": "(555) 123-4567",     ← LIKELY ISSUE
//     "insurance_id": "INS-789"
//   }
//
// Response:
//   Status: 422 Unprocessable Entity
//   Body: {
//     "errors": [{
//       "field": "phone",
//       "message": "Phone must match format: XXXXXXXXXX"
//     }]
//   }
//
// Form State at Submission:
//   [input#first-name] value="Jane"
//   [input#last-name] value="Doe"  
//   [input#phone] value="(555) 123-4567"    ← Matches request
//   [input#insurance-id] value="INS-789"
//
// Console (±5s):
//   14:35:22.460  [error] Error: Unhandled form submission error
//   14:35:22.461  [error]   at FormHandler.submit (form.js:142)
//
// Screenshot: [saved to /tmp/browser-lens/screenshot-14-35-22.png]
```

This is the money tool. The agent gets complete forensic detail about a specific moment — the request, response, form state, console output, and visual context — all in one call.

### `session_diff`

Compare two moments in the session. "What changed between when the form loaded and when it was submitted?"

```typescript
interface SessionDiffParams {
  session_id: string;
  
  // Two points to compare
  before: string;              // Timestamp or event_id
  after: string;               // Timestamp or event_id
  
  // What to diff
  include?: ("dom" | "form_state" | "storage" | "url" | "console_new")[];
  
  // Token control
  token_budget?: number;       // Default: 2000
}

// Example response:
//
// Diff: 14:31:45 → 14:35:22 (3 min 37 sec)
//
// URL: unchanged (/patients/new)
//
// Form State Changes:
//   [input#first-name]    "" → "Jane"
//   [input#last-name]     "" → "Doe"
//   [input#phone]         "" → "(555) 123-4567"
//   [input#insurance-id]  "" → "INS-789"
//   [select#state]        "CA" → "CA" (unchanged)
//
// Storage Changes:
//   localStorage["draft_patient"] = '{"first_name":"Jane"...}' (added)
//
// New Console Messages:
//   14:33:10  [info] Insurance verification started
//   14:33:12  [info] Insurance verified: active
//
// Network Activity (new requests):
//   GET /api/insurance/verify?id=INS-789 → 200 (2.1s)
//   GET /api/states → 200 (cached)
```

### `session_replay_context`

Generate a reproduction context — everything an agent or developer needs to reproduce the issue. This is the "hand it to Claude Code" tool.

```typescript
interface SessionReplayContextParams {
  session_id: string;
  
  // Focus area
  around_marker?: string;
  time_range?: { start: string; end: string };
  
  // Output format
  format: "summary" | "reproduction_steps" | "test_scaffold" | "har";
  
  // For test_scaffold:
  test_framework?: "playwright" | "cypress" | "stagehand";
}

// format="reproduction_steps" example:
//
// ## Reproduction Steps
//
// 1. Navigate to https://app.acme.com/patients/new
// 2. Fill form fields:
//    - First Name: "Jane"
//    - Last Name: "Doe"
//    - Phone: "(555) 123-4567"
//    - Insurance ID: "INS-789"
// 3. Click "Create Patient" button
// 4. Expected: Patient created, redirect to patient page
// 5. Actual: 422 error — phone format rejected by API
//
// ## Root Cause
// Frontend accepts "(555) 123-4567" format
// Backend expects "5551234567" format
// No frontend normalization before API call
//
// ## Evidence
// - Network: POST /api/patients returned 422 (event_id: evt_1234)
// - Error response: {"errors":[{"field":"phone","message":"..."}]}
// - Console: Unhandled form submission error at form.js:142

// format="test_scaffold" with framework="playwright" example:
//
// test('patient creation should normalize phone format', async ({ page }) => {
//   await page.goto('https://app.acme.com/patients/new');
//   await page.fill('#first-name', 'Jane');
//   await page.fill('#last-name', 'Doe');
//   await page.fill('#phone', '(555) 123-4567');
//   await page.fill('#insurance-id', 'INS-789');
//   
//   // Intercept API call to verify normalized format
//   const [request] = await Promise.all([
//     page.waitForRequest('**/api/patients'),
//     page.click('button[type="submit"]'),
//   ]);
//   
//   const body = JSON.parse(request.postData());
//   expect(body.phone).toBe('5551234567'); // Should be normalized
// });
```

---

## CDP Recorder Architecture

Since we're going CDP-only, the architecture simplifies significantly. No Chrome extension to build or maintain. The recorder is a Bun process that connects to Chrome's DevTools Protocol and passively observes.

```
┌──────────────────────────────────────┐
│         Chrome (user's browser)       │
│         --remote-debugging-port=9222  │
│                                       │
│   User browses normally.              │
│   CDP exposes everything.             │
└──────────────┬───────────────────────┘
               │ CDP WebSocket
               │
┌──────────────▼───────────────────────┐
│         Browser Lens Daemon           │
│         (Bun + TypeScript)            │
│                                       │
│  ┌─────────────┐  ┌───────────────┐  │
│  │  CDP        │  │  Rolling      │  │
│  │  Listener   │  │  Buffer       │  │
│  │             │  │               │  │
│  │ • Network   │  │ • In-memory   │  │
│  │ • Runtime   │  │ • N minutes   │  │
│  │ • DOM       │  │ • Evicts old  │  │
│  │ • Page      │  │   when no     │  │
│  │ • Console   │  │   marker      │  │
│  │ • Input     │  │               │  │
│  └──────┬──────┘  └───────┬───────┘  │
│         │                 │           │
│         └────────┬────────┘           │
│                  │                    │
│         ┌────────▼────────┐           │
│         │  Marker triggers│           │
│         │  persist ±N sec │           │
│         │  to disk        │           │
│         └────────┬────────┘           │
│                  │                    │
│  ┌───────────────▼────────────────┐   │
│  │  Storage Layer                 │   │
│  │                                │   │
│  │  ~/.browser-lens/recordings/   │   │
│  │  ├── events/  (JSONL chunks)   │   │
│  │  ├── network/ (response bodies)│   │
│  │  ├── screenshots/ (PNGs)       │   │
│  │  └── index.db (SQLite)         │   │
│  └────────────────────────────────┘   │
│                  │                    │
│  ┌───────────────▼────────────────┐   │
│  │  MCP Server + CLI              │   │
│  │  (investigation interface)     │   │
│  └────────────────────────────────┘   │
└───────────────────────────────────────┘
```

### CDP Domains Used

The recorder subscribes to CDP domains passively — it listens but doesn't inject or modify anything in the browser.

```typescript
// CDP domains the recorder subscribes to:
const CDP_SUBSCRIPTIONS = {
  // Network — full request/response capture including bodies
  "Network.requestWillBeSent": true,
  "Network.responseReceived": true,
  "Network.loadingFinished": true,    // Trigger to fetch response body
  "Network.loadingFailed": true,
  "Network.webSocketFrameSent": true,
  "Network.webSocketFrameReceived": true,
  
  // Console + errors
  "Runtime.consoleAPICalled": true,
  "Runtime.exceptionThrown": true,
  
  // Page lifecycle
  "Page.frameNavigated": true,
  "Page.loadEventFired": true,
  "Page.domContentEventFired": true,
  
  // DOM mutations (opt-in, can be noisy)
  "DOM.documentUpdated": true,
  
  // Performance
  "Performance.metrics": true,
  
  // Input (for tracking user actions)
  "Input.dispatchMouseEvent": false,  // We observe, not dispatch
  // Instead: use DOM event listeners injected once via Page.addScriptToEvaluateOnNewDocument
};
```

### User Input Tracking via Injection

CDP doesn't have a native "observe user clicks" domain. The recorder injects a minimal event listener once per page load via `Page.addScriptToEvaluateOnNewDocument`:

```javascript
// Injected into every page — the ONLY code we inject
(function() {
  const BL = { events: [] };
  
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[id],[name],[data-testid],[role="button"],a,button,input,select');
    if (!target) return;
    BL.events.push({
      type: 'click',
      timestamp: Date.now(),
      selector: buildSelector(target),
      text: target.textContent?.slice(0, 100),
      tag: target.tagName
    });
  }, true);
  
  document.addEventListener('submit', (e) => {
    const form = e.target;
    BL.events.push({
      type: 'submit',
      timestamp: Date.now(),
      selector: buildSelector(form),
      fields: captureFormState(form)  // All field values (passwords masked)
    });
  }, true);
  
  document.addEventListener('change', (e) => {
    BL.events.push({
      type: 'change',
      timestamp: Date.now(),
      selector: buildSelector(e.target),
      value: e.target.type === 'password' ? '[MASKED]' : e.target.value
    });
  }, true);
  
  // Flush to CDP periodically via Runtime.evaluate callback
  setInterval(() => {
    if (BL.events.length === 0) return;
    window.__BL_FLUSH__(JSON.stringify(BL.events));
    BL.events = [];
  }, 1000);
})();
```

The daemon polls for flushed events via `Runtime.evaluate`. This is the only code injected into the page — everything else is pure CDP observation.

### Rolling Buffer Implementation

```typescript
class RollingBuffer {
  private events: RecordedEvent[] = [];
  private maxAge: number;           // Default: 30 minutes in ms
  private markerPadding: number;    // Default: 120 seconds in ms
  
  push(event: RecordedEvent) {
    this.events.push(event);
    this.evict();
  }
  
  private evict() {
    const cutoff = Date.now() - this.maxAge;
    // Keep everything within maxAge
    // Keep everything within markerPadding of any marker
    this.events = this.events.filter(e => {
      if (e.timestamp > cutoff) return true;
      return this.markers.some(m => 
        Math.abs(e.timestamp - m.timestamp) < this.markerPadding
      );
    });
  }
  
  placeMarker(label?: string) {
    const marker: Marker = {
      id: generateId(),
      timestamp: Date.now(),
      label,
      autoDetected: false
    };
    this.markers.push(marker);
    // Persist the window around this marker
    this.persistAroundMarker(marker);
  }
  
  private persistAroundMarker(marker: Marker) {
    const start = marker.timestamp - this.markerPadding;
    const end = marker.timestamp + this.markerPadding;
    const eventsToSave = this.events.filter(e => 
      e.timestamp >= start && e.timestamp <= end
    );
    // Write to JSONL + index in SQLite
    this.storage.persist(marker, eventsToSave);
  }
}
```

When a marker is placed, the buffer immediately persists everything within the ±N second window. Future events that fall within the window are also persisted as they arrive (the marker's `end` boundary is in the future). After the window closes, new events only go to the rolling buffer again unless another marker is placed.

### Marker Placement

Three ways to place a marker:

1. **CLI command:** `browser-lens mark "form submission failed"` — the daemon exposes a local HTTP endpoint or Unix socket for this.
2. **Keyboard shortcut:** The injected script listens for a configurable hotkey (default: `Ctrl+Shift+M`) and sends a marker event to the daemon.
3. **Auto-detection:** The daemon places markers automatically when it detects anomalies (4xx/5xx responses, unhandled exceptions, etc.).

### Launch Wrapper

To make the "launch Chrome with CDP" step painless:

```bash
# browser-lens provides a launcher that handles the flag
browser-lens start                          # Launch Chrome with CDP enabled
browser-lens start --port=9222              # Custom port
browser-lens start --profile="testing"      # Separate Chrome profile
browser-lens start --attach                 # Attach to already-running Chrome

# Or just add the flag yourself
google-chrome --remote-debugging-port=9222
```

The `browser-lens start` command also starts the daemon, so one command gives you: Chrome with CDP → daemon recording → MCP server ready for investigation.

---

## Auto-Detection: Smart Markers

The daemon doesn't just passively record — it watches for patterns that suggest something went wrong and auto-places markers. This means even if the user forgets to mark the moment, the evidence is flagged.

### Detection Rules

```typescript
const autoDetectionRules: DetectionRule[] = [
  // Network failures
  {
    trigger: "network_response",
    condition: (event) => event.status >= 400,
    label: (event) => `HTTP ${event.status} on ${event.method} ${event.url}`,
    severity: event.status >= 500 ? "high" : "medium"
  },
  
  // Console errors
  {
    trigger: "console",
    condition: (event) => event.level === "error",
    label: (event) => `Console error: ${event.message.slice(0, 100)}`,
    severity: "medium"
  },
  
  // Unhandled exceptions
  {
    trigger: "page_error",
    condition: () => true,
    label: (event) => `Uncaught: ${event.message.slice(0, 100)}`,
    severity: "high"
  },
  
  // Slow responses
  {
    trigger: "network_response",
    condition: (event) => event.duration > 5000,
    label: (event) => `Slow response: ${event.url} (${event.duration}ms)`,
    severity: "low"
  },
  
  // Failed form submissions (heuristic: submit event followed by error)
  {
    trigger: "user_input",
    condition: (event, recent) => {
      if (event.action !== "submit") return false;
      return recent.some(e => 
        e.type === "network_response" && 
        e.status >= 400 && 
        e.timestamp - event.timestamp < 3000
      );
    },
    label: "Form submission failed",
    severity: "high"
  },
  
  // Layout shifts (potential rendering bugs)
  {
    trigger: "performance",
    condition: (event) => event.metric === "CLS" && event.value > 0.25,
    label: `Large layout shift (CLS: ${event.value})`,
    severity: "low"
  }
];
```

Auto-markers are visually distinct from user-placed markers in the timeline, so the agent knows which are human-flagged and which are system-detected.

---

## CLI Interface

For agents with filesystem access (Claude Code, Codex), the CLI reads recordings and outputs investigation results to files.

```bash
# List sessions
browser-lens sessions --has-markers --after="2026-03-07"

# Overview of a session
browser-lens overview <session_id> --around-marker=M1 --budget=3000

# Search
browser-lens search <session_id> --query="validation error"
browser-lens search <session_id> --status-codes=422,500 --event-types=network_response

# Inspect a specific moment
browser-lens inspect <session_id> --marker=M1 --include=network_body,form_state,console
browser-lens inspect <session_id> --timestamp="14:35:22" --include=screenshot --save-to=/tmp/

# Diff two moments
browser-lens diff <session_id> --before="14:31:45" --after="14:35:22" --include=form_state

# Generate reproduction context
browser-lens replay-context <session_id> --around-marker=M1 --format=reproduction_steps
browser-lens replay-context <session_id> --around-marker=M1 --format=test_scaffold --framework=playwright

# Export session (for sharing with teammates)
browser-lens export <session_id> --format=har      # Standard HAR file
browser-lens export <session_id> --format=archive   # Full Browser Lens archive
```

### SKILL.md for Coding Agents

```markdown
## Browser Lens Investigation Workflow

When the user mentions a browser issue, bug, or unexpected behavior:

1. `browser-lens sessions --has-markers` — find relevant sessions
2. `browser-lens overview <id> --around-marker=M1` — get the big picture
3. `browser-lens search <id> --status-codes=400,422,500` — find errors
4. `browser-lens inspect <id> --marker=M1 --include=network_body,form_state,console` 
   — get full detail on the problem moment
5. `browser-lens diff <id> --before=<load_time> --after=<error_time>` 
   — see what changed
6. `browser-lens replay-context <id> --format=test_scaffold --framework=playwright` 
   — generate a test to reproduce and verify the fix
```

---

## Privacy & Security

Recording browser activity requires careful privacy handling.

### What Gets Captured

| Data Type | Behavior |
|---|---|
| URLs and navigation | Captured |
| Network request URLs | Captured |
| Network request/response bodies | Captured (configurable body size limit) |
| Form field values | Captured (password fields masked) |
| Console output | Captured |
| Screenshots | Captured at configurable intervals |
| Cookies/storage | Captured |

### Local-Only by Default

Recordings never leave the user's machine unless they explicitly export. No cloud sync, no telemetry, no phoning home. The MCP server reads from the local filesystem.

### Retention

Configurable auto-cleanup: delete recordings older than N days. Default: 7 days. Sessions with user-placed markers exempt from auto-cleanup (the user explicitly flagged them as important).

---

## Comparison to Existing Tools

| Capability | Browser DevTools | Session Replay (LogRocket, etc.) | Playwright MCP | **Browser Lens** |
|---|---|---|---|---|
| Who controls browser | Human | Human | Agent | **Human** |
| Recording approach | Manual inspection | DOM reconstruction | N/A (live only) | **CDP passive listener** |
| Recording fidelity | Limited (manual) | High (DOM replay) | N/A (live only) | **High (structured events)** |
| Agent-queryable | No | No (human dashboards) | Yes (live) | **Yes (recorded, via MCP)** |
| Network body capture | Yes (manual) | Partial | Live only | **Full, searchable via FTS5** |
| Token cost during use | N/A | N/A | High (per action) | **Zero (recording is passive)** |
| Investigation tools | Manual inspection | Visual replay | Agent must drive | **6 structured MCP tools** |
| Reproduction output | Manual | Video replay | N/A | **Test scaffolds, repro steps** |
| Privacy control | N/A | Cloud-hosted (concern) | N/A | **Local-only** |
| Scope | All tabs | All pages | Per page | **Per tab (by design)** |

---

## Implementation Plan

### Phase 1 — CDP Recorder + Rolling Buffer (Weeks 1-3)

- Bun project scaffold
- CDP connection manager (attach to Chrome via WebSocket, handle reconnection)
- CDP domain subscriptions: Network, Runtime, Page, Performance
- Minimal page injection for user input tracking (click, submit, change)
- Rolling buffer with configurable max age (default: 30 min)
- Marker system: CLI command (`browser-lens mark`), keyboard shortcut via injection, auto-detection (4xx/5xx, unhandled exceptions)
- Persist-on-marker: flush ±N seconds of buffer to JSONL + SQLite on marker placement
- `browser-lens start` launcher (Chrome + daemon in one command)
- Screenshot capture via `Page.captureScreenshot` (on navigation + on marker + configurable interval)

### Phase 2 — Investigation MCP Server (Weeks 3-5)

- MCP server (stdio + HTTP/SSE) reading from SQLite + JSONL
- `session_list` tool with filtering
- `session_overview` tool with token-budgeted viewport over the timeline
- `session_search` tool (SQLite structured queries + FTS5 text search)
- `session_inspect` tool with full event detail + surrounding context window
- CLI interface (dual transport)
- SKILL.md for Claude Code / coding agents

### Phase 3 — Intelligence (Weeks 5-7)

- `session_diff` tool (compare two moments)
- `session_replay_context` tool (reproduction steps + test scaffold generation)
- Smart auto-detection rules (failed form submissions, slow responses, layout shifts)
- Stagehand integration for optional automated reproduction

### Phase 4 — Polish (Week 7+)

- Configuration: buffer size, marker padding, screenshot intervals, privacy controls
- Storage retention / cleanup
- HAR export for compatibility with existing tools
- Session archive format for sharing
- `browser-lens status` dashboard (TUI: active recordings, buffer size, marker count)
- Podman/container option for isolated recording environments

---

## Design Decisions (Locked)

1. **Always-on with rolling buffer.** The daemon records continuously when switched on. Events write to a rolling buffer (configurable size, default: last 30 minutes). When the user places a marker, the buffer persists N seconds before and after the marker (configurable, default: ±120 seconds). Unmarked buffer data ages out and is discarded. This means the user never has to think "should I start recording?" — they just browse, and when something goes wrong, they mark it, and the context is already captured.

2. **SQLite index alongside JSONL.** Recordings use JSONL files for raw event storage (append-only, efficient writes during recording) plus a SQLite index for investigation queries (time range lookups, event type filtering, full-text search on network bodies and console messages). The MCP server queries SQLite; the raw JSONL files are the source of truth for export/archive.

3. **CDP only.** This is a developer debugging tool, not a consumer product. Launching Chrome with `--remote-debugging-port` gives full network body access (no CORS limitations), unfiltered console output, DOM snapshots, and screenshot capture — all without the Manifest V3 permission limitations of a Chrome extension. The tradeoff (user must launch Chrome with a flag, or use a wrapper script) is acceptable for the target audience. This also means Stagehand can be the connection layer (it already manages CDP connections), and we don't need to build or maintain a Chrome extension at all.

4. **Stagehand as optional reproduction engine.** The primary flow is: human drives → agent investigates recording → agent reports findings. Optionally, the agent can hand reproduction steps to Stagehand's `act()` to verify the bug exists and confirm a fix works. This keeps Stagehand in the architecture but in a supporting role, not the critical path.

5. **Per-tab recording only.** Each recording session tracks a single tab. Multi-tab correlation is out of scope. If the user needs to investigate cross-tab behavior, they record each tab separately. Keeps the data model simple and avoids the complexity of cross-tab event ordering.

