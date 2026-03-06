/**
 * Visible failing tests for the ShopEasy checkout system.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCart, checkout } from './checkout.js';
import { applyVolumePricing } from './pricing.js';
import { applyBundles, applyCoupon } from './promotions.js';
import { reserveItems, resetStock } from './inventory.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '4242', cardExpiry: '12/25' };

test('volume pricing: 30 units of WGT-001 should get 10% (bulk-25) discount', () => {
	const cart = buildCart([{ sku: 'WGT-001', quantity: 30 }]);
	applyVolumePricing(cart);
	const item = cart.items.find((i) => i.sku === 'WGT-001');
	assert.equal(item.volumeDiscount, 0.10, `Expected 10% volume discount, got ${item.volumeDiscount * 100}%`);
});

test('coupon SAVE10 ($10 off, $50 minimum) should NOT apply after bundle reduces total below $50', () => {
	const cart = buildCart([{ sku: 'WGT-001', quantity: 4 }]);
	// Cart subtotal: 4 * 12.99 = $51.96
	applyVolumePricing(cart);
	// After vol pricing (3% at qty=4, tier "5" doesn't apply yet actually... qty=4 < 5, so no discount)
	// Actually: qty=4 < 5, so no volume discount. currentTotal = 51.96
	// No bundle applies (need qty >= 3 of WGT-001, but BUNDLE_WIDGETS needs minQuantity=3, so it DOES apply)
	// After bundle (10% off): 51.96 * 0.90 = 46.764 = 46.76
	// SAVE10 minimum is $50. Post-bundle total is $46.76, so coupon should NOT apply
	applyBundles(cart);
	applyCoupon(cart, 'SAVE10');
	const couponApplied = cart.appliedCoupons.some((c) => c.code === 'SAVE10');
	assert.equal(couponApplied, false, `SAVE10 should not apply when post-bundle total ${cart.currentTotal} < $50 minimum`);
});

test('inventory reservation: 3 items with quantities [5, 3, 2] reserves 10 total units', async () => {
	resetStock({ 'WGT-001': 100, 'WGT-002': 100, 'WGT-003': 100 });
	const items = [
		{ sku: 'WGT-001', quantity: 5 },
		{ sku: 'WGT-002', quantity: 3 },
		{ sku: 'WGT-003', quantity: 2 },
	];
	const total = await reserveItems(items);
	assert.equal(total, 10, `Expected 10 total reserved, got ${total}`);
});

test('simple single-item checkout completes (control)', async () => {
	resetStock({ 'GAD-001': 100 });
	const cart = buildCart([{ sku: 'GAD-001', quantity: 1 }]);
	const result = await checkout(cart, { region: 'US-DEFAULT', payment: TEST_PAYMENT });
	assert.equal(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(result.order, 'Order should exist');
});

test('order total is a finite number (not NaN)', async () => {
	resetStock({ 'WGT-001': 100, 'ACC-001': 100, 'TOL-001': 100 });
	const cart = buildCart([
		{ sku: 'WGT-001', quantity: 2 },
		{ sku: 'ACC-001', quantity: 1 },
		{ sku: 'TOL-001', quantity: 3 },
	]);
	const result = await checkout(cart, { region: 'US-CA', payment: TEST_PAYMENT });
	assert.equal(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(isFinite(result.order.orderTotal), `orderTotal should be a finite number, got ${result.order.orderTotal}`);
});
