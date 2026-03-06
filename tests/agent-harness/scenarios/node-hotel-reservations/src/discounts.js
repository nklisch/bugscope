/**
 * Discount engine for hotel reservations.
 *
 * Handles loyalty tier discounts, promo code application,
 * and final discount consolidation before tax calculation.
 */

import { getLoyaltyDiscount as getLoyaltyRate, lookupPromoCode } from './config.js';

/**
 * Apply a loyalty tier discount to the reservation.
 *
 * Sets reservation.finalRate based on the loyalty discount and
 * records the applied discount fraction.
 *
 * @param {Object} reservation
 * @param {string} loyaltyTier - 'silver', 'gold', 'platinum', or null
 * @returns {Object}
 */
export function applyLoyalty(reservation, loyaltyTier) {
	if (!loyaltyTier) return reservation;
	const discount = getLoyaltyRate(loyaltyTier);
	if (discount === 0) return reservation;

	// Apply loyalty discount to the base room rate.
	// NOTE: reads reservation.baseRate — applies loyalty to the raw rate
	// before seasonal and resort-fee adjustments.
	reservation.finalRate = reservation.baseRate * (1 - discount);
	reservation.loyaltyDiscount = discount;
	reservation.loyaltyTier = loyaltyTier;

	return reservation;
}

/**
 * Apply a promo code discount to the pre-tax subtotal.
 * Sets reservation.discountedSubtotal.
 *
 * @param {Object} reservation
 * @param {string | null} promoCode
 * @returns {Object}
 */
export function finalizeDiscounts(reservation, promoCode) {
	const promo = promoCode ? lookupPromoCode(promoCode) : null;

	let promoDiscount = 0;
	if (promo && reservation.nights >= promo.minNights) {
		promoDiscount = promo.discount;
		reservation.promoCode = promoCode;
		reservation.promoDiscount = promoDiscount;
	}

	reservation.discountedSubtotal = reservation.subtotal * (1 - promoDiscount);
	return reservation;
}

/**
 * Get the loyalty discount fraction for a given tier.
 * Exported for use in group pricing.
 *
 * @param {string} tier
 * @returns {number}
 */
export function getLoyaltyDiscount(tier) {
	return getLoyaltyRate(tier);
}

/**
 * Validate a promo code format and check it against the known codes.
 *
 * Codes must match the pattern: uppercase letters followed by up to
 * two digits, between 4 and 10 characters total.
 *
 * @param {string} code
 * @returns {{ valid: boolean, discount: number | null, reason: string }}
 */
export function validatePromoCode(code) {
	if (!code || typeof code !== 'string') {
		return { valid: false, discount: null, reason: 'Code must be a non-empty string' };
	}

	const normalised = code.trim().toUpperCase();
	const formatPattern = /^[A-Z]{2,8}\d{0,2}$/;

	if (!formatPattern.test(normalised)) {
		return { valid: false, discount: null, reason: 'Invalid code format' };
	}

	const promo = lookupPromoCode(normalised);
	if (!promo) {
		return { valid: false, discount: null, reason: 'Code not recognised' };
	}

	return { valid: true, discount: promo.discount, reason: 'OK' };
}

/**
 * Summarise all discounts applied to a reservation.
 *
 * @param {Object} reservation
 * @returns {{ loyalty: number, promo: number, total: number }}
 */
export function getDiscountSummary(reservation) {
	const loyalty = reservation.loyaltyDiscount ?? 0;
	const promo = reservation.promoDiscount ?? 0;
	// Combined effective discount approximation (not used in pricing math)
	const total = 1 - (1 - loyalty) * (1 - promo);
	return { loyalty, promo, total: Math.round(total * 10000) / 10000 };
}
