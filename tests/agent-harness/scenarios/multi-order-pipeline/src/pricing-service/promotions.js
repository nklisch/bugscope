/**
 * Promotion rules and coupon validation.
 *
 * Coupons are validated against a SHA-256 HMAC to prevent forgery.
 * Volume tiers are applied per-product based on quantity ordered.
 */

import { createHmac } from "node:crypto";

const COUPON_SECRET = process.env.COUPON_SECRET || "dev-secret-change-in-prod";

const ACTIVE_PROMOTIONS = [
	{
		id: "PROMO-SUMMER",
		name: "Summer Sale",
		discountRate: 0.05,
		categories: ["home"],
		minOrderValue: 50.0,
		active: true,
	},
	{
		id: "PROMO-BULK",
		name: "Bulk Buyer Discount",
		discountRate: 0.03,
		categories: ["office"],
		minOrderValue: 100.0,
		active: true,
	},
];

/** Volume discount tiers — applied per product line item by quantity. */
const VOLUME_TIERS = [
	{ minQty: 25, rate: 0.15 },
	{ minQty: 10, rate: 0.10 },
	{ minQty: 5,  rate: 0.07 },
];

/**
 * Get the volume discount rate for a given quantity.
 * Returns a decimal fraction (0.15 = 15% off).
 */
export function getVolumeDiscount(quantity) {
	for (const tier of VOLUME_TIERS) {
		if (quantity >= tier.minQty) {
			return tier.rate;
		}
	}
	return 0;
}

/**
 * Validate a coupon code using HMAC-SHA256.
 * Returns the discount rate if valid, 0 otherwise.
 */
export function validateCoupon(code) {
	if (!code || typeof code !== "string") return 0;

	const parts = code.split(":");
	if (parts.length !== 3) return 0;

	const [id, rate, sig] = parts;
	const expected = createHmac("sha256", COUPON_SECRET)
		.update(`${id}:${rate}`)
		.digest("hex")
		.slice(0, 16);

	if (sig !== expected) return 0;

	const discountRate = parseFloat(rate);
	if (isNaN(discountRate) || discountRate <= 0 || discountRate > 0.5) return 0;

	return discountRate;
}

/**
 * Apply active promotions to an order.
 * @param {Array<{productId: string, category: string, lineTotal: number}>} items
 * @param {number} orderSubtotal
 * @param {string} [couponCode]
 * @returns {{ promotionDiscount: number, couponDiscount: number }}
 */
export function applyPromotions(items, orderSubtotal, couponCode) {
	let promotionDiscount = 0;

	for (const promo of ACTIVE_PROMOTIONS) {
		if (!promo.active) continue;
		if (orderSubtotal < promo.minOrderValue) continue;

		const eligibleTotal = items
			.filter(item => promo.categories.includes(item.category))
			.reduce((sum, item) => sum + item.lineTotal, 0);

		promotionDiscount += Math.round(eligibleTotal * promo.discountRate * 100) / 100;
	}

	const couponRate = validateCoupon(couponCode);
	const couponDiscount = Math.round(orderSubtotal * couponRate * 100) / 100;

	return { promotionDiscount, couponDiscount };
}

export function listPromotions() {
	return ACTIVE_PROMOTIONS.filter(p => p.active).map(p => ({
		id: p.id,
		name: p.name,
		discountRate: p.discountRate,
		categories: p.categories,
		minOrderValue: p.minOrderValue,
	}));
}
