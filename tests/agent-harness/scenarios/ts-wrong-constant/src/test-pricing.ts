/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-pricing.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { calculatePrice, generateInvoice } from "./pricing.ts";

test("gold tier gets 10% discount, not 100%", () => {
	const price = calculatePrice(100, "gold");
	assert.equal(price, 90, `Expected gold price to be $90 (10% off $100), got $${price}`);
});

test("invoice subtotal is correct for gold customer", () => {
	const items = [
		{ name: "Widget", price: 50, qty: 2 },
		{ name: "Gadget", price: 100, qty: 1 },
	];
	const invoice = generateInvoice(items, "gold");
	// Gold discount is 10%, so: (50*0.9*2) + (100*0.9*1) = 90 + 90 = 180
	assert.equal(invoice.subtotal, 180, `Expected subtotal $180, got $${invoice.subtotal}`);
});
