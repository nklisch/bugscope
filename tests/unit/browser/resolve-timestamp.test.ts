import { describe, expect, it, vi } from "vitest";
import type { QueryEngine } from "../../../src/browser/investigation/query-engine.js";
import { resolveTimestamp } from "../../../src/browser/investigation/resolve-timestamp.js";

function makeQueryEngine(sessionStartedAt: number, fullEvent?: { timestamp: number } | null): QueryEngine {
	return {
		getSession: vi.fn().mockReturnValue({ started_at: sessionStartedAt }),
		getFullEvent: vi.fn().mockReturnValue(fullEvent ?? null),
	} as unknown as QueryEngine;
}

describe("resolveTimestamp", () => {
	it("parses pure numeric string as epoch ms", () => {
		const qe = makeQueryEngine(0);
		const epochMs = 1704110400000;
		expect(resolveTimestamp(qe, "session-1", String(epochMs))).toBe(epochMs);
	});

	it("parses ISO timestamp to epoch ms", () => {
		const qe = makeQueryEngine(0);
		const iso = "2024-01-01T12:00:00.000Z";
		expect(resolveTimestamp(qe, "session-1", iso)).toBe(new Date(iso).getTime());
	});

	it("parses YYYY-MM-DD ISO date prefix", () => {
		const qe = makeQueryEngine(0);
		const iso = "2024-06-15T00:00:00Z";
		expect(resolveTimestamp(qe, "session-1", iso)).toBe(new Date(iso).getTime());
	});

	it("rejects HH:MM:SS relative timestamps", () => {
		const qe = makeQueryEngine(0, null);
		expect(() => resolveTimestamp(qe, "session-1", "00:05:30")).toThrow("Cannot resolve");
	});

	it("resolves event_id via queryEngine lookup", () => {
		const eventTimestamp = 1704110400123;
		const qe = makeQueryEngine(0, { timestamp: eventTimestamp });
		const eventId = "a1b2c3d4-0000-0000-0000-000000000001";

		expect(resolveTimestamp(qe, "session-1", eventId)).toBe(eventTimestamp);
		expect(qe.getFullEvent).toHaveBeenCalledWith("session-1", eventId);
	});

	it("throws on unresolvable reference", () => {
		const qe = makeQueryEngine(0, null);
		expect(() => resolveTimestamp(qe, "session-1", "not-a-known-event-id")).toThrow('Cannot resolve "not-a-known-event-id"');
	});
});
