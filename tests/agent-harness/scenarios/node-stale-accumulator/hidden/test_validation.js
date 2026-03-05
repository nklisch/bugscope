/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { clearLedger, dailyReport, ledgerSize } from "./ledger.js";

before(() => clearLedger());
after(() => clearLedger());

test("day 1 report has correct count and total", () => {
	clearLedger();
	const reports = dailyReport([[["apple", 1.00], ["banana", 0.50]]]);
	assert.equal(reports[0].count, 2);
	assert.equal(reports[0].total, 1.50);
});

test("day 2 report reflects only day 2 sales", () => {
	clearLedger();
	const salesByDay = [
		[["apple", 1.00], ["banana", 0.50]],
		[["cherry", 2.00]],
	];
	const reports = dailyReport(salesByDay);
	assert.equal(reports[1].count, 1, `Day 2 count should be 1, got ${reports[1].count}`);
	assert.equal(reports[1].total, 2.00, `Day 2 total should be 2.00, got ${reports[1].total}`);
});

test("three days each have isolated counts", () => {
	clearLedger();
	const salesByDay = [
		[["a", 1.00]],
		[["b", 2.00], ["c", 3.00]],
		[["d", 4.00], ["e", 5.00], ["f", 6.00]],
	];
	const reports = dailyReport(salesByDay);
	assert.equal(reports[0].count, 1);
	assert.equal(reports[1].count, 2);
	assert.equal(reports[2].count, 3);
});

test("three days each have isolated totals", () => {
	clearLedger();
	const salesByDay = [
		[["a", 10.00]],
		[["b", 20.00]],
		[["c", 30.00]],
	];
	const reports = dailyReport(salesByDay);
	assert.equal(reports[0].total, 10.00);
	assert.equal(reports[1].total, 20.00);
	assert.equal(reports[2].total, 30.00);
});

test("clearLedger resets state", () => {
	clearLedger();
	const reports1 = dailyReport([[["x", 5.00]]]);
	clearLedger();
	const reports2 = dailyReport([[["y", 10.00]]]);
	assert.equal(reports2[0].count, 1, "after clearLedger, should start fresh");
	assert.equal(reports2[0].total, 10.00);
});

test("ledgerSize reflects state", () => {
	clearLedger();
	assert.equal(ledgerSize(), 0);
});

test("regression: day 2 count not inflated by day 1 sales", () => {
	clearLedger();
	const salesByDay = [
		[["apple", 1.00], ["banana", 0.50]], // 2 sales
		[["cherry", 2.00]],                   // 1 sale
	];
	const reports = dailyReport(salesByDay);
	// If bug present: day 2 count = 3 (2 from day 1 + 1 from day 2)
	assert.notEqual(reports[1].count, 3, "day 2 count should not include day 1 sales");
	assert.equal(reports[1].count, 1);
});
