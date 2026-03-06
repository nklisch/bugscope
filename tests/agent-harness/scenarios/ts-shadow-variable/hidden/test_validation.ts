/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ordersByStatus, processOrders } from "./orders.ts";

test("grand total sums all orders correctly", () => {
	const orders = [
		{ id: "O1", customerId: "C1", quantity: 2, price: 50, status: "confirmed" as const },
		{ id: "O2", customerId: "C2", quantity: 1, price: 80, status: "confirmed" as const },
		{ id: "O3", customerId: "C3", quantity: 3, price: 30, status: "confirmed" as const },
	];
	const summary = processOrders(orders);
	assert.equal(summary.grandTotal, 270);
	assert.equal(summary.orderCount, 3);
});

test("single order returns exact value", () => {
	const orders = [{ id: "O1", customerId: "C1", quantity: 5, price: 20, status: "pending" as const }];
	const summary = processOrders(orders);
	assert.equal(summary.grandTotal, 100);
	assert.equal(summary.orderCount, 1);
});

test("empty orders returns zero totals", () => {
	const summary = processOrders([]);
	assert.equal(summary.grandTotal, 0);
	assert.equal(summary.orderCount, 0);
	assert.equal(summary.averageOrderValue, 0);
});

test("average order value is correct", () => {
	const orders = [
		{ id: "O1", customerId: "C1", quantity: 1, price: 100, status: "confirmed" as const },
		{ id: "O2", customerId: "C2", quantity: 1, price: 200, status: "confirmed" as const },
	];
	const summary = processOrders(orders);
	assert.equal(summary.grandTotal, 300);
	assert.equal(summary.averageOrderValue, 150);
});

test("two-order total is not inflated by validation loop", () => {
	// Regression: before fix, validation loop leaves total = last order value
	// so accumulation starts from that value instead of 0
	const orders = [
		{ id: "O1", customerId: "C1", quantity: 1, price: 10, status: "pending" as const },
		{ id: "O2", customerId: "C2", quantity: 1, price: 20, status: "pending" as const },
	];
	const summary = processOrders(orders);
	// Correct: 10 + 20 = 30
	// Bug would give: 20 (last validation value) + 10 + 20 = 50
	assert.equal(summary.grandTotal, 30, `Expected 30, got ${summary.grandTotal} — check that total is reset before accumulation loop`);
});

test("ordersByStatus groups correctly", () => {
	const orders = [
		{ id: "O1", customerId: "C1", quantity: 2, price: 10, status: "pending" as const },
		{ id: "O2", customerId: "C2", quantity: 1, price: 30, status: "confirmed" as const },
		{ id: "O3", customerId: "C3", quantity: 1, price: 50, status: "confirmed" as const },
	];
	const result = ordersByStatus(orders);
	assert.equal(result.pending.count, 1);
	assert.equal(result.pending.subtotal, 20);
	assert.equal(result.confirmed.count, 2);
	assert.equal(result.confirmed.subtotal, 80);
});
