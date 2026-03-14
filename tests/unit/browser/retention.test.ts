import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserDatabase } from "../../../src/browser/storage/database.js";
import { RetentionManager } from "../../../src/browser/storage/retention.js";

let tmpDir: string;
let db: BrowserDatabase;
let retention: RetentionManager;

beforeEach(() => {
	tmpDir = resolve(tmpdir(), "krometrail-retention-test-" + crypto.randomUUID());
	mkdirSync(tmpDir, { recursive: true });
	db = new BrowserDatabase(resolve(tmpDir, "index.db"));
	retention = new RetentionManager({ maxAgeDays: 7, cleanupOnStartup: false });
});

afterEach(() => {
	db.close();
});

function makeSessionDir(id: string): string {
	const dir = resolve(tmpDir, "recordings", id);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function createOldSession(id: string, daysOld: number, dir: string): void {
	const startedAt = Date.now() - daysOld * 24 * 60 * 60 * 1000;
	db.createSession({
		id,
		startedAt,
		tabUrl: "https://example.com",
		tabTitle: "Example",
		recordingDir: dir,
	});
}

describe("RetentionManager", () => {
	it("deletes sessions older than maxAgeDays", async () => {
		const dir = makeSessionDir("old-sess");
		createOldSession("old-sess", 10, dir); // 10 days old, exceeds 7-day limit

		const { deleted } = await retention.cleanup(db);

		expect(deleted).toBe(1);
		expect(db.listSessions()).toHaveLength(0);
		expect(existsSync(dir)).toBe(false);
	});

	it("preserves sessions newer than maxAgeDays", async () => {
		const dir = makeSessionDir("new-sess");
		createOldSession("new-sess", 3, dir); // 3 days old, within limit

		const { deleted } = await retention.cleanup(db);

		expect(deleted).toBe(0);
		expect(db.listSessions()).toHaveLength(1);
	});

	it("preserves old sessions with user-placed markers", async () => {
		const dir = makeSessionDir("marked-sess");
		createOldSession("marked-sess", 10, dir);
		db.insertMarker({ id: "m1", sessionId: "marked-sess", timestamp: Date.now(), autoDetected: false });

		const { deleted } = await retention.cleanup(db);

		expect(deleted).toBe(0);
		expect(existsSync(dir)).toBe(true);
	});

	it("does not preserve sessions with only auto-detected markers", async () => {
		const dir = makeSessionDir("auto-sess");
		createOldSession("auto-sess", 10, dir);
		db.insertMarker({ id: "m1", sessionId: "auto-sess", timestamp: Date.now(), autoDetected: true, severity: "high" });

		const { deleted } = await retention.cleanup(db);

		expect(deleted).toBe(1);
		expect(existsSync(dir)).toBe(false);
	});

	it("force cleanup deletes even sessions with user markers", async () => {
		const dir = makeSessionDir("force-sess");
		createOldSession("force-sess", 10, dir);
		db.insertMarker({ id: "m1", sessionId: "force-sess", timestamp: Date.now(), autoDetected: false });

		const { deleted } = await retention.cleanup(db, true);

		expect(deleted).toBe(1);
		expect(existsSync(dir)).toBe(false);
	});

	it("handles missing recording_dir gracefully", async () => {
		// Session with non-existent dir
		db.createSession({
			id: "ghost",
			startedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
			tabUrl: "https://ghost.com",
			tabTitle: "Ghost",
			recordingDir: resolve(tmpDir, "nonexistent"),
		});

		// Should not throw even if dir doesn't exist
		const { deleted } = await retention.cleanup(db);
		expect(deleted).toBe(1);
	});

	it("deletes both filesystem and SQLite entries", async () => {
		const dir = makeSessionDir("full-sess");
		createOldSession("full-sess", 10, dir);
		db.insertEvent({
			sessionId: "full-sess",
			eventId: "e1",
			timestamp: Date.now(),
			type: "console",
			summary: "test",
			detailOffset: 0,
			detailLength: 10,
		});
		db.insertMarker({ id: "m1", sessionId: "full-sess", timestamp: Date.now(), autoDetected: true });

		await retention.cleanup(db);

		expect(db.listSessions()).toHaveLength(0);
		expect(db.queryEvents("full-sess", {})).toHaveLength(0);
		expect(db.queryMarkers("full-sess")).toHaveLength(0);
		expect(existsSync(dir)).toBe(false);
	});
});
