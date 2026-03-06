/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePrice, generateInvoice, getDiscountPercent } from "./pricing.ts";

test("bronze gets 5% discount", () => {
	assert.equal(calculatePrice(100, "bronze"), 95);
});

test("silver gets 7% discount", () => {
	assert.equal(calculatePrice(100, "silver"), 93);
});

test("gold gets 10% discount", () => {
	assert.equal(calculatePrice(100, "gold"), 90);
});

test("platinum gets 15% discount", () => {
	assert.equal(calculatePrice(100, "platinum"), 85);
});

test("unknown tier gets no discount", () => {
	assert.equal(calculatePrice(100, "unknown"), 100);
});

test("gold discount percent is 10", () => {
	assert.equal(getDiscountPercent("gold"), 10);
});

test("invoice subtotal correct for gold", () => {
	const items = [{ name: "Widget", price: 50, qty: 2 }];
	const invoice = generateInvoice(items, "gold");
	// 50 * 0.9 * 2 = 90
	assert.equal(invoice.subtotal, 90);
});

test("invoice subtotal correct for platinum", () => {
	const items = [
		{ name: "A", price: 100, qty: 1 },
		{ name: "B", price: 200, qty: 2 },
	];
	const invoice = generateInvoice(items, "platinum");
	// (100*0.85) + (200*0.85*2) = 85 + 340 = 425
	assert.equal(invoice.subtotal, 425);
});

test("gold subtotal is not zero for non-zero items", () => {
	const items = [{ name: "X", price: 100, qty: 1 }];
	const invoice = generateInvoice(items, "gold");
	assert.ok(invoice.subtotal > 0, `subtotal should be > 0, got ${invoice.subtotal}`);
});

test("regression: gold discount is exactly 0.1 not 1.0", () => {
	const price = calculatePrice(100, "gold");
	assert.notEqual(price, 0, "gold price should not be 0 — discount is 10%, not 100%");
	assert.equal(price, 90);
});
