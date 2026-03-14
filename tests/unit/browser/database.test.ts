import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserDatabase } from "../../../src/browser/storage/database.js";
import { EventWriter } from "../../../src/browser/storage/event-writer.js";
import type { RecordedEvent } from "../../../src/browser/types.js";

let db: BrowserDatabase;
let tmpDir: string;

beforeEach(() => {
	tmpDir = resolve(tmpdir(), "krometrail-db-test-" + crypto.randomUUID());
	mkdirSync(tmpDir, { recursive: true });
	db = new BrowserDatabase(resolve(tmpDir, "test.db"));
});

afterEach(() => {
	db.close();
});

function makeSession(id = "sess1") {
	return {
		id,
		startedAt: 1709826622000,
		tabUrl: "https://example.com",
		tabTitle: "Example",
		recordingDir: resolve(tmpDir, id),
	};
}

function makeEventRow(sessionId: string, i: number, type = "console") {
	return {
		sessionId,
		eventId: `evt${i}`,
		timestamp: 1709826622000 + i * 1000,
		type,
		summary: `Event ${i} summary text`,
		detailOffset: i * 100,
		detailLength: 99,
	};
}

describe("BrowserDatabase schema", () => {
	it("creates schema without error", () => {
		// Constructor runs migration; if we get here, it worked
		expect(db).toBeDefined();
	});

	it("can create and retrieve a session", () => {
		db.createSession(makeSession());
		const sessions = db.listSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe("sess1");
		expect(sessions[0].tab_url).toBe("https://example.com");
	});
});

describe("session CRUD", () => {
	it("listSessions filters by before", () => {
		db.createSession(makeSession("old"));
		const oldSess = db.listSessions()[0];
		expect(oldSess.started_at).toBeLessThan(Date.now());

		const results = db.listSessions({ before: oldSess.started_at + 1 });
		expect(results.map((s) => s.id)).toContain("old");

		const empty = db.listSessions({ before: oldSess.started_at - 1 });
		expect(empty).toHaveLength(0);
	});

	it("listSessions filters by urlContains", () => {
		db.createSession(makeSession("a"));
		db.createSession({ ...makeSession("b"), tabUrl: "https://other.com" });

		const result = db.listSessions({ urlContains: "example.com" });
		expect(result.map((s) => s.id)).toEqual(["a"]);
	});

	it("endSession sets ended_at", () => {
		db.createSession(makeSession());
		const endedAt = Date.now();
		db.endSession("sess1", endedAt);

		const sessions = db.listSessions();
		expect(sessions[0].ended_at).toBe(endedAt);
	});

	it("deleteSession removes all related data", () => {
		db.createSession(makeSession());
		db.insertEvent(makeEventRow("sess1", 1));
		db.insertMarker({ id: "m1", sessionId: "sess1", timestamp: Date.now(), autoDetected: false });

		db.deleteSession("sess1");

		expect(db.listSessions()).toHaveLength(0);
		expect(db.queryEvents("sess1", {})).toHaveLength(0);
		expect(db.queryMarkers("sess1")).toHaveLength(0);
	});
});

describe("event insertion and query", () => {
	beforeEach(() => {
		db.createSession(makeSession());
	});

	it("insertEvent and queryEvents round-trip", () => {
		db.insertEvent(makeEventRow("sess1", 1));
		const events = db.queryEvents("sess1", {});
		expect(events).toHaveLength(1);
		expect(events[0].event_id).toBe("evt1");
	});

	it("insertEventBatch inserts all events", () => {
		const batch = Array.from({ length: 10 }, (_, i) => makeEventRow("sess1", i));
		db.insertEventBatch(batch);
		expect(db.queryEvents("sess1", {})).toHaveLength(10);
	});

	it("ignores duplicate event_id", () => {
		db.insertEvent(makeEventRow("sess1", 1));
		db.insertEvent(makeEventRow("sess1", 1)); // duplicate
		expect(db.queryEvents("sess1", {})).toHaveLength(1);
	});

	it("queryEvents filters by type", () => {
		db.insertEvent(makeEventRow("sess1", 1, "console"));
		db.insertEvent(makeEventRow("sess1", 2, "network_response"));
		db.insertEvent(makeEventRow("sess1", 3, "console"));

		const result = db.queryEvents("sess1", { types: ["console"] });
		expect(result).toHaveLength(2);
		expect(result.every((e) => e.type === "console")).toBe(true);
	});

	it("queryEvents filters by time range", () => {
		const base = 1709826622000;
		db.insertEventBatch([
			{ ...makeEventRow("sess1", 1), timestamp: base + 1000 },
			{ ...makeEventRow("sess1", 2), timestamp: base + 2000 },
			{ ...makeEventRow("sess1", 3), timestamp: base + 3000 },
		]);

		const result = db.queryEvents("sess1", { timeRange: { start: base + 1500, end: base + 2500 } });
		expect(result).toHaveLength(1);
		expect(result[0].event_id).toBe("evt2");
	});

	it("updateSessionCounts reflects inserted events", () => {
		db.insertEventBatch(Array.from({ length: 5 }, (_, i) => makeEventRow("sess1", i)));
		db.insertMarker({ id: "m1", sessionId: "sess1", timestamp: Date.now(), autoDetected: false });
		db.updateSessionCounts("sess1");

		const sessions = db.listSessions();
		expect(sessions[0].event_count).toBe(5);
		expect(sessions[0].marker_count).toBe(1);
	});

	it("batch insert performance: 1000 events", () => {
		const batch = Array.from({ length: 1000 }, (_, i) => makeEventRow("sess1", i));
		const start = Date.now();
		db.insertEventBatch(batch);
		const elapsed = Date.now() - start;
		expect(db.queryEvents("sess1", { limit: 1 })).toHaveLength(1);
		expect(elapsed).toBeLessThan(5000); // Should be well under 5s
	});
});

