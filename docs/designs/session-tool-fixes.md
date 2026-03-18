# Design: Session Investigation Tool Fixes

## Overview

Comprehensive fix for agent-reported issues with the browser session investigation tools (`session_inspect`, `session_overview`, `session_search`, `session_diff`). The root causes are:

1. **Binary network bodies corrupt JSON responses** — bodies read as UTF-8 unconditionally
2. **Overview omits marker IDs** — agents can't reference markers in subsequent tools
3. **Wall-clock timestamps not accepted as input** — `resolveTimestamp` doesn't support `HH:mm:ss.SSS` format
4. **Marker lookup inconsistency** — `search` accepts label OR ID, `inspect` and `overview` accept only ID
5. **Request body content type not stored** — can't detect binary for request bodies
6. **Additional audit finding: `readNetworkBody` also reads as UTF-8** — helper method has same binary bug

---

## Implementation Units

### Unit 1: Binary-Safe Network Body Reading

**File**: `src/browser/investigation/query-engine.ts`

Replace the UTF-8 `readFileSync` calls with binary-safe reading that detects text vs binary content types and renders binary bodies as a placeholder.

```typescript
// New helper — add at module level or as private method
const TEXT_CONTENT_TYPE_PATTERNS = [
	/^text\//,
	/^application\/json/,
	/^application\/xml/,
	/^application\/javascript/,
	/^application\/x-www-form-urlencoded/,
	/^application\/graphql/,
	/^application\/ld\+json/,
	/\+json$/,
	/\+xml$/,
];

function isTextContentType(contentType: string | undefined | null): boolean {
	if (!contentType) return false;
	const lower = contentType.toLowerCase().split(";")[0].trim();
	return TEXT_CONTENT_TYPE_PATTERNS.some((p) => p.test(lower));
}

/**
 * Read a network body file safely. Returns a text string for text content types,
 * or a placeholder for binary content.
 */
function readBodySafe(path: string, contentType: string | undefined | null, size: number | undefined | null): string {
	if (isTextContentType(contentType)) {
		return readFileSync(path, "utf-8");
	}
	// Binary or unknown content type — don't attempt UTF-8 decode
	const sizeLabel = size != null ? formatBytes(size) : "unknown size";
	return `<binary: ${contentType ?? "unknown type"}, ${sizeLabel}>`;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

Changes to `inspect()` method (lines 261-281):

```typescript
// Network body — BEFORE (broken):
result.networkBody = {
	response: readFileSync(bodyPath, "utf-8"),  // BREAKS on binary
	contentType: bodyRef.content_type ?? undefined,
	size: bodyRef.response_size ?? undefined,
};

// Network body — AFTER (safe):
result.networkBody = {
	response: readBodySafe(bodyPath, bodyRef.content_type, bodyRef.response_size),
	contentType: bodyRef.content_type ?? undefined,
	size: bodyRef.response_size ?? undefined,
};

// Request body — BEFORE:
result.networkBody.request = readFileSync(bodyPath, "utf-8");

// Request body — AFTER:
result.networkBody.request = readBodySafe(bodyPath, bodyRef.request_content_type, null);
```

Also fix the `readNetworkBody` convenience helper (line 336-344):

```typescript
// BEFORE:
readNetworkBody(sessionId: string, relPath: string): string | undefined {
	// ...
	return readFileSync(fullPath, "utf-8");
}

