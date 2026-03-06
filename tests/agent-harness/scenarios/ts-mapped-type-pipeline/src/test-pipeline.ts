/**
 * Visible tests for the analytics event processing pipeline.
 * Uses Node.js built-in test runner: node --import tsx --test test-pipeline.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawEvent } from "./pipeline.ts";
import { runPipeline } from "./pipeline.ts";

const pageviewEvents: RawEvent[] = [
	{
		id: "p-001",
		type: "pageview",
		version: 1,
		payload: { url: "https://example.com", referrer: "", timeOnPage: 30 },
		metadata: { source: "web", sessionId: "sess-001", timestamp: 1700000001, userId: "user-001" },
	},
	{
		id: "p-002",
		type: "pageview",
		version: 1,
		payload: { url: "https://example.com/about", referrer: "https://google.com", timeOnPage: 45 },
		metadata: { source: "web", sessionId: "sess-002", timestamp: 1700000002, userId: "user-002" },
	},
];

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
		version: 2,
		payload: { revenue: 7500, productId: "PROD-C", quantity: 3, currency: "USD" },
		metadata: { source: "mobile-ios", sessionId: "sess-003", timestamp: 1700000003, userId: "user-003" },
	},
	{
		id: "evt-004",
		type: "purchase",
		version: 2,
		payload: { revenue: 3000, productId: "PROD-A", quantity: 1, currency: "USD" },
		metadata: { source: "mobile-android", sessionId: "sess-004", timestamp: 1700000004, userId: "user-004" },
	},
];

test("pageview events are counted correctly", () => {
	const report = runPipeline(pageviewEvents);
	assert.equal(report.eventCounts.pageview, 2, `Expected 2 pageview events, got ${report.eventCounts.pageview}`);
});

test("unique session count matches distinct sessions", () => {
	const report = runPipeline(pageviewEvents);
	assert.equal(report.uniqueSessionCount, 2, `Expected 2 unique sessions, got ${report.uniqueSessionCount}`);
});

test("purchase event count is correct", () => {
	const report = runPipeline(purchaseEvents);
	assert.equal(report.eventCounts.purchase, 4, `Expected 4 purchase events, got ${report.eventCounts.purchase}`);
});
