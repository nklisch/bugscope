/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { clearLedger, dailyReport } from "./ledger.js";

before(() => {
	clearLedger();
});

test("each day report reflects only that day's sales", () => {
	const salesByDay = [
		[["apple", 1.00], ["banana", 0.50]],
		[["cherry", 2.00]],
	];
	const reports = dailyReport(salesByDay);

	assert.equal(reports[0].count, 2, `Day 1 should have 2 sales, got ${reports[0].count}`);
	assert.equal(reports[0].total, 1.50, `Day 1 total should be 1.50, got ${reports[0].total}`);

	assert.equal(reports[1].count, 1, `Day 2 should have 1 sale, got ${reports[1].count}`);
	assert.equal(reports[1].total, 2.00, `Day 2 total should be 2.00, got ${reports[1].total}`);
});
