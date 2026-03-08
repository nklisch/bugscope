import { beforeEach, describe, expect, it } from "vitest";
import { ALL_DETECTION_RULES, AutoDetector, PHASE_12_DETECTION_RULES } from "../../../src/browser/recorder/auto-detect.js";
import type { RecordedEvent } from "../../../src/browser/types.js";

function makeEvent(type: RecordedEvent["type"], data: Record<string, unknown> = {}, summary = "test"): RecordedEvent {
	return {
		id: crypto.randomUUID(),
		timestamp: Date.now(),
		type,
		tabId: "tab1",
		summary,
		data,
	};
}

describe("Phase 12 Detection Rules", () => {
	let detector: AutoDetector;

	beforeEach(() => {
		detector = new AutoDetector(PHASE_12_DETECTION_RULES);
	});

	describe("Failed form submission heuristic", () => {
		it("fires when submit is followed by 4xx within 3 seconds", () => {
			const submitEvent = makeEvent("user_input", { type: "submit", selector: "#login-form" });
			const responseEvent = makeEvent("network_response", { status: 422 });
			responseEvent.timestamp = submitEvent.timestamp + 2000; // 2s later

			const markers = detector.check(submitEvent, [responseEvent]);
			expect(markers.some((m) => m.label.includes("Form submission failed"))).toBe(true);
			expect(markers.some((m) => m.severity === "high")).toBe(true);
		});

		it("does not fire when submit is followed by 2xx", () => {
			const submitEvent = makeEvent("user_input", { type: "submit", selector: "#form" });
			const responseEvent = makeEvent("network_response", { status: 200 });
			responseEvent.timestamp = submitEvent.timestamp + 500;

			const markers = detector.check(submitEvent, [responseEvent]);
			expect(markers.filter((m) => m.label.includes("Form submission failed"))).toHaveLength(0);
		});

		it("does not fire when 4xx comes more than 3 seconds after submit", () => {
			const submitEvent = makeEvent("user_input", { type: "submit", selector: "#form" });
			const responseEvent = makeEvent("network_response", { status: 400 });
			responseEvent.timestamp = submitEvent.timestamp + 5000; // 5s later — too slow

			const markers = detector.check(submitEvent, [responseEvent]);
			expect(markers.filter((m) => m.label.includes("Form submission failed"))).toHaveLength(0);
		});

		it("does not fire for non-submit user_input events", () => {
			const clickEvent = makeEvent("user_input", { type: "click", selector: "#button" });
			const responseEvent = makeEvent("network_response", { status: 400 });
			responseEvent.timestamp = clickEvent.timestamp + 100;

			const markers = detector.check(clickEvent, [responseEvent]);
			expect(markers.filter((m) => m.label.includes("Form submission failed"))).toHaveLength(0);
		});
	});

	describe("Rapid retry detection", () => {
		it("fires after 3+ requests to the same URL within 5 seconds", () => {
			const url = "https://api.example.com/retry";
			const now = Date.now();
			const recent: RecordedEvent[] = [makeEvent("network_request", { url }), makeEvent("network_request", { url }), makeEvent("network_request", { url })];
			recent.forEach((e, i) => {
				e.timestamp = now - (3 - i) * 1000;
			});

			const currentRequest = makeEvent("network_request", { url });
			currentRequest.timestamp = now;

			const markers = detector.check(currentRequest, recent);
			expect(markers.some((m) => m.label.includes("Rapid retries"))).toBe(true);
			expect(markers.some((m) => m.severity === "medium")).toBe(true);
		});

		it("does not fire for fewer than 3 prior requests", () => {
			const url = "https://api.example.com/normal";
			const now = Date.now();
			const recent: RecordedEvent[] = [makeEvent("network_request", { url }), makeEvent("network_request", { url })];
			recent.forEach((e) => {
				e.timestamp = now - 1000;
			});

			const currentRequest = makeEvent("network_request", { url });
			currentRequest.timestamp = now;

			const markers = detector.check(currentRequest, recent);
			expect(markers.filter((m) => m.label.includes("Rapid retries"))).toHaveLength(0);
		});

		it("does not fire for different URLs", () => {
			const now = Date.now();
			const recent: RecordedEvent[] = [
				makeEvent("network_request", { url: "https://api.example.com/url1" }),
				makeEvent("network_request", { url: "https://api.example.com/url2" }),
				makeEvent("network_request", { url: "https://api.example.com/url3" }),
			];
			recent.forEach((e) => {
				e.timestamp = now - 1000;
			});

			const currentRequest = makeEvent("network_request", { url: "https://api.example.com/url4" });
			currentRequest.timestamp = now;

			const markers = detector.check(currentRequest, recent);
			expect(markers.filter((m) => m.label.includes("Rapid retries"))).toHaveLength(0);
		});
	});

	describe("Large CLS detection", () => {
		it("fires when CLS exceeds 0.25", () => {
			const event = makeEvent("performance", { metric: "CLS", value: 0.3 });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("Large layout shift"))).toBe(true);
			expect(markers.some((m) => m.severity === "low")).toBe(true);
		});

		it("does not fire when CLS is below threshold", () => {
			const event = makeEvent("performance", { metric: "CLS", value: 0.1 });
			const markers = detector.check(event, []);
			expect(markers.filter((m) => m.label.includes("layout shift"))).toHaveLength(0);
		});

		it("does not fire for other performance metrics", () => {
			const event = makeEvent("performance", { metric: "LCP", value: 5.0 });
			const markers = detector.check(event, []);
			expect(markers.filter((m) => m.label.includes("layout shift"))).toHaveLength(0);
		});
	});

	describe("WebSocket error detection", () => {
		it("fires on WebSocket error", () => {
			const event = makeEvent("websocket", { type: "error", url: "wss://example.com/ws" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("WebSocket error"))).toBe(true);
			expect(markers.some((m) => m.severity === "medium")).toBe(true);
		});

		it("fires on WebSocket close", () => {
			const event = makeEvent("websocket", { type: "close", url: "wss://example.com/ws" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("WebSocket close"))).toBe(true);
		});

		it("does not fire on WebSocket open or message", () => {
			const openEvent = makeEvent("websocket", { type: "open", url: "wss://example.com/ws" });
			const msgEvent = makeEvent("websocket", { type: "message", url: "wss://example.com/ws" });
			expect(detector.check(openEvent, []).filter((m) => m.label.includes("WebSocket"))).toHaveLength(0);
			expect(detector.check(msgEvent, []).filter((m) => m.label.includes("WebSocket"))).toHaveLength(0);
		});
	});

	describe("Error page navigation detection", () => {
		it("fires when navigating to /404", () => {
			const event = makeEvent("navigation", { url: "https://example.com/404" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("error page"))).toBe(true);
			expect(markers.some((m) => m.severity === "high")).toBe(true);
		});

		it("fires when navigating to /error", () => {
			const event = makeEvent("navigation", { url: "https://example.com/error" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("error page"))).toBe(true);
		});

		it("fires when navigating to /not-found", () => {
			const event = makeEvent("navigation", { url: "https://app.example.com/not-found" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("error page"))).toBe(true);
		});

		it("fires when navigating to /oops (case-insensitive)", () => {
			const event = makeEvent("navigation", { url: "https://example.com/Oops" });
			const markers = detector.check(event, []);
			expect(markers.some((m) => m.label.includes("error page"))).toBe(true);
		});

		it("does not fire for normal page navigation", () => {
			const event = makeEvent("navigation", { url: "https://example.com/dashboard" });
			const markers = detector.check(event, []);
			expect(markers.filter((m) => m.label.includes("error page"))).toHaveLength(0);
		});
	});

	describe("Cooldown behavior", () => {
		it("does not re-fire within cooldown window", () => {
			const url = "wss://example.com/ws";
			const event1 = makeEvent("websocket", { type: "error", url });
			const markers1 = detector.check(event1, []);
			expect(markers1.some((m) => m.label.includes("WebSocket error"))).toBe(true);

			// Immediately fire again — should be suppressed
			const event2 = makeEvent("websocket", { type: "error", url });
			const markers2 = detector.check(event2, []);
			expect(markers2.filter((m) => m.label.includes("WebSocket error"))).toHaveLength(0);
		});
	});
});

describe("ALL_DETECTION_RULES", () => {
	it("contains both default and phase 12 rules", () => {
		const detector = new AutoDetector(ALL_DETECTION_RULES);

		// Should detect 5xx (from DEFAULT_DETECTION_RULES)
		const serverErrorEvent = makeEvent("network_response", { status: 503, method: "GET", url: "/api" });
		const serverMarkers = detector.check(serverErrorEvent, []);
		expect(serverMarkers.some((m) => m.label.includes("Server error"))).toBe(true);

		// Need fresh detector for cooldown (500 fires both 5xx AND 4xx rules otherwise)
		const freshDetector = new AutoDetector(ALL_DETECTION_RULES);
		// Should detect error page navigation (from PHASE_12_DETECTION_RULES)
		const errorPageEvent = makeEvent("navigation", { url: "https://example.com/500" });
		const errorPageMarkers = freshDetector.check(errorPageEvent, []);
		expect(errorPageMarkers.some((m) => m.label.includes("error page"))).toBe(true);
	});
});
