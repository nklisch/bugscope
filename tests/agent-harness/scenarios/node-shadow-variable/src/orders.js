/**
 * Order processing utilities.
 * Validates and totals customer order batches.
 */

/**
 * Process a batch of orders: validate each one, then compute the grand total.
 *
 * @param {Array<{id: string, quantity: number, price: number}>} orders
 * @returns {{ grandTotal: number, orderCount: number }}
 * @throws {Error} if any order has a negative line total
 */
export function processOrders(orders) {
	// First pass: validate all orders
	let total = 0;
	for (const order of orders) {
		total = order.quantity * order.price;
		if (total < 0) {
			throw new Error(`Negative total for order ${order.id}`);
		}
	}

	// Second pass: accumulate grand total.
	// BUG: `total` is not reset to 0 here — it still holds the last
	// iteration's value from the validation loop above.
	for (const order of orders) {
		total += order.quantity * order.price;
	}

	return { grandTotal: total, orderCount: orders.length };
}

/**
 * Filter orders above a minimum value.
 * @param {Array<{id: string, quantity: number, price: number}>} orders
 * @param {number} minValue
 * @returns {Array}
 */
export function filterOrders(orders, minValue) {
	return orders.filter(o => o.quantity * o.price >= minValue);
}

/**
 * Summarize orders by grouping totals per order ID.
 * @param {Array<{id: string, quantity: number, price: number}>} orders
 * @returns {Object.<string, number>}
 */
export function summarizeByOrder(orders) {
	const summary = {};
	for (const order of orders) {
		summary[order.id] = (summary[order.id] ?? 0) + order.quantity * order.price;
	}
	return summary;
}
