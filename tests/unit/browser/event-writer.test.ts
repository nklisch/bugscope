import { mkdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventWriter } from "../../../src/browser/storage/event-writer.js";
import type { RecordedEvent } from "../../../src/browser/types.js";

function makeEvent(id: string, summary = "test event"): RecordedEvent {
	return {
		id,
		timestamp: Date.now(),
		type: "console",
		tabId: "tab1",
		summary,
		data: { message: summary },
	};
}

let filePath: string;
let writer: EventWriter;

beforeEach(() => {
	const dir = resolve(tmpdir(), `krometrail-test-${crypto.randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	filePath = resolve(dir, "events.jsonl");
	writer = new EventWriter(filePath);
});

afterEach(() => {
	writer.close();
	try {
		unlinkSync(filePath);
	} catch {}
});

describe("EventWriter", () => {
	it("write returns correct offset and length", () => {
		const event = makeEvent("evt1");
		const { offset, length } = writer.write(event);
		expect(offset).toBe(0);
		expect(length).toBeGreaterThan(0);
	});

	it("write/read round-trip preserves event data", () => {
		const event = makeEvent("evt1", "hello world");
		const { offset, length } = writer.write(event);
		writer.close();

		const read = EventWriter.readAt(filePath, offset, length);
		expect(read.id).toBe(event.id);
		expect(read.summary).toBe(event.summary);
		expect(read.type).toBe(event.type);
	});

	it("sequential writes produce correct offsets", () => {
		const e1 = makeEvent("evt1");
		const e2 = makeEvent("evt2");

		const r1 = writer.write(e1);
		const r2 = writer.write(e2);

		expect(r1.offset).toBe(0);
		expect(r2.offset).toBe(r1.length);
	});

	it("writeBatch returns offsets for each event", () => {
		const events = [makeEvent("e1"), makeEvent("e2"), makeEvent("e3")];
		const offsets = writer.writeBatch(events);

		expect(offsets).toHaveLength(3);
		expect(offsets[0].offset).toBe(0);
		expect(offsets[1].offset).toBe(offsets[0].length);
		expect(offsets[2].offset).toBe(offsets[0].length + offsets[1].length);
	});

	it("readAt retrieves correct event from multi-event file", () => {
		const e1 = makeEvent("evt-first", "first event");
		const e2 = makeEvent("evt-second", "second event");
		const e3 = makeEvent("evt-third", "third event");

		const [r1, r2, r3] = writer.writeBatch([e1, e2, e3]);
		writer.close();

		expect(EventWriter.readAt(filePath, r1.offset, r1.length).id).toBe("evt-first");
		expect(EventWriter.readAt(filePath, r2.offset, r2.length).id).toBe("evt-second");
		expect(EventWriter.readAt(filePath, r3.offset, r3.length).id).toBe("evt-third");
	});

	it("handles events with complex data", () => {
		const event: RecordedEvent = {
			id: "complex",
			timestamp: 1709826622000,
			type: "network_response",
			tabId: "tab1",
			summary: "GET /api/data → 200 OK (1.2kb)",
			data: { url: "https://example.com/api/data", status: 200, contentType: "application/json", size: 1234 },
		};

		const { offset, length } = writer.write(event);
		writer.close();

		const read = EventWriter.readAt(filePath, offset, length);
		expect(read.data.status).toBe(200);
		expect(read.data.url).toBe("https://example.com/api/data");
	});
});
