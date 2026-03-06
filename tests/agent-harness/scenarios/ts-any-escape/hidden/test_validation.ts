/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateReport, processBatch } from "./transaction-processor.ts";

const mixedRecords = [
	{ id: "T1", amount: "150.00", currency: "USD", type: "credit", timestamp: "2024-01-15T10:00:00Z" },
	{ id: "T2", amount: 200, currency: "USD", type: "credit", timestamp: "2024-01-15T11:00:00Z" },
	{ id: "T3", amount: "75.50", currency: "EUR", type: "debit", timestamp: "2024-01-15T12:00:00Z" },
];

const numericOnlyRecords = [
	{ id: "N1", amount: 100, currency: "USD", type: "credit", timestamp: "2024-01-15T10:00:00Z" },
	{ id: "N2", amount: 50, currency: "USD", type: "refund", timestamp: "2024-01-15T11:00:00Z" },
];

const stringOnlyRecords = [
	{ id: "S1", amount: "300.00", currency: "GBP", type: "credit", timestamp: "2024-01-15T10:00:00Z" },
	{ id: "S2", amount: "200.50", currency: "GBP", type: "debit", timestamp: "2024-01-15T11:00:00Z" },
];

test("totalAmount is a number for mixed input", () => {
	const batch = processBatch(mixedRecords);
	assert.equal(typeof batch.totalAmount, "number");
});

test("totalAmount sums mixed input correctly", () => {
	const batch = processBatch(mixedRecords);
	assert.equal(batch.totalAmount, 425.5);
});

test("totalAmount is correct for numeric-only input", () => {
	const batch = processBatch(numericOnlyRecords);
	assert.equal(batch.totalAmount, 150);
});

test("totalAmount is correct for string-only amounts", () => {
	const batch = processBatch(stringOnlyRecords);
	assert.equal(batch.totalAmount, 500.5);
});

test("avgAmount is calculated correctly", () => {
	const batch = processBatch(mixedRecords);
	assert.equal(batch.avgAmount, 141.83);
});

test("transaction.amount fields are all numbers", () => {
	const batch = processBatch(mixedRecords);
	for (const t of batch.transactions) {
		assert.equal(typeof t.amount, "number", `Transaction ${t.id} amount should be number, got ${typeof t.amount}`);
	}
});

test("generateReport produces correct summary", () => {
	const { batch, summary } = generateReport(numericOnlyRecords);
	assert.equal(batch.totalAmount, 150);
	assert.ok(summary.includes("150.00"), `summary should include the total: ${summary}`);
});

test("currencies are collected correctly", () => {
	const batch = processBatch(mixedRecords);
	assert.equal(batch.currencies.length, 2);
	assert.ok(batch.currencies.includes("USD"));
	assert.ok(batch.currencies.includes("EUR"));
});
