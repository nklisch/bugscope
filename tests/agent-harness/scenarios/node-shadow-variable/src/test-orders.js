/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { processOrders } from "./orders.js";

test("grand total is sum of all order line values", () => {
	const orders = [
		{ id: "A", quantity: 2, price: 10 },
		{ id: "B", quantity: 3, price: 5 },
		{ id: "C", quantity: 1, price: 20 },
	];
	// Expected: 2*10 + 3*5 + 1*20 = 20 + 15 + 20 = 55
	const result = processOrders(orders);
	assert.equal(result.grandTotal, 55, `Expected grandTotal=55, got ${result.grandTotal}`);
});

test("single order grand total equals its line value", () => {
	const orders = [{ id: "X", quantity: 4, price: 7 }];
	const result = processOrders(orders);
	assert.equal(result.grandTotal, 28, `Expected grandTotal=28, got ${result.grandTotal}`);
});
