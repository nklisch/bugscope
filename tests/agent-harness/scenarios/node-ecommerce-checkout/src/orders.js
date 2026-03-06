/**
 * Order creation and management for ShopEasy.
 *
 * Assembles line items from a cart, computes the order total,
 * and produces a confirmed order object.
 */

import { roundMoney, generateOrderId } from './utils.js';

/**
 * Compute the order total from an array of line items.
 *
 * Iterates all line items and sums quantity × unitPrice.
 *
 * @param {Array} lineItems - Array of line item objects
 * @returns {number} Total amount
 */
export function computeOrderTotal(lineItems) {
	let total = 0;
	for (const idx in lineItems) {
		const item = lineItems[idx];
		total += item.quantity * item.unitPrice;
	}
	return roundMoney(total);
}

/**
 * Build a line item array from cart items.
 *
 * Uses the discountedUnitPrice if volume pricing has been applied,
 * otherwise falls back to the base unitPrice.
 *
 * @param {Object} cart
 * @returns {Array}
 */
export function buildLineItems(cart) {
	return cart.items.map((item) => ({
		sku: item.sku,
		name: item.name,
		quantity: item.quantity,
		unitPrice: item.discountedUnitPrice ?? item.unitPrice,
		lineTotal: item.lineTotal ?? roundMoney((item.discountedUnitPrice ?? item.unitPrice) * item.quantity),
	}));
}

/**
 * Create a confirmed order object from a checkout result.
 *
 * @param {Object} params
 * @param {Object} params.cart
 * @param {number} params.shippingCost
 * @param {number} params.taxAmount
 * @param {string} params.region
 * @param {Object} params.payment
 * @param {string} [params.transactionId]
 * @returns {Object} Order object
 */
export function createOrder(params) {
	const { cart, shippingCost, taxAmount, region, payment, transactionId } = params;
	const lineItems = buildLineItems(cart);
	const productTotal = computeOrderTotal(lineItems);
	const orderTotal = roundMoney(productTotal + shippingCost + taxAmount);

	return {
		orderId: generateOrderId(),
		status: 'confirmed',
		createdAt: new Date().toISOString(),
		customerId: cart.customerId,
		region,
		lineItems,
		productTotal,
		shippingCost,
		taxAmount,
		orderTotal,
		appliedBundles: cart.appliedBundles ?? [],
		appliedCoupons: cart.appliedCoupons ?? [],
		payment: {
			method: payment.method,
			transactionId: transactionId ?? null,
		},
	};
}

/**
 * Validate that an order object has all required fields.
 *
 * @param {Object} order
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateOrder(order) {
	const errors = [];
	if (!order.orderId) errors.push('orderId missing');
	if (!order.lineItems?.length) errors.push('lineItems empty');
	if (typeof order.orderTotal !== 'number') errors.push('orderTotal must be number');
	if (order.orderTotal <= 0) errors.push('orderTotal must be positive');
	if (!order.payment?.method) errors.push('payment.method missing');
	return { valid: errors.length === 0, errors };
}
