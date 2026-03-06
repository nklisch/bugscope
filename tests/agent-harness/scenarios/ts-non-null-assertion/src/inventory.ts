/**
 * Warehouse inventory management.
 * Tracks stock levels and identifies items needing reorder.
 */

export interface Product {
	sku: string;
	name: string;
	category: string;
	stock: number;
	reorderThreshold: number;
	unitCost: number;
}

export interface WarehouseReport {
	lowStock: string[];
	totalStock: number;
	averageStock: number;
	reorderCost: number;
}

/**
 * Build an inventory map from a flat list of products.
 */
export function buildInventoryMap(products: Product[]): Map<string, Product> {
	const inventory = new Map<string, Product>();
	for (const product of products) {
		inventory.set(product.sku, product);
	}
	return inventory;
}

/**
 * Check a list of SKUs against the inventory and report which ones need reorder.
 *
 * BUG: the non-null assertion `inventory.get(sku)!` tells TypeScript to trust
 * that every SKU in `skusToCheck` exists in the inventory map. But if the
 * caller passes a SKU that isn't in the map (e.g., a discontinued product or
 * a typo), `Map.get()` returns `undefined`, and accessing `.stock` on it
 * throws TypeError: Cannot read properties of undefined.
 */
export function checkReorderNeeds(
	inventory: Map<string, Product>,
	skusToCheck: string[],
): WarehouseReport {
	const lowStock: string[] = [];
	let totalStock = 0;
	let reorderCost = 0;

	for (const sku of skusToCheck) {
		// BUG: non-null assertion — crashes when sku is not in the map
		const product = inventory.get(sku)!;
		totalStock += product.stock;

		if (product.stock <= product.reorderThreshold) {
			const needed = product.reorderThreshold * 2 - product.stock;
			lowStock.push(`${product.name} (${sku}): ${product.stock} remaining, reorder ${needed}`);
			reorderCost += needed * product.unitCost;
		}
	}

	return {
		lowStock,
		totalStock,
		averageStock: skusToCheck.length > 0 ? Math.round(totalStock / skusToCheck.length) : 0,
		reorderCost: Math.round(reorderCost * 100) / 100,
	};
}

/**
 * Return all products whose stock is at or below their reorder threshold.
 */
export function getLowStockProducts(inventory: Map<string, Product>): Product[] {
	return Array.from(inventory.values()).filter(p => p.stock <= p.reorderThreshold);
}
