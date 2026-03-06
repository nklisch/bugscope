/**
 * Customer pricing engine.
 * Applies tier-based discounts to item prices and generates invoices.
 */

const TIER_DISCOUNTS: Record<string, number> = {
	bronze: 0.05,
	silver: 0.07,
	gold: 1.0, // BUG: should be 0.1 (10%), not 1.0 (100%)
	platinum: 0.15,
};

export interface InvoiceLine {
	name: string;
	basePrice: number;
	finalPrice: number;
	qty: number;
}

export interface Invoice {
	lines: InvoiceLine[];
	subtotal: number;
	tier: string;
}

/**
 * Calculate the discounted price for a single item.
 */
export function calculatePrice(basePrice: number, tier: string): number {
	const discount = TIER_DISCOUNTS[tier] ?? 0;
	return basePrice * (1 - discount);
}

/**
 * Generate a full invoice for a customer order.
 */
export function generateInvoice(
	items: Array<{ name: string; price: number; qty: number }>,
	customerTier: string,
): Invoice {
	const lines: InvoiceLine[] = items.map(item => ({
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
 */
export function getDiscountPercent(tier: string): number {
	return (TIER_DISCOUNTS[tier] ?? 0) * 100;
}
