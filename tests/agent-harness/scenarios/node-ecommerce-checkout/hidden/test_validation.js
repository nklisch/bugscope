/**
 * Hidden oracle validation for node-ecommerce-checkout.
 * Tests each bug independently then verifies integrated behaviour.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, getVolumeTiers } from './config.js';
import { getVolumeTier, applyVolumePricing } from './pricing.js';
import { applyBundles, applyCoupon } from './promotions.js';
import { reserveItems, resetStock } from './inventory.js';
import { computeOrderTotal, buildLineItems } from './orders.js';
import { createCart, addItem, recalcSubtotal } from './cart.js';
import { buildCart, checkout } from './checkout.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '1234', cardExpiry: '06/26' };

describe('Bug 1 — volume tiers sorted lexicographically instead of numerically', () => {
	it('volume tiers must be sorted numerically: [5, 10, 25, 50, 100]', () => {
		const tiers = getVolumeTiers();
		const thresholds = tiers.map((t) => Number(t.threshold));
		for (let i = 1; i < thresholds.length; i++) {
			assert.ok(
				thresholds[i] > thresholds[i - 1],
				`Tiers must be in ascending numeric order; got ${thresholds[i - 1]} then ${thresholds[i]}`,
			);
		}
	});

	it('quantity 30 gets bulk-25 tier (10% discount)', () => {
		const tiers = getVolumeTiers();
		const tier = getVolumeTier(30, tiers);
		assert.strictEqual(tier.discount, 0.10, `Expected 10% for qty 30, got ${tier.discount * 100}%`);
		assert.strictEqual(tier.label, 'bulk-25', `Expected label 'bulk-25', got '${tier.label}'`);
	});

	it('quantity 7 gets bulk-5 tier (3% discount)', () => {
		const tiers = getVolumeTiers();
		const tier = getVolumeTier(7, tiers);
		assert.strictEqual(tier.discount, 0.03, `Expected 3% for qty 7, got ${tier.discount * 100}%`);
	});

	it('quantity 150 gets bulk-100 tier (20% discount)', () => {
		const tiers = getVolumeTiers();
		const tier = getVolumeTier(150, tiers);
		assert.strictEqual(tier.discount, 0.20, `Expected 20% for qty 150, got ${tier.discount * 100}%`);
	});

	it('30 units of WGT-001 ($12.99) with 10% off → line total 350.73', () => {
		const cart = buildCart([{ sku: 'WGT-001', quantity: 30 }]);
		applyVolumePricing(cart);
		const item = cart.items.find((i) => i.sku === 'WGT-001');
		assert.strictEqual(item.volumeDiscount, 0.10);
		// 12.99 * 0.90 = 11.69 (rounded), * 30 = 350.70 (may differ by rounding)
		assert.ok(Math.abs(item.lineTotal - 350.73) < 0.05, `Expected ~350.73, got ${item.lineTotal}`);
	});
});

describe('Bug 2 — coupon minimum-spend checked against pre-bundle subtotal', () => {
	it('SAVE10 minimum=$50: must NOT apply when post-bundle total is below $50', () => {
		const cart = createCart();
		addItem(cart, 'WGT-001', 4); // 4 * 12.99 = 51.96 subtotal
		applyVolumePricing(cart); // qty=4 < 5, no volume discount; currentTotal still 51.96
		applyBundles(cart); // BUNDLE_WIDGETS: 3+ qty WGT-001 → 10% off = 5.20 off → currentTotal ≈ 46.76
		const preApplication = cart.currentTotal;
		applyCoupon(cart, 'SAVE10');
		const couponApplied = cart.appliedCoupons.some((c) => c.code === 'SAVE10');
		assert.ok(
			preApplication < 50,
			`pre-coupon currentTotal should be < 50 (was ${preApplication}) for this test to be meaningful`,
		);
		assert.strictEqual(couponApplied, false, `SAVE10 should not apply; post-bundle total was $${preApplication}`);
	});

	it('SAVE5 minimum=$40: MUST apply when post-bundle total is above $40', () => {
		const cart = createCart();
		addItem(cart, 'WGT-001', 4); // subtotal 51.96, post-bundle ~46.76
		applyVolumePricing(cart);
		applyBundles(cart);
		applyCoupon(cart, 'SAVE5'); // min=$40, post-bundle ~46.76 > 40
		const couponApplied = cart.appliedCoupons.some((c) => c.code === 'SAVE5');
		assert.strictEqual(couponApplied, true, 'SAVE5 should apply when post-bundle total > $40 minimum');
	});

	it('bundle discount is applied before coupon eligibility check', () => {
		const cart = createCart();
		addItem(cart, 'WGT-001', 4);
		applyVolumePricing(cart);
		const beforeBundle = cart.currentTotal;
		applyBundles(cart);
		const afterBundle = cart.currentTotal;
		assert.ok(afterBundle < beforeBundle, `Bundle should reduce currentTotal: ${beforeBundle} → ${afterBundle}`);
	});
});

describe('Bug 3 — async inventory reservation race: concurrent reads lose updates', () => {
	it('reserveItems([{qty:5},{qty:3},{qty:2}]) returns 10', async () => {
		resetStock({ 'WGT-001': 100, 'WGT-002': 100, 'WGT-003': 100 });
		const items = [
			{ sku: 'WGT-001', quantity: 5 },
			{ sku: 'WGT-002', quantity: 3 },
			{ sku: 'WGT-003', quantity: 2 },
		];
		const total = await reserveItems(items);
		assert.strictEqual(total, 10, `Expected 10, got ${total} (race condition may have lost updates)`);
	});

	it('reserveItems([{qty:1}]) returns 1', async () => {
		resetStock({ 'GAD-001': 50 });
		const total = await reserveItems([{ sku: 'GAD-001', quantity: 1 }]);
		assert.strictEqual(total, 1);
	});

	it('reserveItems with 5 concurrent items sums quantities correctly', async () => {
		resetStock({ 'WGT-001': 100, 'WGT-002': 100, 'WGT-003': 100, 'GAD-001': 100, 'ACC-001': 100 });
		const items = [
			{ sku: 'WGT-001', quantity: 10 },
			{ sku: 'WGT-002', quantity: 7 },
			{ sku: 'WGT-003', quantity: 3 },
			{ sku: 'GAD-001', quantity: 15 },
			{ sku: 'ACC-001', quantity: 5 },
		];
		const total = await reserveItems(items);
		assert.strictEqual(total, 40, `Expected 40, got ${total}`);
	});
});

describe('Bug 4 — for...in on array iterates Array.prototype.sum key, causing NaN total', () => {
	it('computeOrderTotal returns a finite number (not NaN)', () => {
		const lineItems = [
			{ sku: 'WGT-001', quantity: 3, unitPrice: 12.99, lineTotal: 38.97 },
			{ sku: 'GAD-001', quantity: 2, unitPrice: 9.99, lineTotal: 19.98 },
			{ sku: 'ACC-001', quantity: 5, unitPrice: 4.99, lineTotal: 24.95 },
		];
		const total = computeOrderTotal(lineItems);
		assert.ok(isFinite(total), `Total must be finite, got ${total}`);
		assert.ok(!isNaN(total), `Total must not be NaN`);
	});

	it('computeOrderTotal returns correct sum: 3*12.99 + 2*9.99 + 5*4.99 = 83.90', () => {
		const lineItems = [
			{ sku: 'WGT-001', quantity: 3, unitPrice: 12.99, lineTotal: 38.97 },
			{ sku: 'GAD-001', quantity: 2, unitPrice: 9.99, lineTotal: 19.98 },
			{ sku: 'ACC-001', quantity: 5, unitPrice: 4.99, lineTotal: 24.95 },
		];
		const total = computeOrderTotal(lineItems);
		assert.ok(Math.abs(total - 83.90) < 0.02, `Expected 83.90, got ${total}`);
	});

	it('for...in on lineItems should NOT iterate prototype keys like "sum"', () => {
		const lineItems = [
			{ sku: 'WGT-001', quantity: 1, unitPrice: 10 },
			{ sku: 'WGT-002', quantity: 2, unitPrice: 20 },
		];
		const iteratedKeys = [];
		for (const k in lineItems) iteratedKeys.push(k);
		// After fix: only numeric indexes '0', '1' — not 'sum' from Array.prototype
		const hasPrototypeKey = iteratedKeys.some((k) => isNaN(Number(k)));
		// If this still fails, it means either for...in is still used without hasOwnProperty
		// OR Array.prototype.sum is still being added
		assert.strictEqual(hasPrototypeKey, false, `Prototype keys leaked into for...in: ${iteratedKeys.filter((k) => isNaN(Number(k)))}`);
	});
});

describe('Integration — full checkout with all bugs fixed', () => {
	it('30 units WGT-001 with bulk-25 tier and US-CA shipping completes correctly', async () => {
		resetStock({ 'WGT-001': 500 });
		const cart = buildCart([{ sku: 'WGT-001', quantity: 30 }]);
		const result = await checkout(cart, { region: 'US-CA', payment: TEST_PAYMENT });
		assert.strictEqual(result.success, true);
		assert.ok(isFinite(result.order.orderTotal));
		// productTotal ≈ 12.99 * 0.90 * 30 = 350.73; bundle also applies (3+ WGT-001)
		// After bundle (10% on 350.73): currentTotal ≈ 315.66
		// shipping + tax extra; total should be reasonable (>300, <500)
		assert.ok(result.order.orderTotal > 300, `Order total seems too low: ${result.order.orderTotal}`);
	});

	it('coupon SAVE10 applies when cart total stays above $50 after bundle', async () => {
		resetStock({ 'WGT-002': 100 });
		const cart = buildCart([{ sku: 'WGT-002', quantity: 4 }]); // 4 * 24.99 = $99.96
		// No bundle for WGT-002, so currentTotal stays $99.96, SAVE10 ($50 min) applies
		const result = await checkout(cart, { region: 'US-DEFAULT', coupon: 'SAVE10', payment: TEST_PAYMENT });
		assert.strictEqual(result.success, true);
		const couponApplied = result.order.appliedCoupons.some((c) => c.code === 'SAVE10');
		assert.strictEqual(couponApplied, true, 'SAVE10 should apply to $99.96 cart (above $50 min)');
	});
});
