/**
 * Inventory management for ShopEasy.
 *
 * Handles stock level checks and async reservations.
 * Reservations decrement available stock and are confirmed at order creation.
 */

// In-memory stock levels (keyed by SKU), matching the product catalog
const stockLevels = new Map([
	['WGT-001', 500], ['WGT-002', 200], ['WGT-003', 150],
	['GAD-001', 1000], ['GAD-002', 75], ['GAD-003', 30],
	['ACC-001', 800], ['ACC-002', 600], ['ACC-003', 250],
	['TOL-001', 400], ['TOL-002', 120],
]);

/**
 * Simulated async warehouse check (network I/O delay).
 *
 * @param {string} sku
 * @returns {Promise<number>} Current stock level
 */
async function checkWarehouse(sku) {
	// Simulate async I/O with a microtask delay
	await Promise.resolve();
	return stockLevels.get(sku) ?? 0;
}

/**
 * Check whether sufficient stock exists for the requested items.
 *
 * @param {Array<{ sku: string, quantity: number }>} items
 * @returns {Promise<{ available: boolean, shortages: Array }>}
 */
export async function checkStock(items) {
	const shortages = [];
	for (const item of items) {
		const available = await checkWarehouse(item.sku);
		if (available < item.quantity) {
			shortages.push({ sku: item.sku, available, requested: item.quantity });
		}
	}
	return { available: shortages.length === 0, shortages };
}

// Total units reserved across all reservations in the current batch
let reservedTotal = 0;

/**
 * Reserve stock for a list of cart items.
 *
 * Concurrent reservations are processed in parallel using Promise.all.
 * Returns the total number of units reserved in this batch.
 *
 * @param {Array<{ sku: string, quantity: number }>} items
 * @returns {Promise<number>} Total units reserved
 */
export async function reserveItems(items) {
	reservedTotal = 0;

	await Promise.all(
		items.map(async (item) => {
			const current = reservedTotal;
			await checkWarehouse(item.sku);
			reservedTotal = current + item.quantity;
		}),
	);

	return reservedTotal;
}

/**
 * Confirm a reservation by permanently decrementing stock.
 *
 * @param {Array<{ sku: string, quantity: number }>} items
 * @returns {Promise<void>}
 */
export async function confirmReservation(items) {
	for (const item of items) {
		const current = stockLevels.get(item.sku) ?? 0;
		stockLevels.set(item.sku, Math.max(0, current - item.quantity));
	}
}

/**
 * Get the current stock level for a SKU.
 *
 * @param {string} sku
 * @returns {number}
 */
export function getStockLevel(sku) {
	return stockLevels.get(sku) ?? 0;
}

/**
 * Reset stock levels to specific values (used in testing).
 *
 * @param {Object} levels - Plain object of sku → quantity
 */
export function resetStock(levels) {
	stockLevels.clear();
	for (const [sku, qty] of Object.entries(levels)) {
		stockLevels.set(sku, qty);
	}
	reservedTotal = 0;
}