// AFTER:
readNetworkBody(sessionId: string, relPath: string, contentType?: string | null): string | undefined {
	try {
		const session = this.db.getSession(this.resolveSessionId(sessionId));
		const fullPath = resolve(session.recording_dir, "network", relPath);
		if (!existsSync(fullPath)) return undefined;
		return readBodySafe(fullPath, contentType, null);
	} catch {
		return undefined;
	}
}
```

**Implementation Notes**:
- `isTextContentType` checks the MIME type prefix against known text patterns. This is a conservative allowlist — unknown types default to binary placeholder.
- `readBodySafe` avoids attempting UTF-8 decode on binary, which prevents JSON serialization corruption downstream.
- The `formatBytes` helper keeps binary placeholders informative.

**Acceptance Criteria**:
- [ ] `readBodySafe` returns UTF-8 string for `application/json`, `text/html`, `text/plain`, `application/x-www-form-urlencoded`
- [ ] `readBodySafe` returns `<binary: image/png, 245.0KB>` placeholder for `image/png`
- [ ] `readBodySafe` returns `<binary: multipart/form-data, unknown size>` for `multipart/form-data`
- [ ] `readBodySafe` returns `<binary: unknown type, unknown size>` when contentType is null/undefined
- [ ] `inspect()` no longer throws on events with binary response bodies
- [ ] `inspect()` no longer throws on events with binary request bodies (multipart/form-data uploads)
- [ ] `readNetworkBody()` helper also uses safe reading

---

### Unit 2: Store Request Content Type

**File**: `src/browser/storage/database.ts`

Add `request_content_type` column to the `network_bodies` table.

```typescript
// In createTables() — update the CREATE TABLE statement:
CREATE TABLE IF NOT EXISTS network_bodies (
	event_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	request_body_path TEXT,
	response_body_path TEXT,
	response_size INTEGER,
	content_type TEXT,
	request_content_type TEXT   -- NEW: content type of the request body
)

// Update insertNetworkBody signature:
insertNetworkBody(ref: {
	eventId: string;
	sessionId: string;
	requestBodyPath?: string;
	responseBodyPath?: string;
	responseSize?: number;
	contentType?: string;
	requestContentType?: string;  // NEW
}): void

// Update the INSERT statement to include request_content_type:
INSERT OR REPLACE INTO network_bodies
	(event_id, session_id, request_body_path, response_body_path, response_size, content_type, request_content_type)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

**File**: `src/browser/storage/network-extractor.ts`

Pass request content type when storing request bodies:

```typescript
// In the network_request handler (line 45-55):
if (event.type === "network_request" && event.data.postData) {
	const fileName = `req_${requestId}_body.bin`;
	const filePath = resolve(networkDir, fileName);
	writeFileSync(filePath, event.data.postData as string);

	db.insertNetworkBody({
		eventId: event.id,
		sessionId,
		requestBodyPath: fileName,
		requestContentType: event.data.contentType as string | undefined,  // NEW — pass through
	});
}
```

**File**: `src/browser/storage/database.ts` — update `NetworkBodyRow` type:

```typescript
export interface NetworkBodyRow {
	event_id: string;
	session_id: string;
	request_body_path: string | null;
	response_body_path: string | null;
	response_size: number | null;
	content_type: string | null;
	request_content_type: string | null;  // NEW
}
```

**Implementation Notes**:
- SQLite handles new columns on existing databases gracefully with `ALTER TABLE ... ADD COLUMN`. However, since the table uses `CREATE TABLE IF NOT EXISTS`, new installs get the column automatically. For existing installs, add a migration check: attempt `ALTER TABLE network_bodies ADD COLUMN request_content_type TEXT` wrapped in try/catch (column already exists → SQLITE_ERROR, ignore).
- The `event.data.contentType` on `network_request` events comes from the CDP `Network.requestWillBeSent` event's `request.headers['Content-Type']` or from `postDataEntries`. This is already captured in the event data by the recorder.

**Acceptance Criteria**:
- [ ] `network_bodies` table has `request_content_type` column
- [ ] `insertNetworkBody` accepts and stores `requestContentType`
- [ ] `NetworkBodyRow` type includes `request_content_type`
- [ ] Existing databases get the new column via migration
- [ ] Network extractor passes request content type from event data

---

### Unit 3: Marker ID in Overview Output

**File**: `src/browser/investigation/renderers.ts`

Add marker ID to the overview marker line format.

```typescript
// BEFORE (line 40):
markerLines.push(`  ${prefix} ${formatTime(m.timestamp)} — ${m.label ?? "unmarked"}${sev}`);

// AFTER:
markerLines.push(`  ${prefix} ${formatTime(m.timestamp)} — ${m.label ?? "unmarked"}${sev}  (id: ${m.id})`);
```

**Implementation Notes**:
- This mirrors the pattern already used in `formatSearchResultLine` (line 143) which appends `(id: ${r.event_id})`.
- The marker ID is essential for agents to use `session_inspect(marker_id: ...)` or `session_search(around_marker: ...)`.