describe("marker insertion and query", () => {
	beforeEach(() => {
		db.createSession(makeSession());
	});

	it("insertMarker and queryMarkers round-trip", () => {
		db.insertMarker({ id: "m1", sessionId: "sess1", timestamp: 1709826622000, label: "test marker", autoDetected: false, severity: undefined });
		const markers = db.queryMarkers("sess1");
		expect(markers).toHaveLength(1);
		expect(markers[0].id).toBe("m1");
		expect(markers[0].label).toBe("test marker");
		expect(markers[0].auto_detected).toBe(0);
	});

	it("auto_detected flag persisted correctly", () => {
		db.insertMarker({ id: "m1", sessionId: "sess1", timestamp: Date.now(), autoDetected: true, severity: "high" });
		const markers = db.queryMarkers("sess1");
		expect(markers[0].auto_detected).toBe(1);
		expect(markers[0].severity).toBe("high");
	});

	it("listSessions filters by hasMarkers", () => {
		db.createSession({ ...makeSession("b"), tabUrl: "https://b.com" });
		db.insertMarker({ id: "m1", sessionId: "sess1", timestamp: Date.now(), autoDetected: false });

		const result = db.listSessions({ hasMarkers: true });
		// Note: updateSessionCounts needed for marker_count to be accurate
		db.updateSessionCounts("sess1");
		db.updateSessionCounts("b");
		const result2 = db.listSessions({ hasMarkers: true });
		expect(result2.map((s) => s.id)).toContain("sess1");
		expect(result2.map((s) => s.id)).not.toContain("b");
	});
});

describe("network body insertion", () => {
	beforeEach(() => {
		db.createSession(makeSession());
	});

	it("insertNetworkBody stores response body path", () => {
		db.insertNetworkBody({
			eventId: "evt1",
			sessionId: "sess1",
			responseBodyPath: "res_abc123_body.bin",
			responseSize: 1234,
			contentType: "application/json",
		});
		// No direct query method yet, but insert shouldn't throw
	});
});

describe("FTS search", () => {
	beforeEach(() => {
		db.createSession(makeSession());
	});

	it("searchFTS finds events by keyword", () => {
		db.insertEventBatch([
			{ ...makeEventRow("sess1", 1), summary: "network request to /api/users failed" },
			{ ...makeEventRow("sess1", 2), summary: "console error: undefined is not a function" },
			{ ...makeEventRow("sess1", 3), summary: "navigation to /dashboard" },
		]);

		const results = db.searchFTS("sess1", "error");
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((e) => e.summary.includes("error"))).toBe(true);
	});

	it("searchFTS returns empty array for no match", () => {
		db.insertEvent({ ...makeEventRow("sess1", 1), summary: "navigation to home page" });
		const results = db.searchFTS("sess1", "xyznonexistent");
		expect(results).toHaveLength(0);
	});
});

describe("getEventByOffset", () => {
	it("reads event JSON from JSONL file using byte offsets", () => {
		const sessionDir = resolve(tmpDir, "sess1");
		mkdirSync(sessionDir, { recursive: true });

		db.createSession({ ...makeSession("sess1"), recordingDir: sessionDir });

		const jsonlPath = resolve(sessionDir, "events.jsonl");
		const eventWriter = new EventWriter(jsonlPath);
		const event: RecordedEvent = {
			id: "test-evt",
			timestamp: 1709826622000,
			type: "console",
			tabId: "tab1",
			summary: "test",
			data: {},
		};
		const { offset, length } = eventWriter.write(event);
		eventWriter.close();

		const result = db.getEventByOffset("sess1", offset, length);
		const parsed = JSON.parse(result) as RecordedEvent;
		expect(parsed.id).toBe("test-evt");
	});
});
