/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-orders.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { processOrders } from "./orders.ts";

test("grand total is the sum of all orders", () => {
	const orders = [
		{ id: "O1", customerId: "C1", quantity: 2, price: 50, status: "confirmed" as const },
		{ id: "O2", customerId: "C2", quantity: 1, price: 80, status: "confirmed" as const },
		{ id: "O3", customerId: "C3", quantity: 3, price: 30, status: "confirmed" as const },
	];
	const summary = processOrders(orders);
	// O1: 2*50=100, O2: 1*80=80, O3: 3*30=90 → total should be 270
	assert.equal(summary.grandTotal, 270, `Expected grandTotal 270, got ${summary.grandTotal}`);
});

test("single order returns correct total", () => {
	const orders = [{ id: "O1", customerId: "C1", quantity: 5, price: 20, status: "pending" as const }];
	const summary = processOrders(orders);
	assert.equal(summary.grandTotal, 100, `Expected grandTotal 100, got ${summary.grandTotal}`);
});
