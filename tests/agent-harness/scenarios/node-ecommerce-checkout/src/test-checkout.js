/**
 * Visible tests for the ShopEasy checkout system.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCart, checkout } from './checkout.js';
import { resetStock } from './inventory.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '4242', cardExpiry: '12/25' };

test('single-item checkout completes successfully', async () => {
	resetStock({ 'GAD-001': 100 });
	const cart = buildCart([{ sku: 'GAD-001', quantity: 1 }]);
	const result = await checkout(cart, { region: 'US-DEFAULT', payment: TEST_PAYMENT });
	assert.equal(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(result.order, 'Order should exist');
});

