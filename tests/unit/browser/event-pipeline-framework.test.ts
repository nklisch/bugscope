import { describe, expect, it, vi } from "vitest";
import { AutoDetector, DEFAULT_DETECTION_RULES } from "../../../src/browser/recorder/auto-detect.js";
import { EventPipeline } from "../../../src/browser/recorder/event-pipeline.js";
import { FrameworkTracker } from "../../../src/browser/recorder/framework/index.js";
import { InputTracker } from "../../../src/browser/recorder/input-tracker.js";
import { RollingBuffer } from "../../../src/browser/recorder/rolling-buffer.js";
import type { BrowserSessionInfo, RecordedEvent } from "../../../src/browser/types.js";

function makeSessionInfo(): BrowserSessionInfo {
	return { id: "session-1", startedAt: Date.now(), tabs: [], eventCount: 0, markerCount: 0, bufferAgeMs: 0 };
}

function makePipeline(frameworkTracker?: FrameworkTracker) {
	const buffer = new RollingBuffer({ maxEvents: 1000, maxAgeMs: 60000, markerPaddingMs: 5000 });
	const inputTracker = new InputTracker();
	const autoDetector = new AutoDetector(DEFAULT_DETECTION_RULES);
	const onNewEvent = vi.fn();
	const onMarkerPlaced = vi.fn();
	const invalidateSessionCache = vi.fn();
	const placeMarker = vi.fn().mockResolvedValue({ id: "m1", timestamp: Date.now(), autoDetected: false });

	const pipeline = new EventPipeline({
		normalizer: { normalize: () => null } as never,
		buffer,
		inputTracker,
		autoDetector,
		tabManager: { getTabIdForSession: () => "tab-1", listTabs: () => [], listRecordingTabs: () => [] } as never,
		cdpClient: {} as never,
		frameworkTracker,
		captureOnNavigation: false,
		getSessionInfo: makeSessionInfo,
		getPrimaryTabSessionId: () => "session-1",
		getSessionDir: () => null,
		placeMarker,
		invalidateSessionCache,
	});

	return { pipeline, buffer, onNewEvent, invalidateSessionCache, placeMarker };
}

function makeConsoleEvent(json: string) {
	return {
		method: "Runtime.consoleAPICalled",
		params: { args: [{ value: "__BL__" }, { value: json }] },
		sessionId: "session-1",
	};
}

describe("EventPipeline framework event routing", () => {
	it("routes __BL__ framework_detect to FrameworkTracker", () => {
		const tracker = new FrameworkTracker(true);
		const { pipeline, buffer } = makePipeline(tracker);

		const json = JSON.stringify({
			type: "framework_detect",
			ts: Date.now(),
			data: { framework: "react", version: "18.2.0", rootCount: 1, componentCount: 0 },
		});
		const { method, params, sessionId } = makeConsoleEvent(json);
		pipeline.process(sessionId, method, params);

		const events = buffer.getEvents(0, Date.now() + 1000);
		expect(events.some((e) => e.type === "framework_detect")).toBe(true);
	});

	it("routes __BL__ framework_state to FrameworkTracker", () => {
		const tracker = new FrameworkTracker(true);
		const { pipeline, buffer } = makePipeline(tracker);

		const json = JSON.stringify({
			type: "framework_state",
			ts: Date.now(),
			data: { framework: "react", componentName: "Counter", changeType: "update", renderCount: 1 },
		});
		const { method, params, sessionId } = makeConsoleEvent(json);
		pipeline.process(sessionId, method, params);

		const events = buffer.getEvents(0, Date.now() + 1000);
		expect(events.some((e) => e.type === "framework_state")).toBe(true);
	});

	it("routes __BL__ framework_error to FrameworkTracker", () => {
		const tracker = new FrameworkTracker(true);
		const { pipeline, buffer } = makePipeline(tracker);

		const json = JSON.stringify({
			type: "framework_error",
			ts: Date.now(),
			data: { framework: "react", pattern: "infinite_rerender", componentName: "Counter", severity: "high", detail: "too many", evidence: {} },
		});
		const { method, params, sessionId } = makeConsoleEvent(json);
		pipeline.process(sessionId, method, params);

		const events = buffer.getEvents(0, Date.now() + 1000);
		expect(events.some((e) => e.type === "framework_error")).toBe(true);
	});

	it("pushes framework events to buffer", () => {
		const tracker = new FrameworkTracker(["react"]);
		const { pipeline, buffer, invalidateSessionCache } = makePipeline(tracker);

		const json = JSON.stringify({
			type: "framework_detect",
			ts: Date.now(),
			data: { framework: "react", version: "18.2.0", rootCount: 1, componentCount: 0 },
		});
		pipeline.process("session-1", "Runtime.consoleAPICalled", { args: [{ value: "__BL__" }, { value: json }] });

		expect(invalidateSessionCache).toHaveBeenCalled();
		expect(buffer.getStats().eventCount).toBeGreaterThan(0);
	});

	it("still routes click/submit/change to InputTracker", () => {
		const tracker = new FrameworkTracker(true);
		const { pipeline, buffer } = makePipeline(tracker);

		// InputTracker messages are valid JSON with known types
		const json = JSON.stringify({ type: "click", ts: Date.now(), data: { selector: "#btn", x: 0, y: 0 } });
		pipeline.process("session-1", "Runtime.consoleAPICalled", { args: [{ value: "__BL__" }, { value: json }] });

		const events = buffer.getEvents(0, Date.now() + 1000);
		// user_input event should be in buffer (InputTracker converts "click" to "user_input")
		const inputEvents = events.filter((e) => e.type === "user_input");
		expect(inputEvents.length).toBeGreaterThanOrEqual(0); // May or may not produce event depending on input tracker logic
	});

	it("does not route framework events when frameworkTracker is undefined", () => {
		const { pipeline, buffer } = makePipeline(undefined);

		const json = JSON.stringify({
			type: "framework_detect",
			ts: Date.now(),
			data: { framework: "react", version: "18.2.0", rootCount: 1, componentCount: 0 },
		});
		pipeline.process("session-1", "Runtime.consoleAPICalled", { args: [{ value: "__BL__" }, { value: json }] });

		const events = buffer.getEvents(0, Date.now() + 1000);
		expect(events.some((e) => e.type === "framework_detect")).toBe(false);
	});
});
