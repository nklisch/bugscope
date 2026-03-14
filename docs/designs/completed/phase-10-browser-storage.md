# Design: Phase 10 — Browser Lens: Storage & Persistence

## Overview

Phase 10 adds persistent storage for browser recordings. When a marker is placed (manually or by auto-detection), the rolling buffer flushes events within the ±padding window to disk. SQLite indexes events for fast investigation queries. Network response bodies and screenshots are stored separately for on-demand loading.

This phase also extracts a shared `token-budget.ts` utility from the existing compression module, providing the foundation for token-budgeted renderers in Phase 11.

**Depends on:** Phase 9 (CDP recorder, rolling buffer, marker system)

---

## Architecture

### Storage Layout

```
~/.krometrail/browser/                    # All browser data under krometrail
├── index.db                               # SQLite — master index across all sessions
├── recordings/
│   ├── 2026-03-07_14-30-22_acme-dashboard/
│   │   ├── events.jsonl                   # Append-only event log
│   │   ├── network/
│   │   │   ├── req_abc123_body.bin        # Request body (if present)
│   │   │   ├── res_abc123_body.bin        # Response body
│   │   │   └── ...
│   │   └── screenshots/
│   │       ├── 1709826622000.png          # Timestamp-named screenshots
│   │       └── ...
│   └── ...
```

### Data Flow

```
Rolling Buffer (in-memory, Phase 9)
        │
        │  marker placed
        ▼
Persistence Pipeline (this phase)
        │
        ├── events.jsonl  (append RecordedEvents as JSON lines)
        ├── SQLite index  (insert event summaries + byte offsets)
        ├── network/      (fetch + store response bodies via CDP)
        └── screenshots/  (capture via Page.captureScreenshot)
```

### Key Design Decisions

1. **JSONL is the source of truth.** SQLite contains summaries and byte offsets for fast queries, but the full event data lives in JSONL. This means exports/archives are just the JSONL + assets.

2. **Byte-offset references.** Each SQLite event row stores `detail_offset` and `detail_length` pointing into the JSONL file. Reading a single event is `seek(offset) + read(length)` — no scanning. This is critical for `session_inspect` (Phase 11) performance.

3. **Network bodies stored separately.** Request/response bodies can be large (megabytes). Storing them inline in JSONL would make scanning expensive. Separate files allow the investigation tools to load exactly the evidence they need.

4. **Screenshots on-demand.** Screenshots are captured on navigation, on marker placement, and at a configurable interval. They're stored as PNGs in the session directory.

---

## Implementation Units

### Unit 1: SQLite Schema & Database Manager

**File**: `src/browser/storage/database.ts`

```typescript
import Database from "bun:sqlite";

export class BrowserDatabase {
	private db: Database;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA synchronous = NORMAL");
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id TEXT PRIMARY KEY,
				started_at INTEGER NOT NULL,
				ended_at INTEGER,
				tab_url TEXT,
				tab_title TEXT,
				event_count INTEGER DEFAULT 0,
				marker_count INTEGER DEFAULT 0,
				error_count INTEGER DEFAULT 0,
				recording_dir TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS events (
				rowid INTEGER PRIMARY KEY,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				event_id TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				type TEXT NOT NULL,
				summary TEXT NOT NULL,
				detail_offset INTEGER NOT NULL,
				detail_length INTEGER NOT NULL,
				UNIQUE(session_id, event_id)
			);

			CREATE TABLE IF NOT EXISTS markers (
				id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				timestamp INTEGER NOT NULL,
				label TEXT,
				auto_detected INTEGER NOT NULL DEFAULT 0,
				severity TEXT
			);

			CREATE TABLE IF NOT EXISTS network_bodies (
				event_id TEXT PRIMARY KEY,
				session_id TEXT NOT NULL REFERENCES sessions(id),
				request_body_path TEXT,
				response_body_path TEXT,
				response_size INTEGER,
				content_type TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_events_session_time
				ON events(session_id, timestamp);
			CREATE INDEX IF NOT EXISTS idx_events_type
				ON events(session_id, type);
			CREATE INDEX IF NOT EXISTS idx_markers_session
				ON markers(session_id, timestamp);

			CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
				summary,
				content=events,
				content_rowid=rowid
			);
		`);
	}

	// --- Session CRUD ---
	createSession(session: { id: string; startedAt: number; tabUrl: string; tabTitle: string; recordingDir: string }): void;
	updateSessionCounts(sessionId: string): void;
	endSession(sessionId: string, endedAt: number): void;
	listSessions(filter?: SessionFilter): SessionRow[];

	// --- Event insertion ---
	insertEvent(event: { sessionId: string; eventId: string; timestamp: number; type: string; summary: string; detailOffset: number; detailLength: number }): void;
	insertEventBatch(events: Array</* same as above */>): void;

	// --- Marker insertion ---
	insertMarker(marker: { id: string; sessionId: string; timestamp: number; label?: string; autoDetected: boolean; severity?: string }): void;

	// --- Network body references ---
	insertNetworkBody(ref: { eventId: string; sessionId: string; requestBodyPath?: string; responseBodyPath?: string; responseSize?: number; contentType?: string }): void;

	// --- Queries (for Phase 11 investigation tools) ---
	queryEvents(sessionId: string, filter: EventQueryFilter): EventRow[];
	queryMarkers(sessionId: string): MarkerRow[];
	searchFTS(sessionId: string, query: string, limit?: number): EventRow[];
	getEventByOffset(sessionId: string, offset: number, length: number): string; // reads from JSONL

	close(): void;
}

