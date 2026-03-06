/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-promotions.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPromotions } from "./promotions.ts";

test("avgOriginalPrice reflects prices before promotions were applied", () => {
	const catalog = {
		"SKU-A": { name: "Widget A", price: 100, category: "widgets", stock: 50 },
		"SKU-B": { name: "Widget B", price: 80, category: "widgets", stock: 30 },
		"SKU-C": { name: "Gadget X", price: 60, category: "gadgets", stock: 20 },
	};

	const promotions = {
		"SKU-A": 70, // was $100, now $70
		"SKU-B": 50, // was $80, now $50
	};

	const result = applyPromotions(catalog, promotions);

	// Average of ORIGINAL prices: (100 + 80 + 60) / 3 = 80
	assert.equal(result.avgOriginalPrice, 80, `Expected avgOriginalPrice 80, got ${result.avgOriginalPrice}`);
});

test("totalSavings is the sum of all discounts applied", () => {
	const catalog = {
		"SKU-A": { name: "Widget A", price: 100, category: "widgets", stock: 50 },
		"SKU-B": { name: "Widget B", price: 80, category: "widgets", stock: 30 },
	};

	const promotions = {
		"SKU-A": 70, // saves $30
		"SKU-B": 60, // saves $20
	};

	const result = applyPromotions(catalog, promotions);
	assert.equal(result.totalSavings, 50, `Expected totalSavings 50, got ${result.totalSavings}`);
});
