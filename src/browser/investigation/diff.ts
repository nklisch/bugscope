import type { EventRow } from "../storage/database.js";
import type { QueryEngine } from "./query-engine.js";

export interface DiffParams {
	sessionId: string;
	before: string; // timestamp or event_id
	after: string; // timestamp or event_id
	include?: ("form_state" | "storage" | "url" | "console_new" | "network_new")[];
}

export interface DiffResult {
	beforeTime: number;
	afterTime: number;
	durationMs: number;

	// URL change
	urlChange?: { before: string; after: string };

	// Form state diff
	formChanges?: Array<{
		selector: string;
		before: string;
		after: string;
	}>;

	// Storage changes
	storageChanges?: Array<{
		key: string;
		type: "added" | "removed" | "changed";
		before?: string;
		after?: string;
	}>;

	// New console messages between the two moments
	newConsoleMessages?: Array<{
		timestamp: number;
		level: string;
		summary: string;
	}>;

	// Network requests that occurred between the two moments
	newNetworkRequests?: Array<{
		timestamp: number;
		summary: string;
	}>;
}

export class SessionDiffer {
	constructor(private queryEngine: QueryEngine) {}

	diff(params: DiffParams): DiffResult {
		const beforeTs = this.resolveTimestamp(params.sessionId, params.before);
		const afterTs = this.resolveTimestamp(params.sessionId, params.after);

		const result: DiffResult = {
			beforeTime: beforeTs,
			afterTime: afterTs,
			durationMs: afterTs - beforeTs,
		};

		const include = new Set(params.include ?? ["form_state", "storage", "url", "console_new", "network_new"]);

		// URL change — find navigation events at both moments
		if (include.has("url")) {
			const beforeNav = this.findNearestNavigation(params.sessionId, beforeTs);
			const afterNav = this.findNearestNavigation(params.sessionId, afterTs);
			if (beforeNav && afterNav && beforeNav !== afterNav) {
				result.urlChange = { before: beforeNav, after: afterNav };
			}
		}

		// Form state diff — find user_input events of type "change" or "submit"
		if (include.has("form_state")) {
			const formChanges = this.diffFormState(params.sessionId, beforeTs, afterTs);
			if (formChanges) result.formChanges = formChanges;
		}

		// Storage changes — find storage_change events between the two moments
		if (include.has("storage")) {
			const storageChanges = this.diffStorage(params.sessionId, beforeTs, afterTs);
			if (storageChanges) result.storageChanges = storageChanges;
		}

		// New console messages
		if (include.has("console_new")) {
			const consoleEvents = this.queryEngine.search(params.sessionId, {
				filters: {
					eventTypes: ["console"],
					timeRange: { start: beforeTs, end: afterTs },
				},
				maxResults: 20,
			});
			result.newConsoleMessages = consoleEvents.map((e) => ({
				timestamp: e.timestamp,
				level: (e.summary.match(/^\[(\w+)\]/) ?? ["", "info"])[1],
				summary: e.summary,
			}));
		}

		// New network requests
		if (include.has("network_new")) {
			const networkEvents = this.queryEngine.search(params.sessionId, {
				filters: {
					eventTypes: ["network_request", "network_response"],
					timeRange: { start: beforeTs, end: afterTs },
				},
				maxResults: 20,
			});
			result.newNetworkRequests = networkEvents.map((e) => ({
				timestamp: e.timestamp,
				summary: e.summary,
			}));
		}

		return result;
	}

