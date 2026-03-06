/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-pipeline.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawEvent } from "./pipeline.ts";
import { runPipeline } from "./pipeline.ts";

// Mix of purchase events at v1 (schema registered, revenue normalized cents→dollars)
// and v2 (no schema registered, revenue stays in cents).
//
// v1 events: revenue in cents → schema transforms to dollars
//   - P1: 5000 cents → $50.00
//   - P2: 12000 cents → $120.00
// v2 events: no schema → revenue stays in cents
//   - P3: 7500 cents → stays 7500 (NOT $75.00)
//   - P4: 3000 cents → stays 3000 (NOT $30.00)
//
// Expected total (all in dollars): 50 + 120 + 75 + 30 = $275.00
// Actual (bug): 50 + 120 + 7500 + 3000 = $10670.00

const purchaseEvents: RawEvent[] = [
	{
		id: "evt-001",
		type: "purchase",
		version: 1,
		payload: { revenue: 5000, productId: "PROD-A", quantity: 2, currency: "USD" },
		metadata: { source: "web", sessionId: "sess-001", timestamp: 1700000001, userId: "user-001" },
	},
	{
		id: "evt-002",
		type: "purchase",
		version: 1,
		payload: { revenue: 12000, productId: "PROD-B", quantity: 1, currency: "USD" },
		metadata: { source: "web", sessionId: "sess-002", timestamp: 1700000002, userId: "user-002" },
	},
	{
		id: "evt-003",
		type: "purchase",
		version: 2, // No schema registered for purchase v2 — revenue NOT normalized
		payload: { revenue: 7500, productId: "PROD-C", quantity: 3, currency: "USD" },
		metadata: { source: "mobile-ios", sessionId: "sess-003", timestamp: 1700000003, userId: "user-003" },
	},
	{
		id: "evt-004",
		type: "purchase",
		version: 2, // No schema registered for purchase v2 — revenue NOT normalized
		payload: { revenue: 3000, productId: "PROD-A", quantity: 1, currency: "USD" },
		metadata: { source: "mobile-android", sessionId: "sess-004", timestamp: 1700000004, userId: "user-004" },
	},
];

test("total revenue sums all purchase amounts in dollars", () => {
	const report = runPipeline(purchaseEvents);
	// $50 + $120 + $75 + $30 = $275
	assert.equal(
		report.totalRevenue,
		275,
		`Expected total revenue $275.00, got $${report.totalRevenue} — check that v2 purchase events have revenue normalized from cents to dollars`,
	);
});

test("purchase event count is correct", () => {
	const report = runPipeline(purchaseEvents);
	assert.equal(report.eventCounts.purchase, 4, `Expected 4 purchase events, got ${report.eventCounts.purchase}`);
});
