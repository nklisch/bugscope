/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-inventory.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInventoryMap, checkReorderNeeds } from "./inventory.ts";

const products = [
	{ sku: "WDG-001", name: "Widget A", category: "widgets", stock: 5, reorderThreshold: 10, unitCost: 2.50 },
	{ sku: "WDG-002", name: "Widget B", category: "widgets", stock: 50, reorderThreshold: 20, unitCost: 3.00 },
	{ sku: "GDG-001", name: "Gadget X", category: "gadgets", stock: 8, reorderThreshold: 15, unitCost: 5.00 },
];

test("checkReorderNeeds handles SKUs not in inventory", () => {
	const inventory = buildInventoryMap(products);
	// "DISC-999" was a discontinued product — not in inventory
	// Should skip unknown SKUs (or treat stock as 0), not crash
	assert.doesNotThrow(() => {
		checkReorderNeeds(inventory, ["WDG-001", "DISC-999", "GDG-001"]);
	}, "should not throw TypeError for missing SKUs");
});

test("checkReorderNeeds identifies low-stock items correctly", () => {
	const inventory = buildInventoryMap(products);
	const report = checkReorderNeeds(inventory, ["WDG-001", "WDG-002", "GDG-001"]);
	// WDG-001 (5 <= 10) and GDG-001 (8 <= 15) are low stock; WDG-002 (50 > 20) is fine
	assert.equal(report.lowStock.length, 2, `Expected 2 low-stock items, got ${report.lowStock.length}`);
});
