import { beforeEach, describe, expect, it } from "vitest";
import { AutoDetector, FRAMEWORK_DETECTION_RULES } from "../../../src/browser/recorder/auto-detect.js";
import type { RecordedEvent } from "../../../src/browser/types.js";

function makeEvent(type: RecordedEvent["type"], data: Record<string, unknown> = {}): RecordedEvent {
	return {
		id: crypto.randomUUID(),
		timestamp: Date.now(),
		type,
		tabId: "tab1",
		summary: "test",
		data,
	};
}

describe("FRAMEWORK_DETECTION_RULES", () => {
	let detector: AutoDetector;

	beforeEach(() => {
		detector = new AutoDetector(FRAMEWORK_DETECTION_RULES);
	});

	it("fires low-severity marker on framework_detect event", () => {
		const event = makeEvent("framework_detect", { framework: "react", version: "18.2.0" });
		const markers = detector.check(event, []);
		expect(markers).toHaveLength(1);
		expect(markers[0].severity).toBe("low");
		expect(markers[0].label).toContain("react");
	});

	it("fires high-severity marker on framework_error with severity=high", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "infinite_rerender",
			componentName: "Counter",
			severity: "high",
			detail: "Re-rendered 100 times",
			evidence: {},
		});
		const markers = detector.check(event, []);
		expect(markers.some((m) => m.severity === "high")).toBe(true);
	});

	it("fires medium-severity marker on framework_error with severity=medium", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "stale_closure",
			componentName: "MyComponent",
			severity: "medium",
			detail: "Stale value captured",
			evidence: {},
		});
		const markers = detector.check(event, []);
		expect(markers.some((m) => m.severity === "medium")).toBe(true);
	});

	it("does not fire on framework_error with severity=low", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "missing_cleanup",
			componentName: "MyComponent",
			severity: "low",
			detail: "Effect cleanup missing",
			evidence: {},
		});
		const markers = detector.check(event, []);
		expect(markers).toHaveLength(0);
	});

	it("does not fire on non-framework event types", () => {
		const event = makeEvent("navigation", { url: "https://example.com" });
		const markers = detector.check(event, []);
		expect(markers).toHaveLength(0);
	});

	it("respects cooldown on framework_detect (60s)", () => {
		const event = makeEvent("framework_detect", { framework: "react", version: "18.2.0" });
		const first = detector.check(event, []);
		const second = detector.check(event, []);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(0); // Cooldown blocks second fire
	});

	it("respects cooldown on high-severity framework_error (5s)", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "infinite_rerender",
			componentName: "Counter",
			severity: "high",
			detail: "too many",
			evidence: {},
		});
		const first = detector.check(event, []);
		const second = detector.check(event, []);
		// First fires, second is within 5s cooldown
		const highFirst = first.filter((m) => m.severity === "high");
		const highSecond = second.filter((m) => m.severity === "high");
		expect(highFirst).toHaveLength(1);
		expect(highSecond).toHaveLength(0);
	});

	it("label includes framework name for framework_detect", () => {
		const event = makeEvent("framework_detect", { framework: "vue", version: "3.2.0" });
		const markers = detector.check(event, []);
		expect(markers[0].label).toContain("vue");
		expect(markers[0].label).toContain("3.2.0");
	});

	it("high-severity label includes pattern", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "infinite_rerender",
			componentName: "Counter",
			severity: "high",
			detail: "too many renders",
			evidence: {},
		});
		const markers = detector.check(event, []);
		const high = markers.find((m) => m.severity === "high");
		expect(high?.label).toContain("infinite_rerender");
	});

	it("medium-severity label includes component name", () => {
		const event = makeEvent("framework_error", {
			framework: "react",
			pattern: "stale_closure",
			componentName: "TodoList",
			severity: "medium",
			detail: "stale value",
			evidence: {},
		});
		const markers = detector.check(event, []);
		const med = markers.find((m) => m.severity === "medium");
		expect(med?.label).toContain("TodoList");
	});
});