**Acceptance Criteria**:
- [ ] Overview output includes marker ID: `[user] 01:50:39.742 — form submitted (id: abc-123)`
- [ ] Existing renderer test for marker rendering is updated
- [ ] Agent can copy the marker ID from overview and use it in `session_inspect` or `session_search`

---

### Unit 4: Unified Marker Lookup (ID or Label)

**File**: `src/browser/investigation/query-engine.ts`

Extract marker resolution into a shared helper and use it in all three locations: `search`, `inspect`, and `getOverview`.

```typescript
// New private method on QueryEngine:
/**
 * Resolve a marker reference by ID or label.
 * Tries exact ID match first, then label match.
 */
private resolveMarker(sessionId: string, ref: string): MarkerRow {
	// Try direct ID lookup first (fast path — uses primary key)
	try {
		return this.db.getMarkerById(ref);
	} catch {
		// Not found by ID — try label match
	}
	const markers = this.db.queryMarkers(sessionId);
	const byLabel = markers.find((m) => m.label === ref);
	if (byLabel) return byLabel;
	throw new Error(`Marker not found: "${ref}". Use a marker ID or label from session_overview.`);
}
```

Replace the three inconsistent lookup sites:

```typescript
// In search() — line 114:
// BEFORE:
const marker = markers.find((m) => m.id === ref || m.label === ref);
// AFTER:
const marker = this.resolveMarker(sessionId, ref!);

// In inspect() — line 219:
// BEFORE:
const marker = this.db.getMarkerById(params.markerId);
// AFTER:
const marker = this.resolveMarker(sessionId, params.markerId);

// In getOverview() — line 90:
// BEFORE:
const marker = markers.find((m) => m.id === options.aroundMarker);
// AFTER:
const marker = this.resolveMarker(sessionId, options.aroundMarker);
```

**Implementation Notes**:
- Fast path: try `getMarkerById` first (primary key lookup). Only fall back to label scan if ID not found.
- The error message now explicitly guides the agent to use marker IDs from `session_overview`.
- `getOverview` currently silently ignores unknown markers (no throw). Change to throw so agents get clear feedback.

**Acceptance Criteria**:
- [ ] `session_inspect(marker_id: "form submitted")` works when a marker has that label
- [ ] `session_search(around_marker: "form submitted")` still works
- [ ] `session_overview(around_marker: "form submitted")` works
- [ ] Exact ID match is tried first (fast path)
- [ ] Clear error message when marker not found by ID or label
- [ ] `getOverview` throws on unknown marker instead of silently ignoring

---

### Unit 5: Wall-Clock Timestamp Resolution

**File**: `src/browser/investigation/resolve-timestamp.ts`

Add support for `HH:mm:ss.SSS` (and `HH:mm:ss`) format, resolved relative to the session's start date.

```typescript
import type { QueryEngine } from "./query-engine.js";

/**
 * Resolve a timestamp reference to epoch ms.
 *
 * Accepts:
 * - Pure numeric string: treated as epoch ms
 * - ISO timestamp: "2024-01-01T12:00:00Z" → epoch ms
 * - Wall-clock time: "HH:mm:ss" or "HH:mm:ss.SSS" → resolved relative to session start date
 * - Event ID (UUID): looks up the event's timestamp via queryEngine
 *
 * @throws Error if the reference cannot be resolved
 */
export function resolveTimestamp(queryEngine: QueryEngine, sessionId: string, ref: string): number {
	// Pure numeric string → epoch ms
	if (/^\d+$/.test(ref)) return Number(ref);

	// ISO timestamp (YYYY-MM-DD prefix or contains T+zone offset)
	if (/^\d{4}-\d{2}-\d{2}/.test(ref) || (ref.includes("T") && ref.includes("-"))) {
		return new Date(ref).getTime();
	}

	// Wall-clock time: HH:mm:ss or HH:mm:ss.SSS
	const wallClockMatch = ref.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
	if (wallClockMatch) {
		const session = queryEngine.getSession(sessionId);
		const sessionStartDate = new Date(session.started_at);
		// Use the session start date as the calendar date context
		const resolved = new Date(sessionStartDate);
		resolved.setUTCHours(
			Number.parseInt(wallClockMatch[1], 10),
			Number.parseInt(wallClockMatch[2], 10),
			Number.parseInt(wallClockMatch[3], 10),
			wallClockMatch[4] ? Number.parseInt(wallClockMatch[4].padEnd(3, "0"), 10) : 0,
		);
		// Handle day rollover: if resolved time is before session start, add a day
		if (resolved.getTime() < session.started_at) {
			resolved.setUTCDate(resolved.getUTCDate() + 1);
		}
		return resolved.getTime();
	}

	// Event ID — look up by event_id
	const event = queryEngine.getFullEvent(sessionId, ref);
	if (event) return event.timestamp;

	throw new Error(
		`Cannot resolve "${ref}" to a timestamp or event. ` +
			"Accepted formats: ISO timestamp (2024-01-01T12:00:00Z), wall-clock time (01:50:39.742), epoch ms, or event ID.",
	);
}
```

