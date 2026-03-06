/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInventoryMap, checkReorderNeeds, getLowStockProducts } from "./inventory.ts";

const products = [
	{ sku: "WDG-001", name: "Widget A", category: "widgets", stock: 5, reorderThreshold: 10, unitCost: 2.50 },
	{ sku: "WDG-002", name: "Widget B", category: "widgets", stock: 50, reorderThreshold: 20, unitCost: 3.00 },
	{ sku: "GDG-001", name: "Gadget X", category: "gadgets", stock: 8, reorderThreshold: 15, unitCost: 5.00 },
];

test("does not throw for unknown SKUs", () => {
	const inventory = buildInventoryMap(products);
	assert.doesNotThrow(() => {
		checkReorderNeeds(inventory, ["WDG-001", "UNKNOWN-SKU", "GDG-001"]);
	});
});

test("does not throw for all-unknown SKU list", () => {
	const inventory = buildInventoryMap(products);
	assert.doesNotThrow(() => {
		checkReorderNeeds(inventory, ["DISC-001", "DISC-002"]);
	});
});

test("identifies low-stock items from known SKUs", () => {
	const inventory = buildInventoryMap(products);
	const report = checkReorderNeeds(inventory, ["WDG-001", "WDG-002", "GDG-001"]);
	assert.equal(report.lowStock.length, 2);
});

test("does not count unknown SKUs as low-stock", () => {
	const inventory = buildInventoryMap(products);
	const report = checkReorderNeeds(inventory, ["WDG-001", "UNKNOWN-SKU", "GDG-001"]);
	// Unknown SKU should be skipped, not counted as low stock
	assert.equal(report.lowStock.length, 2, "only real low-stock items should be reported");
});

test("total stock only counts known SKUs", () => {
	const inventory = buildInventoryMap(products);
	const report = checkReorderNeeds(inventory, ["WDG-001", "WDG-002"]);
	// WDG-001: 5, WDG-002: 50 → total 55
	assert.equal(report.totalStock, 55);
});

test("empty SKU list returns zero report", () => {
	const inventory = buildInventoryMap(products);
	const report = checkReorderNeeds(inventory, []);
	assert.equal(report.lowStock.length, 0);
	assert.equal(report.totalStock, 0);
	assert.equal(report.averageStock, 0);
});

test("getLowStockProducts finds all threshold violations", () => {
	const inventory = buildInventoryMap(products);
	const low = getLowStockProducts(inventory);
	assert.equal(low.length, 2);
	const skus = low.map(p => p.sku).sort();
	assert.deepEqual(skus, ["GDG-001", "WDG-001"]);
});