export interface SessionFilter {
	after?: number;
	before?: number;
	urlContains?: string;
	hasMarkers?: boolean;
	hasErrors?: boolean;
	limit?: number;
}

export interface EventQueryFilter {
	types?: string[];
	timeRange?: { start: number; end: number };
	statusCodes?: number[];
	limit?: number;
	offset?: number;
}
```

**WAL mode:** Write-Ahead Logging allows concurrent reads during writes. The recorder writes events while investigation tools read — WAL prevents contention.

**FTS5 sync:** When inserting events, also insert into `events_fts`. Use triggers for automatic sync:

```sql
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
	INSERT INTO events_fts(rowid, summary) VALUES (new.rowid, new.summary);
END;
```

**Tests:** Unit tests with in-memory SQLite. Test schema creation, CRUD, query filters, FTS search.

---

### Unit 2: JSONL Event Writer

**File**: `src/browser/storage/event-writer.ts`

Append-only writer that tracks byte offsets for each written event.

```typescript
import { appendFileSync, openSync, writeSync, closeSync, statSync } from "node:fs";

export class EventWriter {
	private fd: number;
	private currentOffset: number;

	constructor(private filePath: string) {
		// Open for append, get current file size as starting offset
		this.fd = openSync(filePath, "a");
		try {
			this.currentOffset = statSync(filePath).size;
		} catch {
			this.currentOffset = 0;
		}
	}

	/**
	 * Write an event to the JSONL file.
	 * Returns { offset, length } for the SQLite index.
	 */
	write(event: RecordedEvent): { offset: number; length: number } {
		const line = JSON.stringify(event) + "\n";
		const bytes = Buffer.from(line, "utf-8");
		const offset = this.currentOffset;

		writeSync(this.fd, bytes);
		this.currentOffset += bytes.length;

		return { offset, length: bytes.length };
	}

	/**
	 * Write a batch of events. Returns offsets for each.
	 */
	writeBatch(events: RecordedEvent[]): Array<{ offset: number; length: number }> {
		return events.map((e) => this.write(e));
	}

	/**
	 * Read a single event by byte offset.
	 */
	static readAt(filePath: string, offset: number, length: number): RecordedEvent {
		const fd = openSync(filePath, "r");
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, offset);
		closeSync(fd);
		return JSON.parse(buffer.toString("utf-8"));
	}

	close(): void {
		closeSync(this.fd);
	}
}
```

**Why sync writes:**

The recorder writes events infrequently (only when a marker triggers persistence). Async writes add complexity (ordering, backpressure) for minimal benefit. A batch persist of ~500 events takes <10ms with sync writes.

**Tests:** Unit tests for write/read round-trip, batch writes, byte offset accuracy, concurrent read during write.

---

### Unit 3: Marker-Triggered Persistence Pipeline

**File**: `src/browser/storage/persistence.ts`

The core pipeline that converts in-memory buffer events into persistent storage when a marker is placed.

```typescript
export class PersistencePipeline {
	private db: BrowserDatabase;
	private activeSessions = new Map<string, {
		writer: EventWriter;
		dir: string;
		persistedEventIds: Set<string>; // Track already-persisted events
		openMarkerWindows: Array<{ markerId: string; start: number; end: number }>;
	}>;

	constructor(private config: PersistenceConfig) {
		const dbPath = resolve(config.dataDir, "index.db");
		this.db = new BrowserDatabase(dbPath);
	}

