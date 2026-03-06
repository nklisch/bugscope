/**
 * Receipt generation for ShopEasy.
 *
 * Formats order details as human-readable receipts and
 * provides structured receipt data for email/PDF generation.
 */

import { formatPrice, roundMoney } from './utils.js';

/**
 * Generate a plain-text receipt for an order.
 *
 * @param {Object} order - Confirmed order object
 * @returns {string}
 */
export function generateReceipt(order) {
	const lines = [
		`===== ShopEasy Order Receipt =====`,
		`Order ID:   ${order.orderId}`,
		`Date:       ${new Date(order.createdAt).toLocaleDateString()}`,
		``,
		`Items:`,
	];

	for (const item of order.lineItems) {
		lines.push(`  ${item.name} (${item.sku})`);
		lines.push(`    ${item.quantity} × ${formatPrice(item.unitPrice)} = ${formatPrice(item.lineTotal)}`);
	}

	lines.push(
		``,
		`Subtotal:   ${formatPrice(order.productTotal)}`,
		`Shipping:   ${formatPrice(order.shippingCost)}`,
		`Tax:        ${formatPrice(order.taxAmount)}`,
		`─────────────────────────────────`,
		`TOTAL:      ${formatPrice(order.orderTotal)}`,
		``,
	);

	if (order.appliedBundles?.length) {
		lines.push('Promotions applied:');
		for (const b of order.appliedBundles) {
			lines.push(`  Bundle: ${b.description} (-${formatPrice(b.discount)})`);
		}
	}
	if (order.appliedCoupons?.length) {
		for (const c of order.appliedCoupons) {
			lines.push(`  Coupon ${c.code}: -${formatPrice(c.discount)}`);
		}
	}

	lines.push(`=================================`);
	return lines.join('\n');
}

/**
 * Build a structured receipt object for programmatic use.
 *
 * @param {Object} order
 * @returns {Object}
 */
export function buildReceiptData(order) {
	return {
		orderId: order.orderId,
		date: order.createdAt,
		lineItems: order.lineItems.map((item) => ({
			sku: item.sku,
			name: item.name,
			quantity: item.quantity,
			unitPrice: item.unitPrice,
			lineTotal: item.lineTotal,
		})),
		subtotal: order.productTotal,
		shipping: order.shippingCost,
		tax: order.taxAmount,
		total: order.orderTotal,
		promotions: [
			...(order.appliedBundles ?? []).map((b) => ({ type: 'bundle', description: b.description, savings: b.discount })),
			...(order.appliedCoupons ?? []).map((c) => ({ type: 'coupon', code: c.code, savings: c.discount })),
		],
	};
}

/**
 * Compute the sum of all line item totals from a receipt.
 * Should match the order's productTotal field.
 *
 * @param {Object} receiptData
 * @returns {number}
 */
export function sumLineItems(receiptData) {
	return roundMoney(receiptData.lineItems.reduce((sum, item) => sum + item.lineTotal, 0));
}
