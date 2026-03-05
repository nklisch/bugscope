/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInvoiceTax } from "./calculator.js";

test("US sales tax is computed correctly", () => {
	const items = [{ name: "Widget", price: 100, category: "sales" }];
	const result = computeInvoiceTax(items, "US");
	assert.equal(result[0].tax, 8, `Expected tax=8 (8% of $100), got ${result[0].tax}`);
	assert.equal(result[0].total, 108, `Expected total=108, got ${result[0].total}`);
});

test("tax values are not NaN", () => {
	const items = [
		{ name: "Widget", price: 50, category: "sales" },
		{ name: "Luxury Item", price: 200, category: "luxury" },
	];
	const result = computeInvoiceTax(items, "EU");
	for (const item of result) {
		assert.ok(!Number.isNaN(item.tax), `tax is NaN for ${item.name}`);
		assert.ok(!Number.isNaN(item.total), `total is NaN for ${item.name}`);
	}
});