	/**
	 * Called when a marker is placed. Persists the buffer window.
	 */
	async onMarkerPlaced(
		marker: Marker,
		buffer: RollingBuffer,
		sessionInfo: BrowserSessionInfo,
		cdpClient: CDPClient,
		tabSessionId: string,
	): Promise<void> {
		// 1. Ensure session directory + writer exist
		const session = this.ensureSession(sessionInfo);

		// 2. Insert marker into SQLite
		this.db.insertMarker({
			id: marker.id,
			sessionId: sessionInfo.id,
			timestamp: marker.timestamp,
			label: marker.label,
			autoDetected: marker.autoDetected,
			severity: marker.severity,
		});

		// 3. Get events within the marker's past window
		const windowStart = marker.timestamp - this.config.markerPaddingMs;
		const windowEnd = marker.timestamp + this.config.markerPaddingMs;
		const events = buffer.getEvents(windowStart, marker.timestamp);

		// 4. Filter out already-persisted events
		const newEvents = events.filter((e) => !session.persistedEventIds.has(e.id));

		// 5. Write new events to JSONL + index in SQLite
		if (newEvents.length > 0) {
			const offsets = session.writer.writeBatch(newEvents);
			const batch = newEvents.map((e, i) => ({
				sessionId: sessionInfo.id,
				eventId: e.id,
				timestamp: e.timestamp,
				type: e.type,
				summary: e.summary,
				detailOffset: offsets[i].offset,
				detailLength: offsets[i].length,
			}));
			this.db.insertEventBatch(batch);

			for (const e of newEvents) {
				session.persistedEventIds.add(e.id);
			}
		}

		// 6. Extract network bodies for network events in this window
		await this.extractNetworkBodies(session, newEvents, cdpClient, tabSessionId);

		// 7. Capture a screenshot at marker time
		await this.captureScreenshot(session, marker.timestamp, cdpClient, tabSessionId);

		// 8. Register the future window for real-time persistence
		session.openMarkerWindows.push({
			markerId: marker.id,
			start: marker.timestamp,
			end: windowEnd,
		});

		// 9. Update session counts
		this.db.updateSessionCounts(sessionInfo.id);
	}

	/**
	 * Called for every new event while marker windows are open.
	 * Persists events that fall within an open marker's future window.
	 */
	onNewEvent(event: RecordedEvent, sessionInfo: BrowserSessionInfo): void {
		const session = this.activeSessions.get(sessionInfo.id);
		if (!session) return;

		// Close expired windows
		const now = Date.now();
		session.openMarkerWindows = session.openMarkerWindows.filter(
			(w) => w.end > now,
		);

		if (session.openMarkerWindows.length === 0) return;

		// Check if event falls within any open window
		const inWindow = session.openMarkerWindows.some(
			(w) => event.timestamp >= w.start && event.timestamp <= w.end,
		);

		if (inWindow && !session.persistedEventIds.has(event.id)) {
			const { offset, length } = session.writer.write(event);
			this.db.insertEvent({
				sessionId: sessionInfo.id,
				eventId: event.id,
				timestamp: event.timestamp,
				type: event.type,
				summary: event.summary,
				detailOffset: offset,
				detailLength: length,
			});
			session.persistedEventIds.add(event.id);
		}
	}

