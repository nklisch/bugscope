/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLedger, dailyReport } from "./ledger.ts";

test("day 1 reports only day 1 sales", () => {
	clearLedger();
	const reports = dailyReport([
		[["Item A", 10, "a"], ["Item B", 20, "a"]],
		[["Item C", 30, "b"]],
	]);
	assert.equal(reports[0].count, 2);
	assert.equal(reports[0].total, 30);
});

test("day 2 reports only day 2 sales", () => {
	clearLedger();
	const reports = dailyReport([
		[["Item A", 10, "a"], ["Item B", 20, "a"]],
		[["Item C", 30, "b"]],
	]);
	assert.equal(reports[1].count, 1);
	assert.equal(reports[1].total, 30);
});

test("three days are each independent", () => {
	clearLedger();
	const reports = dailyReport([
		[["X", 5, "x"]],
		[["Y", 10, "y"]],
		[["Z", 15, "z"]],
	]);
	assert.equal(reports[0].count, 1);
	assert.equal(reports[0].total, 5);
	assert.equal(reports[1].count, 1);
	assert.equal(reports[1].total, 10);
	assert.equal(reports[2].count, 1);
	assert.equal(reports[2].total, 15);
});

test("calling dailyReport twice produces independent results", () => {
	clearLedger();
	const first = dailyReport([[["A", 10, "a"]]]);
	assert.equal(first[0].count, 1);

	clearLedger();
	const second = dailyReport([[["B", 20, "b"], ["C", 30, "c"]]]);
	assert.equal(second[0].count, 2);
	assert.equal(second[0].total, 50);
});

test("topCategory reflects only that day's sales", () => {
	clearLedger();
	const reports = dailyReport([
		[["W1", 5, "widgets"], ["W2", 5, "widgets"], ["G1", 5, "gadgets"]],
		[["G2", 5, "gadgets"], ["G3", 5, "gadgets"]],
	]);
	// Day 1: 2 widgets, 1 gadget → top is "widgets"
	assert.equal(reports[0].topCategory, "widgets");
	// Day 2: 2 gadgets only → top is "gadgets" (not "widgets" from day 1)
	assert.equal(reports[1].topCategory, "gadgets");
});
