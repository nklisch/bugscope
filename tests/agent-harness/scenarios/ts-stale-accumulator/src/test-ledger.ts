/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-ledger.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { clearLedger, dailyReport } from "./ledger.ts";

test("each day's report counts only that day's sales", () => {
	clearLedger();
	const salesByDay: [string, number, string][][] = [
		[
			["Widget A", 10.00, "widgets"],
			["Widget B", 15.00, "widgets"],
		],
		[
			["Gadget X", 25.00, "gadgets"],
		],
	];

	const reports = dailyReport(salesByDay);

	// Day 1: 2 items, total $25
	assert.equal(reports[0].count, 2, `Day 1 should have 2 sales, got ${reports[0].count}`);
	assert.equal(reports[0].total, 25, `Day 1 total should be $25, got ${reports[0].total}`);

	// Day 2: 1 item, total $25 — should NOT include day 1's sales
	assert.equal(reports[1].count, 1, `Day 2 should have 1 sale, got ${reports[1].count}`);
	assert.equal(reports[1].total, 25, `Day 2 total should be $25, got ${reports[1].total}`);
});
