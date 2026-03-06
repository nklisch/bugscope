/**
 * Order finalization for the ShowTime ticketing platform.
 *
 * Assembles confirmed orders from processed carts, applies final
 * totals, and produces order records suitable for storage and receipts.
 */

import { generateOrderId, roundMoney } from './utils.js';
import { formatSeatLabel } from './formatters.js';

/**
 * Create a confirmed order from a processed checkout result.
 *
 * @param {Object} params
 * @param {Object} params.cart - Cart with finalised tickets
 * @param {Object} params.fees - Fee breakdown from calculateOrderFees
 * @param {string} params.eventId
 * @param {Object} params.payment - Payment details (method, transactionRef)
 * @param {Array} params.appliedDiscounts - Discounts applied during checkout
 * @returns {Object} Confirmed order record
 */
export function createOrder({ cart, fees, eventId, payment, appliedDiscounts }) {
	const tickets = cart.tickets.map((t) => ({
		seatId: t.seatId,
		seatLabel: formatSeatLabel(t.seatId),
		section: t.section,
		row: t.row,
		number: t.number,
		category: t.category,
		basePrice: t.originalPrice ?? t.price,
		adjustedPrice: t.adjustedPrice ?? t.price,
		finalPrice: t.finalPrice ?? t.surgeTotal,
		surgeMultiplier: t.surgeMultiplier ?? 1.0,
	}));

	const productSubtotal = roundMoney(tickets.reduce((sum, t) => sum + t.finalPrice, 0));
	const total = roundMoney(productSubtotal + fees.total);

	return {
		id: generateOrderId(),
		eventId,
		status: 'confirmed',
		createdAt: new Date().toISOString(),
		tickets,
		ticketCount: tickets.length,
		productSubtotal,
		fees: {
			serviceTotal: fees.serviceFeeTotal,
			processingTotal: fees.processingFeeTotal,
			total: fees.total,
			breakdown: fees.perTicket,
		},
		discounts: appliedDiscounts ?? [],
		discountsTotal: roundMoney((appliedDiscounts ?? []).reduce((sum, d) => sum + d.amount, 0)),
		total,
		payment: {
			method: payment.method,
			transactionRef: payment.transactionRef ?? null,
			cardLast4: payment.cardLast4 ?? null,
		},
	};
}

/**
 * Validate that an order record has all required fields.
 *
 * @param {Object} order
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateOrder(order) {
	const errors = [];
	if (!order.id) errors.push('order.id missing');
	if (!order.eventId) errors.push('order.eventId missing');
	if (!order.tickets?.length) errors.push('order.tickets is empty');
	if (typeof order.total !== 'number') errors.push('order.total must be a number');
	if (!isFinite(order.total)) errors.push('order.total must be finite');
	if (order.total <= 0) errors.push('order.total must be positive');
	if (!order.payment?.method) errors.push('order.payment.method missing');
	return { valid: errors.length === 0, errors };
}
