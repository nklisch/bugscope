/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBill } from "./bill.ts";

function checkSplit(total: number, numPeople: number, tipPct?: number) {
	const split = tipPct !== undefined ? splitBill(total, numPeople, tipPct) : splitBill(total, numPeople);
	assert.equal(
		split.totalShares,
		split.totalWithTip,
		`${total} split ${numPeople} ways: totalShares ${split.totalShares} !== totalWithTip ${split.totalWithTip}`,
	);
	assert.equal(split.shares.length, numPeople);
}

test("3 people $47.50: shares sum to total", () => checkSplit(47.5, 3));
test("7 people $100: shares sum to total", () => checkSplit(100, 7));
test("3 people $100: shares sum to total", () => checkSplit(100, 3));
test("5 people $73.25: shares sum to total", () => checkSplit(73.25, 5));
test("6 people $200: shares sum to total", () => checkSplit(200, 6));
test("2 people $50: shares sum to total", () => checkSplit(50, 2));

test("each share is rounded to 2 decimal places", () => {
	const split = splitBill(47.5, 3);
	for (const share of split.shares) {
		assert.equal(share, Math.round(share * 100) / 100, `share ${share} should be rounded to 2dp`);
	}
});

test("correct number of shares returned", () => {
	const split = splitBill(100, 4);
	assert.equal(split.shares.length, 4);
});

test("totalWithTip is total plus tip percentage", () => {
	const split = splitBill(100, 2, 0.20);
	assert.equal(split.totalWithTip, 120);
});