	private findNearestNavigation(sessionId: string, ts: number): string | null {
		const navEvents = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["navigation"],
				timeRange: { start: ts - 600_000, end: ts },
			},
			maxResults: 1,
		});
		if (navEvents.length === 0) return null;
		const full = this.queryEngine.getFullEvent(sessionId, navEvents[navEvents.length - 1].event_id);
		return (full?.data.url as string) ?? null;
	}

	private diffFormState(sessionId: string, before: number, after: number): DiffResult["formChanges"] {
		const changes = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["user_input"],
				timeRange: { start: before, end: after },
			},
			maxResults: 50,
		});

		// Build a map of field changes (selector → latest value)
		const fieldsBefore = new Map<string, string>();
		const fieldsAfter = new Map<string, string>();

		// Fields at "before" time — find the most recent change event before the timestamp
		const beforeChanges = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["user_input"],
				timeRange: { start: before - 600_000, end: before }, // Look back 10 min
			},
			maxResults: 100,
		});

		for (const e of beforeChanges) {
			const fullEvent = this.queryEngine.getFullEvent(sessionId, e.event_id);
			if (fullEvent?.data.type === "change" && fullEvent.data.selector) {
				fieldsBefore.set(fullEvent.data.selector as string, fullEvent.data.value as string);
			}
		}

		for (const e of changes) {
			const fullEvent = this.queryEngine.getFullEvent(sessionId, e.event_id);
			if (fullEvent?.data.type === "change" && fullEvent.data.selector) {
				fieldsAfter.set(fullEvent.data.selector as string, fullEvent.data.value as string);
			}
		}

		// Diff
		const result: NonNullable<DiffResult["formChanges"]> = [];
		const allSelectors = new Set([...fieldsBefore.keys(), ...fieldsAfter.keys()]);
		for (const selector of allSelectors) {
			const bv = fieldsBefore.get(selector) ?? "";
			const av = fieldsAfter.get(selector) ?? bv;
			if (bv !== av) {
				result.push({ selector, before: bv, after: av });
			}
		}

		return result.length > 0 ? result : undefined;
	}

	private diffStorage(sessionId: string, before: number, after: number): DiffResult["storageChanges"] {
		const storageEvents = this.queryEngine.search(sessionId, {
			filters: {
				eventTypes: ["storage_change"],
				timeRange: { start: before, end: after },
			},
			maxResults: 50,
		});

		const changes: NonNullable<DiffResult["storageChanges"]> = [];
		const seen = new Map<string, NonNullable<DiffResult["storageChanges"]>[number]>();

		for (const e of storageEvents) {
			const full = this.queryEngine.getFullEvent(sessionId, e.event_id);
			if (!full) continue;
			const key = full.data.key as string;
			if (!key) continue;
			const changeType = full.data.changeType as string;
			const oldValue = full.data.oldValue as string | undefined;
			const newValue = full.data.newValue as string | undefined;

			if (changeType === "added" || changeType === "set") {
				const existing = seen.get(key);
				if (existing) {
					existing.after = newValue;
				} else {
					const entry: NonNullable<DiffResult["storageChanges"]>[number] = {
						key,
						type: oldValue !== undefined ? "changed" : "added",
						before: oldValue,
						after: newValue,
					};
					seen.set(key, entry);
					changes.push(entry);
				}
			} else if (changeType === "removed") {
				const entry: NonNullable<DiffResult["storageChanges"]>[number] = {
					key,
					type: "removed",
					before: oldValue,
				};
				seen.set(key, entry);
				changes.push(entry);
			}
		}

		return changes.length > 0 ? changes : undefined;
	}

	resolveTimestamp(sessionId: string, ref: string): number {
		// If it looks like an ISO timestamp (YYYY-MM-DD or contains T+zone), parse it
		if (/^\d{4}-\d{2}-\d{2}/.test(ref) || (ref.includes("T") && ref.includes("-"))) {
			return new Date(ref).getTime();
		}
		// If it looks like a time (HH:MM:SS), resolve relative to session start
		if (ref.match(/^\d{2}:\d{2}/)) {
			const session = this.queryEngine.getSession(sessionId);
			const sessionDate = new Date(session.started_at).toISOString().slice(0, 10);
			return new Date(`${sessionDate}T${ref}`).getTime();
		}
		// Otherwise treat as event_id
		const event = this.queryEngine.getFullEvent(sessionId, ref);
		if (event) return event.timestamp;
		throw new Error(`Cannot resolve "${ref}" to a timestamp or event`);
	}
}