**Implementation Notes**:
- Wall-clock times are resolved using the session's start date as calendar context. This is correct because `formatTime` strips the date from ISO timestamps, so the overview displays times relative to the same day(s) as the session.
- Day rollover handling: if a session starts at 23:50 and the agent references `00:05:12`, we assume it's the next day.
- The regex `^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$` matches exactly the output format of `formatTime()`, ensuring copy-paste works.
- Millisecond component is padded to 3 digits for consistency (e.g., `.7` → `.700`).
- `queryEngine.getSession(sessionId)` is called to get the start date. This is the same `sessionId` already resolved by the caller.

**Acceptance Criteria**:
- [ ] `resolveTimestamp(engine, sid, "01:50:39.742")` returns correct epoch ms matching `formatTime` output
- [ ] `resolveTimestamp(engine, sid, "01:50:39")` works without milliseconds
- [ ] Day rollover: session starts at `23:50:00`, input `00:05:12` resolves to next day
- [ ] Existing ISO and epoch ms inputs still work
- [ ] Event ID lookup still works
- [ ] Error message now mentions wall-clock format as accepted
- [ ] `session_inspect(timestamp: "01:50:39.742")` works end-to-end
- [ ] `session_diff(from: "01:50:39", to: "01:52:14")` works end-to-end

---

### Unit 6: Update Tool Descriptions

**File**: `src/mcp/tools/browser.ts`

Update the Zod `.describe()` strings to reflect expanded capabilities:

```typescript
// session_inspect — marker_id description (line 362):
// BEFORE:
marker_id: z.string().optional().describe("Jump to a marker"),
// AFTER:
marker_id: z.string().optional().describe("Jump to a marker — accepts marker ID or label from session_overview"),

// session_inspect — timestamp description (line 363):
// BEFORE:
timestamp: z.string().optional().describe("ISO timestamp — inspect the moment closest to this time"),
// AFTER:
timestamp: z.string().optional().describe("Timestamp — ISO format, wall-clock (HH:mm:ss.SSS from overview), or epoch ms"),

// session_search — around_marker description (line 316):
// BEFORE:
around_marker: z.string().optional().describe("Center search around this marker ID (±120s before, +30s after)"),
// AFTER:
around_marker: z.string().optional().describe("Center search around a marker — accepts marker ID or label (±120s before, +30s after)"),

// session_overview — around_marker description (line 286):
// BEFORE:
around_marker: z.string().optional().describe("Center overview on this marker ID"),
// AFTER:
around_marker: z.string().optional().describe("Center overview on a marker — accepts marker ID or label"),

// session_diff — from/to descriptions (lines 387-388):
// BEFORE:
from: z.string().describe("First moment — ISO timestamp or event ID"),
to: z.string().describe("Second moment — ISO timestamp or event ID"),
// AFTER:
from: z.string().describe("First moment — ISO timestamp, wall-clock (HH:mm:ss.SSS), epoch ms, or event ID"),
to: z.string().describe("Second moment — ISO timestamp, wall-clock (HH:mm:ss.SSS), epoch ms, or event ID"),

// session_replay_context — around_marker description (line 407):
// BEFORE:
around_marker: z.string().optional().describe("Focus on events around this marker"),
// AFTER:
around_marker: z.string().optional().describe("Focus on events around this marker — accepts marker ID or label"),
```

**Implementation Notes**:
- Tool descriptions are the primary documentation agents see. Making them accurate about accepted formats prevents the trial-and-error the reporting agent experienced.

