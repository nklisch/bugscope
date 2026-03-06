/**
 * Analytics event processing pipeline.
 *
 * Four stages:
 *   1. Validate — checks required fields and applies schema transforms
 *   2. Enrich   — adds user segment, geo region, and device category
 *   3. Aggregate — groups events by type and computes metrics
 *   4. Report   — formats the final output
 *
 * BUG: Stage 1 (validate) conditionally applies field transforms based on
 * whether a schema exists for the event's type+version. Purchase events at
 * version 1 have a schema with a `revenue` transform (cents → dollars).
 * Purchase events at version 2 have NO registered schema, so they skip
 * validation entirely and their `revenue` field stays in cents.
 *
 * Stage 3 (aggregate) sums `payload.revenue` across all purchase events
 * without knowing which events were normalized and which weren't. The
 * result is a mix of dollars and cents: wildly wrong.
 */

import { getSchema, hasSchema } from "./event-schemas.ts";

// ────────────────────────────────────────────────────────────────────────────
// Types

export interface RawEvent {
	id: string;
	type: string;
	version: number;
	payload: Record<string, unknown>;
	metadata: {
		source: string;
		sessionId: string;
		timestamp: number;
		userId?: string;
	};
}

export interface ValidatedEvent extends RawEvent {
	schemaValidated: boolean;
}

export interface EnrichedEvent extends ValidatedEvent {
	enriched: {
		userSegment: string;
		geoRegion: string;
		deviceCategory: string;
	};
}

export interface EventMetrics {
	eventType: string;
	count: number;
	uniqueSessions: Set<string>;
	totalRevenue: number | null; // null for non-revenue event types
	bySegment: Record<string, number>;
}

export interface PipelineReport {
	eventCounts: Record<string, number>;
	totalRevenue: number;
	uniqueSessionCount: number;
	revenueBySegment: Record<string, number>;
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 1: Validate

function validateEvent(event: RawEvent): ValidatedEvent {
	if (!hasSchema(event.type, event.version)) {
		// No schema registered — pass through unmodified
		return { ...event, schemaValidated: false };
	}

	const schema = getSchema(event.type, event.version)!;
	const transformedPayload: Record<string, unknown> = { ...event.payload };

	for (const [field, def] of Object.entries(schema.fields)) {
		if (field in transformedPayload && def.transform) {
			transformedPayload[field] = def.transform(transformedPayload[field]);
		}
	}

	return {
		...event,
		payload: transformedPayload,
		schemaValidated: true,
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 2: Enrich

const USER_SEGMENTS: Record<string, string> = {
	"user-001": "premium",
	"user-002": "free",
	"user-003": "premium",
	"user-004": "trial",
	"user-005": "free",
};

const GEO_REGIONS: Record<string, string> = {
	"sess-001": "us-east",
	"sess-002": "eu-west",
	"sess-003": "us-west",
	"sess-004": "us-east",
	"sess-005": "apac",
	"sess-006": "eu-west",
};

function enrichEvent(event: ValidatedEvent): EnrichedEvent {
	const userId = event.metadata.userId ?? "anonymous";
	const sessionId = event.metadata.sessionId;
	return {
		...event,
		enriched: {
			userSegment: USER_SEGMENTS[userId] ?? "unknown",
			geoRegion: GEO_REGIONS[sessionId] ?? "unknown",
			deviceCategory: event.metadata.source.includes("mobile") ? "mobile" : "desktop",
		},
	};
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 3: Aggregate

function aggregateEvents(events: EnrichedEvent[]): Map<string, EventMetrics> {
	const metrics = new Map<string, EventMetrics>();

	for (const event of events) {
		if (!metrics.has(event.type)) {
			metrics.set(event.type, {
				eventType: event.type,
				count: 0,
				uniqueSessions: new Set(),
				totalRevenue: event.type === "purchase" ? 0 : null,
				bySegment: {},
			});
		}

		const m = metrics.get(event.type)!;
		m.count++;
		m.uniqueSessions.add(event.metadata.sessionId);

		const segment = event.enriched.userSegment;
		m.bySegment[segment] = (m.bySegment[segment] ?? 0) + 1;

		// BUG: `payload.revenue` is in dollars for v1 events (schema-transformed)
		// but still in cents for v2 events (no schema registered, not transformed).
		// Both get added to the same `totalRevenue` counter.
		if (m.totalRevenue !== null && event.payload.revenue !== undefined) {
			m.totalRevenue += Number(event.payload.revenue);
		}
	}

	return metrics;
}

// ────────────────────────────────────────────────────────────────────────────
// Stage 4: Report

function buildReport(metrics: Map<string, EventMetrics>): PipelineReport {
	const eventCounts: Record<string, number> = {};
	let totalRevenue = 0;
	let uniqueSessionCount = 0;
	const revenueBySegment: Record<string, number> = {};
	const allSessions = new Set<string>();

	for (const [type, m] of metrics) {
		eventCounts[type] = m.count;
		for (const s of m.uniqueSessions) allSessions.add(s);

		if (m.totalRevenue !== null) {
			totalRevenue += m.totalRevenue;
		}
	}

	uniqueSessionCount = allSessions.size;

	// Revenue breakdown by segment (from purchase events only)
	const purchaseMetrics = metrics.get("purchase");
	if (purchaseMetrics) {
		for (const [segment, count] of Object.entries(purchaseMetrics.bySegment)) {
			// Approximate revenue per segment proportionally
			revenueBySegment[segment] = purchaseMetrics.totalRevenue !== null
				? Math.round((purchaseMetrics.totalRevenue * count / purchaseMetrics.count) * 100) / 100
				: 0;
		}
	}

	return { eventCounts, totalRevenue: Math.round(totalRevenue * 100) / 100, uniqueSessionCount, revenueBySegment };
}

// ────────────────────────────────────────────────────────────────────────────
// Public API

export function runPipeline(events: RawEvent[]): PipelineReport {
	const validated = events.map(validateEvent);
	const enriched = validated.map(enrichEvent);
	const metrics = aggregateEvents(enriched);
	return buildReport(metrics);
}
