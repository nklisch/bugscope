/**
 * Order processing module.
 * Validates and aggregates customer orders.
 */

export interface Order {
	id: string;
	customerId: string;
	quantity: number;
	price: number;
	status: "pending" | "confirmed" | "shipped";
}

export interface OrderSummary {
	grandTotal: number;
	orderCount: number;
	averageOrderValue: number;
}

/**
 * Validate and accumulate a batch of orders.
 * Returns the grand total across all orders.
 *
 * BUG: `total` is used as a scratch variable in the first loop (validation)
 * but is never reset to 0 before the second loop (accumulation). The second
 * loop starts accumulating from the last order's individual value instead of 0.
 */
export function processOrders(orders: Order[]): OrderSummary {
	if (orders.length === 0) {
		return { grandTotal: 0, orderCount: 0, averageOrderValue: 0 };
	}

	// First pass: validate all orders
	let total = 0;
	for (const order of orders) {
		total = order.quantity * order.price;
		if (total < 0) {
			throw new Error(`Negative total for order ${order.id}`);
		}
		if (order.quantity <= 0) {
			throw new Error(`Invalid quantity ${order.quantity} for order ${order.id}`);
		}
	}

	// Second pass: accumulate grand total
	// BUG: `total` still holds the last order's individual value, not 0
	for (const order of orders) {
		total += order.quantity * order.price;
	}

	return {
		grandTotal: total,
		orderCount: orders.length,
		averageOrderValue: Math.round((total / orders.length) * 100) / 100,
	};
}

/**
 * Filter orders by status and compute subtotals per status bucket.
 */
export function ordersByStatus(orders: Order[]): Record<string, { count: number; subtotal: number }> {
	const result: Record<string, { count: number; subtotal: number }> = {};
	for (const order of orders) {
		const key = order.status;
		if (!result[key]) {
			result[key] = { count: 0, subtotal: 0 };
		}
		result[key].count++;
		result[key].subtotal += order.quantity * order.price;
	}
	return result;
}