	private ensureSession(info: BrowserSessionInfo): ActiveSession {
		if (this.activeSessions.has(info.id)) {
			return this.activeSessions.get(info.id)!;
		}

		// Create session directory
		const dirName = `${formatTimestamp(info.startedAt)}_${slugify(info.tabs[0]?.url ?? "unknown")}`;
		const dir = resolve(this.config.dataDir, "recordings", dirName);
		mkdirSync(resolve(dir, "network"), { recursive: true });
		mkdirSync(resolve(dir, "screenshots"), { recursive: true });

		// Create JSONL writer
		const writer = new EventWriter(resolve(dir, "events.jsonl"));

		// Register session in SQLite
		this.db.createSession({
			id: info.id,
			startedAt: info.startedAt,
			tabUrl: info.tabs[0]?.url ?? "",
			tabTitle: info.tabs[0]?.title ?? "",
			recordingDir: dir,
		});

		const session = { writer, dir, persistedEventIds: new Set<string>(), openMarkerWindows: [] };
		this.activeSessions.set(info.id, session);
		return session;
	}
}
```

**Real-time persistence after marker:**

When a marker is placed at time T, the past window (T - padding) is flushed immediately. The future window (T + padding) stays open — new events arriving within this window are persisted as they come in via `onNewEvent()`. After the window closes, events go back to buffer-only mode.

**Tests:** Integration tests with a mock buffer and real filesystem. Test marker-triggered flush, future window persistence, deduplication, session directory creation.

---

### Unit 4: Network Body Extraction

**File**: `src/browser/storage/network-extractor.ts`

Fetches and stores network request/response bodies via CDP.

```typescript
export class NetworkExtractor {
	/**
	 * Extract and store network bodies for network events.
	 * Called during marker-triggered persistence.
	 */
	async extractBodies(
		events: RecordedEvent[],
		cdpClient: CDPClient,
		tabSessionId: string,
		networkDir: string,
		db: BrowserDatabase,
		sessionId: string,
	): Promise<void> {
		const networkEvents = events.filter(
			(e) => e.type === "network_request" || e.type === "network_response",
		);

		for (const event of networkEvents) {
			const requestId = event.data.requestId as string;
			if (!requestId) continue;

			try {
				// Fetch response body via CDP
				if (event.type === "network_response" && event.data.hasBody) {
					const result = await cdpClient.sendToTarget(
						tabSessionId,
						"Network.getResponseBody",
						{ requestId },
					) as { body: string; base64Encoded: boolean };

					const fileName = `res_${requestId}_body.bin`;
					const filePath = resolve(networkDir, fileName);
					const content = result.base64Encoded
						? Buffer.from(result.body, "base64")
						: Buffer.from(result.body, "utf-8");

					writeFileSync(filePath, content);

					db.insertNetworkBody({
						eventId: event.id,
						sessionId,
						responseBodyPath: fileName,
						responseSize: content.length,
						contentType: event.data.contentType as string,
					});
				}

				// Store request body if it was captured in the event data
				if (event.type === "network_request" && event.data.postData) {
					const fileName = `req_${requestId}_body.bin`;
					const filePath = resolve(networkDir, fileName);
					writeFileSync(filePath, event.data.postData as string);

					db.insertNetworkBody({
						eventId: event.id,
						sessionId,
						requestBodyPath: fileName,
					});
				}
			} catch {
				// Body may not be available (e.g., request was cancelled, tab navigated away)
				// This is expected — silently skip
			}
		}
	}
}
```

**Body availability:**

CDP's `Network.getResponseBody` only works while the response is in Chrome's cache. If the page has navigated away or the cache was cleared, the body is unavailable. This is why we extract bodies immediately during marker persistence, not lazily during investigation.

**Size limits:**

Response bodies are stored as-is up to a configurable limit (default: 10MB per body). Bodies exceeding the limit are truncated with a marker indicating truncation. Binary bodies (images, wasm, etc.) are stored but flagged by content type so investigation tools can skip them.

**Tests:** Integration tests with a real Chrome instance. Verify response body extraction for JSON API responses, form submissions, and large responses.

---

### Unit 5: Screenshot Capture

**File**: `src/browser/storage/screenshot.ts`

Captures screenshots via CDP's `Page.captureScreenshot`.

```typescript
export class ScreenshotCapture {
	private intervalTimer: Timer | null = null;

	constructor(private config: ScreenshotConfig) {}

	/**
	 * Capture a screenshot and save to the session directory.
	 */
	async capture(
		cdpClient: CDPClient,
		tabSessionId: string,
		screenshotDir: string,
		timestamp?: number,
	): Promise<string> {
		const ts = timestamp ?? Date.now();
		const result = await cdpClient.sendToTarget(
			tabSessionId,
			"Page.captureScreenshot",
			{ format: "png", quality: 80 },
		) as { data: string };

		const filePath = resolve(screenshotDir, `${ts}.png`);
		writeFileSync(filePath, Buffer.from(result.data, "base64"));
		return filePath;
	}

	/**
	 * Start periodic screenshot capture.
	 */
	startPeriodic(
		cdpClient: CDPClient,
		tabSessionId: string,
		screenshotDir: string,
	): void {
		if (this.config.intervalMs <= 0) return;
		this.intervalTimer = setInterval(async () => {
			try {
				await this.capture(cdpClient, tabSessionId, screenshotDir);
			} catch {
				// Tab may have closed — stop periodic capture
				this.stopPeriodic();
			}
		}, this.config.intervalMs);
	}

	stopPeriodic(): void {
		if (this.intervalTimer) {
			clearInterval(this.intervalTimer);
			this.intervalTimer = null;
		}
	}
}

