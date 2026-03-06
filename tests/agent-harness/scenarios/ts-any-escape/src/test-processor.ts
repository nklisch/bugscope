/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-processor.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { processBatch } from "./transaction-processor.ts";

// Records from the legacy API return `amount` as a string.
// Records from the new API return `amount` as a number.
const mixedRecords = [
	{ id: "T1", amount: "150.00", currency: "USD", type: "credit", timestamp: "2024-01-15T10:00:00Z" },
	{ id: "T2", amount: 200, currency: "USD", type: "credit", timestamp: "2024-01-15T11:00:00Z" },
	{ id: "T3", amount: "75.50", currency: "EUR", type: "debit", timestamp: "2024-01-15T12:00:00Z" },
];

test("totalAmount is a number, not a string", () => {
	const batch = processBatch(mixedRecords);
	assert.equal(typeof batch.totalAmount, "number", `totalAmount should be a number, got ${typeof batch.totalAmount}: ${batch.totalAmount}`);
});

test("totalAmount correctly sums all transaction amounts", () => {
	const batch = processBatch(mixedRecords);
	// 150.00 + 200 + 75.50 = 425.50
	assert.equal(batch.totalAmount, 425.5, `Expected 425.5, got ${batch.totalAmount}`);
});
