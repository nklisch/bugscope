/**
 * Promotional campaign engine for ShopEasy.
 *
 * Processes bundle deals and coupon codes.
 * Bundles are applied first, then coupons are validated and applied.
 *
 * TODO: handle timezone edge cases for flash sales that expire at midnight
 */

import { getBundles } from './config.js';
import { roundMoney } from './utils.js';

// Known coupon codes — in production this would come from a database
const COUPON_REGISTRY = {
	SAVE5: { code: 'SAVE5', discount: 5.0, minimumSpend: 40.0, description: '$5 off orders over $40' },
	SAVE10: { code: 'SAVE10', discount: 10.0, minimumSpend: 50.0, description: '$10 off orders over $50' },
	SAVE20: { code: 'SAVE20', discount: 20.0, minimumSpend: 100.0, description: '$20 off orders over $100' },
	FREESHIP: { code: 'FREESHIP', discount: 0, minimumSpend: 0, freeShipping: true, description: 'Free shipping' },
};

/**
 * Look up a coupon by code.
 *
 * @param {string} code
 * @returns {Object | null}
 */
export function lookupCoupon(code) {
	return COUPON_REGISTRY[code?.toUpperCase()] ?? null;
}

/**
 * Apply bundle deals to the cart.
 *
 * A bundle deal reduces currentTotal when the cart contains the
 * required SKU(s) at the minimum quantity.
 *
 * @param {Object} cart
 * @returns {Object}
 */
export function applyBundles(cart) {
	const bundles = getBundles();

	for (const bundle of bundles) {
		// Check if all required SKUs are in the cart with sufficient quantity
		const qualifies = bundle.requiredSkus.every((sku) => {
			const item = cart.items.find((i) => i.sku === sku);
			return item && item.quantity >= bundle.minQuantity;
		});

		if (qualifies) {
			const discountFraction = bundle.discountPercent / 100;
			const bundleDiscount = roundMoney(cart.currentTotal * discountFraction);
			cart.currentTotal = roundMoney(cart.currentTotal - bundleDiscount);
			cart.appliedBundles.push({
				id: bundle.id,
				description: bundle.description,
				discount: bundleDiscount,
			});
		}
	}

	return cart;
}

/**
 * Validate a coupon hash (simulates HMAC verification for promo integrity).
 * Checks that the coupon code follows the expected format and is in the registry.
 *
 * In production, coupon codes are signed; this validates the expected structure.
 *
 * @param {string} code - Coupon code to validate
 * @param {string} [sessionToken] - Optional session token for personalised coupons
 * @returns {{ valid: boolean, reason: string }}
 */
export function validateCouponHash(code, sessionToken) {
	if (!code || typeof code !== 'string') {
		return { valid: false, reason: 'code must be a non-empty string' };
	}
	// Format: 4-10 uppercase letters/digits
	if (!/^[A-Z0-9]{4,10}$/.test(code.toUpperCase())) {
		return { valid: false, reason: 'invalid code format' };
	}
	const coupon = lookupCoupon(code);
	if (!coupon) {
		return { valid: false, reason: 'code not recognised' };
	}
	// Personalised coupons (containing customer segment marker) require session
	if (code.includes('VIP') && !sessionToken) {
		return { valid: false, reason: 'VIP coupons require an active session' };
	}
	return { valid: true, reason: 'OK' };
}

/**
 * Apply a coupon code to the cart.
 *
 * Validates the minimum spend requirement against the ORIGINAL cart subtotal
 * before any discounts were applied.
 *
 * @param {Object} cart
 * @param {string} couponCode
 * @returns {Object}
 */
export function applyCoupon(cart, couponCode) {
	const coupon = lookupCoupon(couponCode);
	if (!coupon) return cart;

	// Check minimum spend against the original subtotal, not the post-bundle currentTotal
	if (cart.subtotal < coupon.minimumSpend) {
		return cart;
	}

	if (coupon.discount > 0) {
		cart.currentTotal = roundMoney(cart.currentTotal - coupon.discount);
	}
	if (coupon.freeShipping) {
		cart.freeShipping = true;
	}
	cart.appliedCoupons.push({ code: couponCode, discount: coupon.discount });

	return cart;
}

/**
 * Get a text summary of all promotions applied to the cart.
 *
 * @param {Object} cart
 * @returns {string[]}
 */
export function getPromotionSummary(cart) {
	const lines = [];
	for (const bundle of cart.appliedBundles ?? []) {
		lines.push(`Bundle "${bundle.description}": -$${bundle.discount.toFixed(2)}`);
	}
	for (const coupon of cart.appliedCoupons ?? []) {
		lines.push(`Coupon "${coupon.code}": -$${coupon.discount.toFixed(2)}`);
	}
	return lines;
}
