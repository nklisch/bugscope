import { beforeEach, describe, expect, it } from "vitest";
import { EventNormalizer } from "../../../src/browser/recorder/event-normalizer.js";

describe("EventNormalizer WebSocket lifecycle", () => {
	let normalizer: EventNormalizer;

	beforeEach(() => {
		normalizer = new EventNormalizer();
	});

	it("normalizes webSocketCreated to websocket event with type='open'", () => {
		const event = normalizer.normalize(
			"Network.webSocketCreated",
			{ requestId: "ws1", url: "wss://example.com/ws" },
			"tab1",
		);

		expect(event).not.toBeNull();
		expect(event?.type).toBe("websocket");
		expect(event?.data.type).toBe("open");
		expect(event?.data.url).toBe("wss://example.com/ws");
		expect(event?.data.requestId).toBe("ws1");
		expect(event?.summary).toBe("WS open: wss://example.com/ws");
	});

	it("normalizes webSocketClosed to websocket event with type='close' and correct URL", () => {
		// First create the WS so the URL is tracked
		normalizer.normalize("Network.webSocketCreated", { requestId: "ws2", url: "wss://chat.example.com/live" }, "tab1");

		const event = normalizer.normalize(
			"Network.webSocketClosed",
			{ requestId: "ws2", timestamp: 123456789 },
			"tab1",
		);

		expect(event).not.toBeNull();
		expect(event?.type).toBe("websocket");
		expect(event?.data.type).toBe("close");
		expect(event?.data.url).toBe("wss://chat.example.com/live");
		expect(event?.summary).toBe("WS close: wss://chat.example.com/live");
	});

	it("normalizes loadingFailed for WebSocket to websocket event with type='error'", () => {
		normalizer.normalize("Network.webSocketCreated", { requestId: "ws3", url: "wss://fail.example.com/ws" }, "tab1");

		const event = normalizer.normalize(
			"Network.loadingFailed",
			{ requestId: "ws3", errorText: "net::ERR_CONNECTION_REFUSED" },
			"tab1",
		);

		expect(event).not.toBeNull();
		expect(event?.type).toBe("websocket");
		expect(event?.data.type).toBe("error");
		expect(event?.data.url).toBe("wss://fail.example.com/ws");
		expect(event?.data.errorText).toBe("net::ERR_CONNECTION_REFUSED");
		expect(event?.summary).toContain("WS error:");
		expect(event?.summary).toContain("ERR_CONNECTION_REFUSED");
	});

	it("still normalizes HTTP loadingFailed normally when requestId is not a WebSocket", () => {
		// Register as HTTP request
		normalizer.normalize(
			"Network.requestWillBeSent",
			{ requestId: "http1", request: { url: "https://example.com/api", method: "GET", headers: {} } },
			"tab1",
		);

		const event = normalizer.normalize("Network.loadingFailed", { requestId: "http1", errorText: "net::ERR_TIMED_OUT" }, "tab1");

		expect(event).not.toBeNull();
		expect(event?.type).toBe("network_response");
		expect(event?.data.failed).toBe(true);
		expect(event?.summary).toContain("FAILED");
	});

	it("existing frame normalization (SEND/RECV) is unchanged", () => {
		const sent = normalizer.normalize(
			"Network.webSocketFrameSent",
			{ requestId: "ws4", url: "wss://example.com/ws", response: { payloadData: '{"type":"ping"}' } },
			"tab1",
		);

		expect(sent?.type).toBe("websocket");
		expect(sent?.summary).toContain("WS SEND");
		expect(sent?.data.direction).toBe("SEND");

		const recv = normalizer.normalize(
			"Network.webSocketFrameReceived",
			{ requestId: "ws4", url: "wss://example.com/ws", response: { payloadData: '{"type":"pong"}' } },
			"tab1",
		);

		expect(recv?.type).toBe("websocket");
		expect(recv?.summary).toContain("WS RECV");
		expect(recv?.data.direction).toBe("RECV");
	});

	it("webSocketClosed with unknown requestId produces event with empty URL", () => {
		const event = normalizer.normalize(
			"Network.webSocketClosed",
			{ requestId: "unknown-ws", timestamp: 123 },
			"tab1",
		);

		expect(event).not.toBeNull();
		expect(event?.data.url).toBe("");
	});
});