export const ScreenshotConfigSchema = z.object({
	/** Periodic screenshot interval in ms. 0 to disable. Default: 0 (disabled). */
	intervalMs: z.number().default(0),
	/** Capture on navigation. Default: true. */
	onNavigation: z.boolean().default(true),
	/** Capture on marker placement. Default: true. */
	onMarker: z.boolean().default(true),
});
```

**When screenshots are captured:**

1. **On marker placement** (default: on) — the most important moment
2. **On navigation** (default: on) — captures page state at each URL change
3. **Periodic interval** (default: off) — configurable, e.g., every 5 seconds. Disabled by default to avoid disk usage

**Tests:** Integration tests verifying PNG file creation, periodic capture start/stop.

---

### Unit 6: Retention & Cleanup

**File**: `src/browser/storage/retention.ts`

Automatic cleanup of old recordings.

```typescript
export class RetentionManager {
	constructor(private config: RetentionConfig) {}

	/**
	 * Clean up recordings older than the retention period.
	 * Sessions with user-placed markers are exempt unless force=true.
	 */
	async cleanup(db: BrowserDatabase, dataDir: string, force = false): Promise<{ deleted: number }> {
		const cutoff = Date.now() - this.config.maxAgeDays * 24 * 60 * 60 * 1000;

		const sessions = db.listSessions({ before: cutoff });
		let deleted = 0;

		for (const session of sessions) {
			// Skip sessions with user-placed markers (unless force)
			if (!force) {
				const markers = db.queryMarkers(session.id);
				const hasUserMarkers = markers.some((m) => !m.auto_detected);
				if (hasUserMarkers) continue;
			}

			// Delete session directory
			const dir = session.recording_dir;
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}

			// Delete from SQLite
			db.deleteSession(session.id);
			deleted++;
		}

		return { deleted };
	}
}

export const RetentionConfigSchema = z.object({
	/** Max age of recordings in days. Default: 7. */
	maxAgeDays: z.number().default(7),
	/** Run cleanup on startup. Default: true. */
	cleanupOnStartup: z.boolean().default(true),
});
```

**Retention rules:**

- Default: delete recordings older than 7 days
- Sessions with **user-placed** markers (not auto-detected) are exempt from automatic cleanup
- `krometrail browser cleanup --force` overrides the exemption
- Cleanup runs on recorder startup and can be triggered manually

**Tests:** Unit tests with mock filesystem. Test age-based cleanup, marker exemption, force override.

---

### Unit 7: Token Budget Utility Extraction

**File**: `src/core/token-budget.ts`

Extract the token estimation and budgeting logic from `compression.ts` into a shared utility that both DAP viewports and browser investigation renderers can use.

```typescript
/**
 * Estimate token count for a string.
 * Rough heuristic: chars / 4. Same as the existing estimateTokens in compression.ts.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * A section of rendered output with a priority.
 * Higher priority sections are kept; lower priority sections are dropped first.
 */
export interface RenderSection {
	/** Unique identifier for this section. */
	key: string;
	/** Rendered text content. */
	content: string;
	/** Priority (higher = more important, kept longer). */
	priority: number;
}

/**
 * Fit sections within a token budget.
 * Includes sections in priority order (highest first) until the budget is exhausted.
 * Returns the included sections in their original order (by key).
 *
 * @param sections - Sections to consider, in display order
 * @param budget - Max tokens
 * @returns Sections that fit within the budget, in original display order
 */
export function fitToBudget(sections: RenderSection[], budget: number): RenderSection[] {
	// Sort by priority descending to determine inclusion order
	const byPriority = [...sections].sort((a, b) => b.priority - a.priority);

	let remaining = budget;
	const included = new Set<string>();

	for (const section of byPriority) {
		const tokens = estimateTokens(section.content);
		if (tokens <= remaining) {
			included.add(section.key);
			remaining -= tokens;
		}
	}

	// Return in original display order
	return sections.filter((s) => included.has(s.key));
}

