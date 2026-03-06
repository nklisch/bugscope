/**
 * Promotional pricing engine.
 * Applies promotional discounts to a product catalog and reports savings.
 */

export interface CatalogItem {
	name: string;
	price: number;
	category: string;
	stock: number;
	savings?: number;
}

export interface PromotionResult {
	updated: number;
	avgOriginalPrice: number;
	totalSavings: number;
	promotedSkus: string[];
}

/**
 * Apply promotional prices to the catalog and return a summary of changes.
 *
 * BUG: the function mutates `catalog[sku].price` with the promotional price
 * before computing the average original price. The final average is computed
 * from the already-mutated catalog, so promoted items' prices appear at
 * their discounted value instead of their original value.
 *
 * The TypeScript types look correct throughout — `CatalogItem.price` is
 * always a `number` — but the values are semantically wrong after mutation.
 */
export function applyPromotions(
	catalog: Record<string, CatalogItem>,
	promotions: Record<string, number>,
): PromotionResult {
	let updated = 0;
	let totalSavings = 0;
	const promotedSkus: string[] = [];

	for (const [sku, promoPrice] of Object.entries(promotions)) {
		if (catalog[sku]) {
			const oldPrice = catalog[sku].price;
			// BUG: mutating price before we compute average below
			catalog[sku].price = promoPrice;
			catalog[sku].savings = Math.round((oldPrice - promoPrice) * 100) / 100;
			totalSavings += oldPrice - promoPrice;
			promotedSkus.push(sku);
			updated++;
		}
	}

	// BUG: reads catalog prices after mutation — promoted items show discounted price
	const prices = Object.values(catalog).map((item: CatalogItem) => item.price);
	const avgOriginal = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;

	return {
		updated,
		avgOriginalPrice: Math.round(avgOriginal * 100) / 100,
		totalSavings: Math.round(totalSavings * 100) / 100,
		promotedSkus,
	};
}

/**
 * Preview which items would be affected by a set of promotions.
 * Does NOT mutate the catalog.
 */
export function previewPromotions(
	catalog: Record<string, CatalogItem>,
	promotions: Record<string, number>,
): Array<{ sku: string; originalPrice: number; promoPrice: number; savings: number }> {
	return Object.entries(promotions)
		.filter(([sku]) => catalog[sku] !== undefined)
		.map(([sku, promoPrice]) => ({
			sku,
			originalPrice: catalog[sku].price,
			promoPrice,
			savings: Math.round((catalog[sku].price - promoPrice) * 100) / 100,
		}));
}
