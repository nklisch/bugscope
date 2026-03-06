/**
 * Visible tests for the bill-splitting utility.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBill } from "./bill.js";

test("exact split with no tip — $30 among 3 people", () => {
	const result = splitBill(30, 3, 0);
	assert.equal(result.totalShares, 30);
	assert.equal(result.totalWithTip, 30);
	assert.equal(result.perPerson, 10);
});

test("exact split with no tip — $60 among 4 people", () => {
	const result = splitBill(60, 4, 0);
	assert.equal(result.totalShares, 60);
	assert.equal(result.perPerson, 15);
});

test("result has expected keys", () => {
	const result = splitBill(40, 2);
	assert.ok("perPerson" in result, "missing perPerson");
	assert.ok("shares" in result, "missing shares");
	assert.ok("totalWithTip" in result, "missing totalWithTip");
	assert.ok("totalShares" in result, "missing totalShares");
	assert.equal(result.shares.length, 2);
});
