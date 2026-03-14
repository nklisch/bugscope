import type { QueryEngine } from "./query-engine.js";

/**
 * Resolve a timestamp reference to epoch ms.
 *
 * Accepts:
 * - Pure numeric string: treated as epoch ms
 * - ISO timestamp: "2024-01-01T12:00:00Z" → epoch ms
 * - Event ID (UUID): looks up the event's timestamp via queryEngine
 *
 * Does NOT accept relative formats like HH:MM:SS — use absolute timestamps.
 *
 * @throws Error if the reference cannot be resolved
 */
export function resolveTimestamp(queryEngine: QueryEngine, sessionId: string, ref: string): number {
	// Pure numeric string → epoch ms
	if (/^\d+$/.test(ref)) return Number(ref);
	// ISO timestamp (YYYY-MM-DD prefix or contains T+zone offset)
	if (/^\d{4}-\d{2}-\d{2}/.test(ref) || (ref.includes("T") && ref.includes("-"))) {
		return new Date(ref).getTime();
	}
	// Event ID — look up by event_id
	const event = queryEngine.getFullEvent(sessionId, ref);
	if (event) return event.timestamp;
	throw new Error(`Cannot resolve "${ref}" to a timestamp or event. Use an ISO timestamp (e.g. 2024-01-01T12:00:00Z), epoch ms, or event ID.`);
}
