/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPromotions, previewPromotions } from "./promotions.ts";

function makeCatalog() {
	return {
		"SKU-A": { name: "Widget A", price: 100, category: "widgets", stock: 50 },
		"SKU-B": { name: "Widget B", price: 80, category: "widgets", stock: 30 },
		"SKU-C": { name: "Gadget X", price: 60, category: "gadgets", stock: 20 },
	};
}

test("avgOriginalPrice uses pre-promotion prices", () => {
	const result = applyPromotions(makeCatalog(), { "SKU-A": 70, "SKU-B": 50 });
	// (100 + 80 + 60) / 3 = 80
	assert.equal(result.avgOriginalPrice, 80);
});

test("avgOriginalPrice with no promotions equals actual average", () => {
	const result = applyPromotions(makeCatalog(), {});
	// No promotions: (100 + 80 + 60) / 3 = 80
	assert.equal(result.avgOriginalPrice, 80);
});

test("avgOriginalPrice with all items promoted still uses originals", () => {
	const result = applyPromotions(makeCatalog(), {
		"SKU-A": 10,
		"SKU-B": 10,
		"SKU-C": 10,
	});
	assert.equal(result.avgOriginalPrice, 80, "avgOriginalPrice should not be 10");
});

test("totalSavings sums all discounts", () => {
	const result = applyPromotions(makeCatalog(), { "SKU-A": 70, "SKU-B": 50 });
	// (100-70) + (80-50) = 30 + 30 = 60
	assert.equal(result.totalSavings, 60);
});

test("updated count matches number of valid promotions", () => {
	const result = applyPromotions(makeCatalog(), { "SKU-A": 70, "UNKNOWN": 10 });
	assert.equal(result.updated, 1);
});

test("promotedSkus lists only matched items", () => {
	const result = applyPromotions(makeCatalog(), { "SKU-A": 70, "SKU-B": 50, "GHOST": 10 });
	assert.equal(result.promotedSkus.length, 2);
	assert.ok(result.promotedSkus.includes("SKU-A"));
	assert.ok(result.promotedSkus.includes("SKU-B"));
});

test("previewPromotions does not mutate catalog prices", () => {
	const catalog = makeCatalog();
	previewPromotions(catalog, { "SKU-A": 10 });
	assert.equal(catalog["SKU-A"].price, 100, "preview should not mutate prices");
});

test("previewPromotions returns correct savings per item", () => {
	const preview = previewPromotions(makeCatalog(), { "SKU-A": 70, "SKU-B": 50 });
	const a = preview.find(p => p.sku === "SKU-A");
	assert.ok(a);
	assert.equal(a.originalPrice, 100);
	assert.equal(a.promoPrice, 70);
	assert.equal(a.savings, 30);
});
