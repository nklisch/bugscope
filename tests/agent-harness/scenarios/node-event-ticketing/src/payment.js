/**
 * Payment processing simulation for the ShowTime ticketing platform.
 *
 * In production this would delegate to a payment gateway (Stripe, Adyen, etc.).
 * Here we simulate authorisation with basic validation and mock responses.
 */

import { generateTransactionRef } from './utils.js';

// Simulated declined card numbers (for testing)
const DECLINED_CARDS = new Set(['0000', '9999']);

/**
 * Authorise a payment for a given amount.
 *
 * @param {Object} payment - Payment details
 * @param {string} payment.method - 'card' | 'digital'
 * @param {string} [payment.cardLast4] - Last 4 digits (for card payments)
 * @param {string} [payment.cardExpiry] - Expiry date MM/YY (for card payments)
 * @param {number} amount - Amount to charge in USD
 * @returns {{ authorised: boolean, transactionRef: string|null, error: string|null }}
 */
export function authorisePayment(payment, amount) {
	if (!payment?.method) {
		return { authorised: false, transactionRef: null, error: 'Payment method required' };
	}
	if (amount <= 0 || !isFinite(amount)) {
		return { authorised: false, transactionRef: null, error: `Invalid payment amount: ${amount}` };
	}
	if (payment.method === 'card') {
		if (DECLINED_CARDS.has(payment.cardLast4)) {
			return { authorised: false, transactionRef: null, error: 'Card declined' };
		}
	}
	return { authorised: true, transactionRef: generateTransactionRef(), error: null };
}

/**
 * Calculate a refund amount for an order.
 *
 * Refund policy:
 *   - 7+ days before event: 100% refund
 *   - 3-6 days before event: 75% refund
 *   - 1-2 days before event: 50% refund
 *   - Same day: no refund
 *
 * @param {number} orderTotal - Original amount paid
 * @param {number} daysUntilEvent - Days remaining until event
 * @returns {{ refundAmount: number, refundPercent: number, eligible: boolean }}
 */
export function calculateRefund(orderTotal, daysUntilEvent) {
	let refundPercent;
	if (daysUntilEvent >= 7) {
		refundPercent = 100;
	} else if (daysUntilEvent >= 3) {
		refundPercent = 75;
	} else if (daysUntilEvent >= 1) {
		refundPercent = 50;
	} else {
		refundPercent = 0;
	}

	const refundAmount = Math.round((orderTotal * refundPercent) / 100 * 100) / 100;
	return {
		refundAmount,
		refundPercent,
		eligible: refundPercent > 0,
	};
}

/**
 * Process a refund (simulation only).
 *
 * @param {string} transactionRef - Original transaction reference
 * @param {number} amount - Refund amount
 * @returns {{ success: boolean, refundRef: string|null, error: string|null }}
 */
export function processRefund(transactionRef, amount) {
	if (!transactionRef) {
		return { success: false, refundRef: null, error: 'Transaction reference required' };
	}
	if (amount <= 0) {
		return { success: false, refundRef: null, error: 'Refund amount must be positive' };
	}
	return { success: true, refundRef: `REF-${generateTransactionRef()}`, error: null };
}
