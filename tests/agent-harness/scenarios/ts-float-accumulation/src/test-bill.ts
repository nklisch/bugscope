/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-bill.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBill } from "./bill.ts";

test("totalShares equals totalWithTip after rounding (3 people, $47.50 bill)", () => {
	// $47.50 + 18% tip = $56.05, split 3 ways = $18.6833...
	// After rounding each share: 3 × $18.68 = $56.04, but totalWithTip is $56.05
	const split = splitBill(47.50, 3);
	assert.equal(
		split.totalShares,
		split.totalWithTip,
		`Sum of shares ($${split.totalShares}) should equal total with tip ($${split.totalWithTip})`,
	);
});

test("totalShares equals totalWithTip after rounding (7 people, $100 bill)", () => {
	const split = splitBill(100, 7);
	assert.equal(
		split.totalShares,
		split.totalWithTip,
		`Sum of shares ($${split.totalShares}) should equal total with tip ($${split.totalWithTip})`,
	);
});