/**
 * Truncate a string to fit within a token budget.
 * Appends "... (truncated)" if truncation occurs.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
	const maxChars = maxTokens * 4;
	if (text.length <= maxChars) return text;
	return text.slice(0, maxChars - 20) + "\n... (truncated)";
}
```

**Changes to existing code:**

Update `src/core/compression.ts` to import from `token-budget.ts`:

```typescript
// compression.ts — replace local estimateTokens with import
export { estimateTokens } from "./token-budget.js";
```

This is a non-breaking refactor. The existing `estimateTokens` function moves to `token-budget.ts` and is re-exported from `compression.ts` for backward compatibility.

**Tests:** Unit tests for `fitToBudget` — verify priority ordering, budget enforcement, original display order preservation. Verify `truncateToTokens` with various input sizes.

---

### Unit 8: Recorder Integration

Update the Phase 9 `BrowserRecorder` to hook into the persistence pipeline.

**File**: `src/browser/recorder/index.ts` (modify)

```typescript
// Add to BrowserRecorder constructor:
this.persistence = new PersistencePipeline(config.persistence);
this.screenshotCapture = new ScreenshotCapture(config.screenshots);

// Modify placeMarker():
async placeMarker(label?: string): Promise<Marker> {
	const marker = this.buffer.placeMarker(label);

	// Trigger persistence
	await this.persistence.onMarkerPlaced(
		marker,
		this.buffer,
		this.getSessionInfo()!,
		this.cdpClient,
		this.activeTabSessionId,
	);

	return marker;
}

// Modify onCDPEvent() — after buffer.push():
this.persistence.onNewEvent(event, this.getSessionInfo()!);

// Modify auto-detect marker placement:
for (const m of markers) {
	const marker = this.buffer.placeMarker(m.label, true, m.severity);
	await this.persistence.onMarkerPlaced(
		marker,
		this.buffer,
		this.getSessionInfo()!,
		this.cdpClient,
		this.activeTabSessionId,
	);
}

// On navigation events, capture screenshot if configured:
if (event.type === "navigation" && this.config.screenshots.onNavigation) {
	await this.screenshotCapture.capture(
		this.cdpClient,
		this.activeTabSessionId,
		resolve(sessionDir, "screenshots"),
	);
}
```

**Tests:** Integration test that places a marker, verifies events.jsonl was written, SQLite has entries, network bodies extracted, screenshot captured.

---

## Testing

### Unit Tests

#### `tests/unit/browser/database.test.ts`

- Schema creation on fresh database
- Session CRUD operations
- Event insertion with byte offsets
- Event query by type, time range, status code
- Marker query by session
- FTS search across event summaries
- Batch insert performance (1000 events)

#### `tests/unit/browser/event-writer.test.ts`

- Write/read round-trip preserves event data
- Byte offsets are accurate for sequential writes
- Batch writes produce correct offsets
- `readAt` retrieves correct event from multi-event file

#### `tests/unit/browser/persistence.test.ts`

- Marker triggers flush of past-window events
- Future-window events are persisted in real-time
- Already-persisted events are not duplicated
- Multiple overlapping marker windows handled correctly
- Session directory structure created correctly

#### `tests/unit/browser/retention.test.ts`

- Old sessions without user markers are cleaned up
- Sessions with user markers are preserved
- Force cleanup overrides marker exemption
- Cleanup deletes both filesystem and SQLite entries

#### `tests/unit/core/token-budget.test.ts`

- `estimateTokens` matches existing behavior
- `fitToBudget` includes highest priority sections first
- `fitToBudget` preserves original display order
- `fitToBudget` handles budget exactly equal to total
- `truncateToTokens` appends truncation marker

### Integration Tests

#### `tests/integration/browser/persistence.test.ts`

```typescript
describe.skipIf(!isChromeAvailable())("Browser persistence", () => {
	it("marker triggers JSONL + SQLite persistence");
	it("network response bodies are extracted and stored");
	it("screenshots are captured on marker placement");
	it("future-window events are persisted in real-time");
	it("SQLite FTS search finds events by keyword");
	it("byte-offset read retrieves correct event data");
	it("retention cleanup removes old sessions");
});
```

---

## Verification Checklist

```bash
# Lint
bun run lint

# Unit tests
bun run test tests/unit/browser/
bun run test tests/unit/core/token-budget.test.ts

# Integration tests (needs Chrome)
bun run test tests/integration/browser/

# Manual verification
krometrail browser start
# Browse, trigger a 422 error
krometrail browser mark "form failed"
# Check storage:
ls ~/.krometrail/browser/recordings/       # Session directory created
cat ~/.krometrail/browser/recordings/*/events.jsonl | head  # Events persisted
sqlite3 ~/.krometrail/browser/index.db "SELECT COUNT(*) FROM events"  # Indexed
ls ~/.krometrail/browser/recordings/*/screenshots/  # Screenshot captured
krometrail browser stop
```

**Done when:** Markers trigger persistence to JSONL + SQLite, network bodies are extracted, screenshots are captured, and the `token-budget.ts` utility is extracted and tested.
