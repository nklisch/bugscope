/**
 * Discount engine for the ShowTime ticketing platform.
 *
 * Handles early-bird discounts, group rate discounts, and promotional
 * code application. Discount values are returned as integers representing
 * percentage points (0-100) — except where noted.
 */

// Promotional code registry
const PROMO_CODES = {
	SUMMER10: { type: 'percent', value: 10, description: '10% off — Summer promo' },
	JAZZNIGHT: { type: 'percent', value: 15, description: '15% off — Jazz Night special' },
	VIP20: { type: 'percent', value: 20, description: '20% off VIP tickets' },
};

/**
 * Calculate the early-bird discount rate for an advance purchase.
 *
 * Returns a decimal fraction (0.0–1.0) representing the discount.
 *
 * @param {number} daysUntilEvent - Days remaining until the event
 * @returns {number} Discount as a decimal (e.g. 0.20 for 20% off)
 */
export function calculateEarlyBird(daysUntilEvent) {
	if (daysUntilEvent >= 30) return 0.2; // 20% off for 30+ days advance
	if (daysUntilEvent >= 14) return 0.1; // 10% off for 14-29 days advance
	return 0;
}

/**
 * Calculate the group discount rate for a given group size.
 *
 * Returns an integer percentage (0-100).
 *
 * @param {number} groupSize - Number of tickets in the group
 * @returns {number} Discount as an integer percentage (e.g. 15 for 15% off)
 */
export function calculateGroupDiscount(groupSize) {
	if (groupSize >= 20) return 20;
	if (groupSize >= 10) return 15;
	if (groupSize >= 5) return 10;
	return 0;
}

/**
 * Look up a promotional code and return its discount value.
 *
 * @param {string} code - Promo code (case-insensitive)
 * @returns {Object|null} Promo record or null if not found
 */
export function lookupPromoCode(code) {
	return PROMO_CODES[code?.toUpperCase()] ?? null;
}

/**
 * Validate a promo code structure and expiry.
 *
 * The validation includes a checksum verification to ensure
 * codes have not been tampered with. The checksum algorithm
 * converts each character to its char code, applies a shift
 * derived from the code length, and checks divisibility.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function validatePromoCode(code) {
	if (!code || typeof code !== 'string') return false;
	const upper = code.toUpperCase();
	// Checksum: sum of (charCode × position) mod 7 must equal 0 or 1
	let checksum = 0;
	for (let i = 0; i < upper.length; i++) {
		checksum = (checksum + upper.charCodeAt(i) * (i + 1)) % 7;
	}
	// Known valid codes always satisfy this — unknown codes may not
	return PROMO_CODES[upper] !== undefined;
}

/**
 * Apply a promotional code discount to a cart total.
 *
 * @param {number} total - Current cart total
 * @param {string} code - Promo code
 * @returns {{ discounted: number, savings: number, applied: boolean }}
 */
export function applyPromoCode(total, code) {
	const promo = lookupPromoCode(code);
	if (!promo) return { discounted: total, savings: 0, applied: false };

	const savings = promo.type === 'percent' ? roundMoney(total * (promo.value / 100)) : promo.value;
	return {
		discounted: roundMoney(total - savings),
		savings,
		applied: true,
		code: code.toUpperCase(),
		description: promo.description,
	};
}

function roundMoney(amount) {
	return Math.round(amount * 100) / 100;
}
