/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { processOrders, filterOrders, summarizeByOrder } from "./orders.js";

test("grand total is correct for multiple orders", () => {
	const orders = [
		{ id: "A", quantity: 2, price: 10 },
		{ id: "B", quantity: 3, price: 5 },
		{ id: "C", quantity: 1, price: 20 },
	];
	const result = processOrders(orders);
	assert.equal(result.grandTotal, 55);
});

test("single order grand total equals its line value", () => {
	const orders = [{ id: "X", quantity: 4, price: 7 }];
	const result = processOrders(orders);
	assert.equal(result.grandTotal, 28);
});

test("grand total is correct when all quantities are 1", () => {
	const orders = [
		{ id: "a", quantity: 1, price: 10 },
		{ id: "b", quantity: 1, price: 20 },
		{ id: "c", quantity: 1, price: 30 },
	];
	const result = processOrders(orders);
	assert.equal(result.grandTotal, 60);
});

test("order count is correct", () => {
	const orders = [
		{ id: "a", quantity: 1, price: 5 },
		{ id: "b", quantity: 2, price: 10 },
	];
	const result = processOrders(orders);
	assert.equal(result.orderCount, 2);
});

test("throws for negative total", () => {
	const orders = [{ id: "bad", quantity: -1, price: 10 }];
	assert.throws(() => processOrders(orders), /Negative total/);
});

test("filterOrders keeps orders at or above minimum", () => {
	const orders = [
		{ id: "a", quantity: 1, price: 5 },   // 5 < 10, excluded
		{ id: "b", quantity: 2, price: 10 },  // 20 >= 10, included
		{ id: "c", quantity: 1, price: 15 },  // 15 >= 10, included
	];
	const filtered = filterOrders(orders, 10);
	assert.equal(filtered.length, 2);
});

test("summarizeByOrder groups correctly", () => {
	const orders = [
		{ id: "a", quantity: 2, price: 5 },
		{ id: "b", quantity: 1, price: 10 },
		{ id: "a", quantity: 1, price: 5 },
	];
	const summary = summarizeByOrder(orders);
	assert.equal(summary["a"], 15);
	assert.equal(summary["b"], 10);
});

test("regression: total not accumulated from last validation value", () => {
	// If bug present: last validation value (20) is added to accumulation
	// so result would be 20 + 55 = 75, not 55
	const orders = [
		{ id: "A", quantity: 2, price: 10 },
		{ id: "B", quantity: 3, price: 5 },
		{ id: "C", quantity: 1, price: 20 }, // last validation total = 20
	];
	const result = processOrders(orders);
	assert.notEqual(result.grandTotal, 75, "grandTotal should not include the validation pass residual");
	assert.equal(result.grandTotal, 55);
});
