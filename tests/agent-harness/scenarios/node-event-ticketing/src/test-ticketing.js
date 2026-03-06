/**
 * Visible tests for the ShowTime ticketing platform.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout, applyDiscount } from './checkout.js';
import { calculateGroupDiscount } from './discounts.js';
import { resetLockedSeats } from './inventory.js';
import { clearConfigCache } from './config.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '4242', cardExpiry: '12/27' };

test('single lower-tier ticket checkout for jazz event completes', async () => {
	clearConfigCache();
	resetLockedSeats();
	const result = await checkout('EVT-002', [{ seatId: 'LOWER-D-1' }], { payment: TEST_PAYMENT });
	assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(result.order, 'Order object should exist');
});

test('group discount of 15% applies correctly for group of 10', () => {
	const discount = calculateGroupDiscount(10);
	const discountedPrice = applyDiscount(100, discount);
	assert.ok(Math.abs(discountedPrice - 85) < 0.01, `Expected $85.00, got $${discountedPrice.toFixed(2)}`);
});

test('3-seat purchase order contains correct ticket count', async () => {
	clearConfigCache();
	resetLockedSeats();
	const result = await checkout(
		'EVT-002',
		[{ seatId: 'LOWER-D-2' }, { seatId: 'LOWER-D-3' }, { seatId: 'LOWER-D-6' }],
		{ payment: TEST_PAYMENT },
	);
	assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
	assert.strictEqual(result.order.ticketCount, 3, `Expected 3 tickets, got ${result.order.ticketCount}`);
});
