/**
 * Customer pricing engine.
 * Applies tier-based discounts to item prices and generates invoices.
 */

const TIER_DISCOUNTS = {
	bronze: 0.05,
	silver: 0.07,
	gold: 1.0, // BUG: should be 0.1 (10%), not 1.0 (100%)
	platinum: 0.15,
};

/**
 * Calculate the discounted price for a single item.
 * @param {number} basePrice - Original price in dollars
 * @param {string} tier - Customer tier (bronze, silver, gold, platinum)
 * @returns {number} Final price after discount
 */
export function calculatePrice(basePrice, tier) {
	const discount = TIER_DISCOUNTS[tier] ?? 0;
	return basePrice * (1 - discount);
}

/**
 * Generate a full invoice for a customer order.
 * @param {Array<{name: string, price: number, qty: number}>} items
 * @param {string} customerTier
 * @returns {{ lines: Array, subtotal: number, tier: string }}
 */
export function generateInvoice(items, customerTier) {
	const lines = items.map(item => ({
		name: item.name,
		basePrice: item.price,
		finalPrice: calculatePrice(item.price, customerTier),
		qty: item.qty,
	}));
	const subtotal = lines.reduce((sum, l) => sum + l.finalPrice * l.qty, 0);
	return { lines, subtotal, tier: customerTier };
}

/**
 * Calculate the discount percentage for a tier (for display purposes).
 * @param {string} tier
 * @returns {number} Discount as a percentage (e.g. 10 for 10%)
 */
export function getDiscountPercent(tier) {
	return (TIER_DISCOUNTS[tier] ?? 0) * 100;
}
