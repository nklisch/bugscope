/**
 * Utility helpers for the ShopEasy e-commerce checkout pipeline.
 *
 * Currency formatting, validation helpers, and — most importantly —
 * a convenience extension to Array for summation.
 */

/**
 * Round to 2 decimal places (monetary rounding).
 *
 * @param {number} n
 * @returns {number}
 */
export function roundMoney(n) {
	return Math.round(n * 100) / 100;
}

/**
 * Format a number as a USD price string.
 *
 * @param {number} amount
 * @returns {string} e.g. "$14.99"
 */
export function formatPrice(amount) {
	if (typeof amount !== 'number' || isNaN(amount)) return '$NaN';
	return `$${amount.toFixed(2)}`;
}

/**
 * Validate that a SKU is in the correct format (3-letter prefix + dash + 3 digits).
 *
 * @param {string} sku
 * @returns {boolean}
 */
export function isValidSku(sku) {
	return typeof sku === 'string' && /^[A-Z]{2,4}-\d{3}$/.test(sku);
}

/**
 * Validate an ISO 3166-1 alpha-2 region code (US state abbreviation format).
 *
 * @param {string} region
 * @returns {boolean}
 */
export function isValidRegion(region) {
	return typeof region === 'string' && /^US-[A-Z]{2,}$/.test(region);
}

/**
 * Clamp a number between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

/**
 * Deep-clone an object via JSON serialisation.
 * Note: properties with undefined values are dropped by JSON.stringify.
 *
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Convenience sum method added to Array.prototype.
 * Allows: [1, 2, 3].sum() → 6
 *
 * Used in the receipt and reporting modules for concise aggregation.
 */
Array.prototype.sum = function () {
	return this.reduce((acc, val) => acc + val, 0);
};

/**
 * Generate a simple order ID string.
 *
 * @returns {string} e.g. "ORD-1704067200000"
 */
export function generateOrderId() {
	return `ORD-${Date.now()}`;
}

/**
 * Parse a US price string like "$14.99" or "14.99" to a number.
 *
 * @param {string} priceStr
 * @returns {number}
 */
export function parsePrice(priceStr) {
	if (typeof priceStr === 'number') return priceStr;
	return parseFloat(String(priceStr).replace(/[$,]/g, ''));
}
