/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeInvoiceTax, totalTax } from "./calculator.js";

test("US sales tax is 8%", () => {
	const result = computeInvoiceTax([{ name: "A", price: 100, category: "sales" }], "US");
	assert.equal(result[0].tax, 8);
	assert.equal(result[0].total, 108);
});

test("US luxury tax is 12%", () => {
	const result = computeInvoiceTax([{ name: "A", price: 100, category: "luxury" }], "US");
	assert.equal(result[0].tax, 12);
	assert.equal(result[0].total, 112);
});

test("EU sales tax is 20%", () => {
	const result = computeInvoiceTax([{ name: "A", price: 100, category: "sales" }], "EU");
	assert.equal(result[0].tax, 20);
	assert.equal(result[0].total, 120);
});

test("EU luxury tax is 25%", () => {
	const result = computeInvoiceTax([{ name: "A", price: 200, category: "luxury" }], "EU");
	assert.equal(result[0].tax, 50);
	assert.equal(result[0].total, 250);
});

test("unknown category falls back to sales rate", () => {
	const result = computeInvoiceTax([{ name: "A", price: 100, category: "other" }], "US");
	assert.equal(result[0].tax, 8);
});

test("no NaN in any field", () => {
	const items = [
		{ name: "A", price: 50, category: "sales" },
		{ name: "B", price: 300, category: "luxury" },
	];
	const result = computeInvoiceTax(items, "EU");
	for (const item of result) {
		assert.ok(!Number.isNaN(item.tax), `tax is NaN for ${item.name}`);
		assert.ok(!Number.isNaN(item.total), `total is NaN for ${item.name}`);
	}
});

test("multiple items all have correct totals", () => {
	const items = [
		{ name: "A", price: 100, category: "sales" },
		{ name: "B", price: 200, category: "luxury" },
	];
	const result = computeInvoiceTax(items, "US");
	assert.equal(result[0].tax, 8);
	assert.equal(result[1].tax, 24);
});

test("totalTax utility sums correctly", () => {
	const items = [
		{ name: "A", price: 100, category: "sales" },
		{ name: "B", price: 100, category: "luxury" },
	];
	// US: 8 + 12 = 20
	assert.equal(totalTax(items, "US"), 20);
});

test("regression: this binding not lost — taxes are numbers, not NaN", () => {
	const result = computeInvoiceTax([{ name: "X", price: 50, category: "sales" }], "US");
	assert.ok(typeof result[0].tax === "number" && !Number.isNaN(result[0].tax),
		`Expected a number, got ${result[0].tax}`);
});