**Acceptance Criteria**:
- [ ] All `marker_id` and `around_marker` descriptions mention both ID and label
- [ ] All `timestamp`, `from`, `to` descriptions mention wall-clock format
- [ ] Descriptions are concise (not overly verbose)

---

## Implementation Order

1. **Unit 2: Store Request Content Type** — DB schema change needed before Unit 1 can use `request_content_type`
2. **Unit 1: Binary-Safe Network Body Reading** — P0 fix, depends on Unit 2 for request CT
3. **Unit 4: Unified Marker Lookup** — independent, enables Unit 3 and Unit 6
4. **Unit 3: Marker ID in Overview Output** — simple rendering change
5. **Unit 5: Wall-Clock Timestamp Resolution** — independent
6. **Unit 6: Update Tool Descriptions** — last, references all new capabilities

## Testing

### Unit Tests: `tests/unit/browser/query-engine.test.ts`

Add tests to the existing `inspect` describe block:

```typescript
describe("inspect — binary body handling", () => {
	it("returns placeholder for binary response body (image/png)", () => {
		// Setup: write a binary file to network dir, insert network_body ref with content_type: "image/png"
		// Assert: result.networkBody.response === "<binary: image/png, ...>"
	});

	it("returns text for JSON response body", () => {
		// Setup: write JSON string to network dir, content_type: "application/json"
		// Assert: result.networkBody.response contains the JSON string
	});

	it("returns placeholder for multipart/form-data request body", () => {
		// Setup: write binary to req file, request_content_type: "multipart/form-data"
		// Assert: result.networkBody.request === "<binary: multipart/form-data, unknown size>"
	});

	it("returns placeholder when content type is null", () => {
		// Assert: "<binary: unknown type, ...>"
	});
});

describe("inspect — marker_id accepts label", () => {
	it("resolves marker by label", () => {
		// Setup: insert marker with label "form submitted"
		// Assert: inspect({ markerId: "form submitted" }) resolves to event near that marker
	});

	it("prefers ID over label when both match", () => {
		// Edge case: marker ID happens to match another marker's label
	});
});
```

### Unit Tests: `tests/unit/browser/resolve-timestamp.test.ts` (new file)

```typescript
describe("resolveTimestamp", () => {
	it("resolves epoch ms string", () => { ... });
	it("resolves ISO timestamp", () => { ... });
	it("resolves wall-clock HH:mm:ss.SSS relative to session start", () => { ... });
	it("resolves wall-clock HH:mm:ss without ms", () => { ... });
	it("handles day rollover (session starts near midnight)", () => { ... });
	it("resolves event ID", () => { ... });
	it("throws on unresolvable reference", () => { ... });
});
```

### Unit Tests: `tests/unit/browser/renderers.test.ts`

Update existing marker rendering tests:

```typescript
it("includes marker ID in overview output", () => {
	const overview = makeOverview({
		markers: [{ id: "m-123", label: "form submitted", timestamp: BASE_TS, ... }],
	});
	const output = renderSessionOverview(overview);
	expect(output).toContain("(id: m-123)");
});
```

### Unit Tests: Binary detection helpers

```typescript
describe("isTextContentType", () => {
	it.each([
		["application/json", true],
		["application/json; charset=utf-8", true],
		["text/html", true],
		["text/plain", true],
		["application/x-www-form-urlencoded", true],
		["application/ld+json", true],
		["application/xml", true],
		["image/png", false],
		["image/jpeg", false],
		["application/octet-stream", false],
		["multipart/form-data", false],
		["application/pdf", false],
		[null, false],
		[undefined, false],
	])("isTextContentType(%s) === %s", (input, expected) => {
		expect(isTextContentType(input)).toBe(expected);
	});
});
```

## Verification Checklist

```bash
bun run test:unit                    # All unit tests pass
bun run test:integration             # Integration tests unchanged
bun run lint                         # Biome check passes
bun run build                        # Compiles cleanly
```

Manual verification:
1. Record a session with file upload (binary POST body) → `session_inspect` on the upload event returns placeholder, not JSON error
2. `session_overview` output shows marker IDs
3. Copy a wall-clock time from overview → paste into `session_inspect(timestamp: ...)` → succeeds
4. `session_inspect(marker_id: "label text")` works
