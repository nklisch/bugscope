/**
 * Visible tests for the bill-splitting utility.
 * Uses Node.js built-in test runner: node --import tsx --test test-bill.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBill } from "./bill.ts";

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

test("result has expected shape", () => {
	const result = splitBill(40, 2);
	assert.ok(typeof result.perPerson === "number");
	assert.ok(Array.isArray(result.shares));
	assert.ok(typeof result.totalWithTip === "number");
	assert.ok(typeof result.totalShares === "number");
	assert.equal(result.shares.length, 2);
});
