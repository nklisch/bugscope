import type { EventType, RecordedEvent } from "../types.js";

export interface DetectionRule {
	/** Which event types trigger this rule. */
	eventTypes: EventType[];
	/** Condition to check. Return true to place a marker. */
	condition: (event: RecordedEvent, recentEvents: RecordedEvent[]) => boolean;
	/** Label for the auto-placed marker. */
	label: (event: RecordedEvent) => string;
	/** Severity of the detected anomaly. */
	severity: "low" | "medium" | "high";
	/** Cooldown in ms — don't fire again within this window. Default: 5000. */
	cooldownMs?: number;
}

export const DEFAULT_DETECTION_RULES: DetectionRule[] = [
	// HTTP 5xx specifically get high severity (checked before 4xx to avoid double-firing)
	{
		eventTypes: ["network_response"],
		condition: (e) => (e.data.status as number) >= 500,
		label: (e) => `Server error: HTTP ${e.data.status} on ${e.data.method} ${e.data.url}`,
		severity: "high",
		cooldownMs: 2000,
	},

	// HTTP 4xx responses (excluding 5xx already handled above)
	{
		eventTypes: ["network_response"],
		condition: (e) => {
			const status = e.data.status as number;
			return status >= 400 && status < 500;
		},
		label: (e) => `HTTP ${e.data.status} on ${e.data.method} ${e.data.url}`,
		severity: "medium",
		cooldownMs: 2000,
	},

	// Console errors
	{
		eventTypes: ["console"],
		condition: (e) => e.data.level === "error",
		label: (e) => `Console error: ${e.summary.slice(0, 100)}`,
		severity: "medium",
		cooldownMs: 2000,
	},

	// Unhandled exceptions
	{
		eventTypes: ["page_error"],
		condition: () => true,
		label: (e) => `Uncaught: ${e.summary.slice(0, 100)}`,
		severity: "high",
	},

	// Slow network responses (> 5 seconds)
	{
		eventTypes: ["network_response"],
		condition: (e) => typeof e.data.durationMs === "number" && (e.data.durationMs as number) > 5000,
		label: (e) => `Slow response: ${e.data.url} (${e.data.durationMs}ms)`,
		severity: "low",
		cooldownMs: 10000,
	},
];

export const PHASE_12_DETECTION_RULES: DetectionRule[] = [
	// Failed form submission heuristic:
	// submit event followed by 4xx response within 3 seconds
	{
		eventTypes: ["user_input"],
		condition: (event, recent) => {
			if (event.data.type !== "submit") return false;
			return recent.some((e) => e.type === "network_response" && (e.data.status as number) >= 400 && e.timestamp - event.timestamp < 3000 && e.timestamp >= event.timestamp);
		},
		label: (event) => `Form submission failed: ${event.data.selector}`,
		severity: "high",
		cooldownMs: 5000,
	},

	// Rapid repeated requests (possible retry loop)
	{
		eventTypes: ["network_request"],
		condition: (event, recent) => {
			const sameUrl = recent.filter((e) => e.type === "network_request" && e.data.url === event.data.url && event.timestamp - e.timestamp < 5000);
			return sameUrl.length >= 3;
		},
		label: (event) => `Rapid retries: ${event.data.url} (3+ requests in 5s)`,
		severity: "medium",
		cooldownMs: 10000,
	},

	// Large layout shift (potential rendering bug)
	{
		eventTypes: ["performance"],
		condition: (event) => event.data.metric === "CLS" && (event.data.value as number) > 0.25,
		label: (event) => `Large layout shift (CLS: ${event.data.value})`,
		severity: "low",
		cooldownMs: 30000,
	},

	// WebSocket connection error
	{
		eventTypes: ["websocket"],
		condition: (event) => event.data.type === "error" || event.data.type === "close",
		label: (event) => `WebSocket ${event.data.type}: ${event.data.url}`,
		severity: "medium",
		cooldownMs: 5000,
	},

	// Navigation to error page (common SPA patterns)
	{
		eventTypes: ["navigation"],
		condition: (event) => {
			const url = (event.data.url as string) ?? "";
			return /\/(error|404|500|oops|not-found)/i.test(url);
		},
		label: (event) => `Navigated to error page: ${event.data.url}`,
		severity: "high",
		cooldownMs: 5000,
	},
];

/** All detection rules: Phase 9 defaults + Phase 12 advanced rules. */
export const ALL_DETECTION_RULES: DetectionRule[] = [...DEFAULT_DETECTION_RULES, ...PHASE_12_DETECTION_RULES];

/**
 * Checks incoming events against detection rules and returns markers to place.
 * Each rule has an optional cooldown to prevent marker spam.
 */
export class AutoDetector {
	private lastFired = new Map<number, number>(); // rule index → last fired timestamp

	constructor(private rules: DetectionRule[] = DEFAULT_DETECTION_RULES) {}

	/** Check an event against all rules. Returns markers to place. */
	check(event: RecordedEvent, recentEvents: RecordedEvent[]): Array<{ label: string; severity: "low" | "medium" | "high" }> {
		const now = Date.now();
		const results: Array<{ label: string; severity: "low" | "medium" | "high" }> = [];

		for (let i = 0; i < this.rules.length; i++) {
			const rule = this.rules[i];

			// Check if event type matches
			if (!rule.eventTypes.includes(event.type)) continue;

			// Check cooldown
			const cooldownMs = rule.cooldownMs ?? 5000;
			const lastFiredAt = this.lastFired.get(i) ?? 0;
			if (now - lastFiredAt < cooldownMs) continue;

			// Check condition
			if (!rule.condition(event, recentEvents)) continue;

			this.lastFired.set(i, now);
			results.push({ label: rule.label(event), severity: rule.severity });
		}

		return results;
	}
}
