/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawEvent } from "./pipeline.ts";
import { runPipeline } from "./pipeline.ts";

const purchaseEventsV1: RawEvent[] = [
	{
		id: "v1-001",
		type: "purchase",
		version: 1,
		payload: { revenue: 5000, productId: "PROD-A", quantity: 2, currency: "USD" },
		metadata: { source: "web", sessionId: "sess-001", timestamp: 1700000001, userId: "user-001" },
	},
	{
		id: "v1-002",
		type: "purchase",
		version: 1,
		payload: { revenue: 12000, productId: "PROD-B", quantity: 1, currency: "USD" },
		metadata: { source: "web", sessionId: "sess-002", timestamp: 1700000002, userId: "user-002" },
	},
];

const purchaseEventsV2: RawEvent[] = [
	{
		id: "v2-001",
		type: "purchase",
		version: 2,
		payload: { revenue: 7500, productId: "PROD-C", quantity: 3, currency: "USD" },
		metadata: { source: "mobile-ios", sessionId: "sess-003", timestamp: 1700000003, userId: "user-003" },
	},
	{
		id: "v2-002",
		type: "purchase",
		version: 2,
		payload: { revenue: 3000, productId: "PROD-A", quantity: 1, currency: "USD" },
		metadata: { source: "mobile-android", sessionId: "sess-004", timestamp: 1700000004, userId: "user-004" },
	},
];

const mixedEvents: RawEvent[] = [...purchaseEventsV1, ...purchaseEventsV2];

const nonPurchaseEvents: RawEvent[] = [
	{
		id: "pv-001",
		type: "pageview",
		version: 1,
		payload: { url: "https://example.com", referrer: "", timeOnPage: 45 },
		metadata: { source: "web", sessionId: "sess-005", timestamp: 1700000005, userId: "user-005" },
	},
	{
		id: "sg-001",
		type: "signup",
		version: 1,
		payload: { plan: "premium", source: "organic" },
		metadata: { source: "web", sessionId: "sess-001", timestamp: 1700000006, userId: "user-001" },
	},
];

test("v1-only purchases: total revenue in dollars", () => {
	const report = runPipeline(purchaseEventsV1);
	// 5000 cents → $50, 12000 cents → $120; total = $170
	assert.equal(report.totalRevenue, 170, `v1-only total should be $170, got $${report.totalRevenue}`);
});

test("v2-only purchases: total revenue in dollars", () => {
	const report = runPipeline(purchaseEventsV2);
	// 7500 cents → $75, 3000 cents → $30; total = $105
	assert.equal(report.totalRevenue, 105, `v2-only total should be $105, got $${report.totalRevenue}`);
});

test("mixed v1+v2 purchases: total revenue in dollars", () => {
	const report = runPipeline(mixedEvents);
	// $170 + $105 = $275
	assert.equal(report.totalRevenue, 275, `mixed total should be $275, got $${report.totalRevenue}`);
});

test("non-purchase events contribute zero revenue", () => {
	const report = runPipeline(nonPurchaseEvents);
	assert.equal(report.totalRevenue, 0);
});

test("mixed event types: purchase count is correct", () => {
	const report = runPipeline([...mixedEvents, ...nonPurchaseEvents]);
	assert.equal(report.eventCounts.purchase, 4);
	assert.equal(report.eventCounts.pageview, 1);
	assert.equal(report.eventCounts.signup, 1);
});

test("unique session count is correct", () => {
	const report = runPipeline(mixedEvents);
	// sess-001, sess-002, sess-003, sess-004 = 4 unique sessions
	assert.equal(report.uniqueSessionCount, 4);
});

test("total revenue does not include non-revenue event amounts", () => {
	const report = runPipeline([...mixedEvents, ...nonPurchaseEvents]);
	assert.equal(report.totalRevenue, 275, "non-purchase events should not affect revenue total");
});
