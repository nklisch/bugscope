/**
 * Payment processing simulation for ShopEasy.
 *
 * Validates payment details and simulates authorization.
 * In production, this would integrate with a payment gateway.
 */

import { roundMoney } from './utils.js';

/**
 * Validate a payment details object.
 *
 * @param {Object} payment
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePayment(payment) {
	const errors = [];
	if (!payment?.method) errors.push('Payment method required');
	if (!['card', 'paypal', 'bank_transfer', 'store_credit'].includes(payment?.method)) {
		errors.push('Unsupported payment method');
	}
	if (payment?.method === 'card') {
		if (!payment.cardLast4 || !/^\d{4}$/.test(payment.cardLast4)) {
			errors.push('Valid card last 4 digits required');
		}
		if (!payment.cardExpiry || !/^\d{2}\/\d{2}$/.test(payment.cardExpiry)) {
			errors.push('Card expiry in MM/YY format required');
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Simulate payment authorisation.
 *
 * @param {Object} payment - Payment details
 * @param {number} amount  - Amount to charge
 * @returns {{ authorised: boolean, transactionId: string | null, error: string | null }}
 */
export function authorisePayment(payment, amount) {
	const { valid, errors } = validatePayment(payment);
	if (!valid) {
		return { authorised: false, transactionId: null, error: errors[0] };
	}
	if (amount <= 0) {
		return { authorised: false, transactionId: null, error: 'Amount must be positive' };
	}
	// Simulate: always succeeds in the test environment
	const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
	return { authorised: true, transactionId, error: null };
}

/**
 * Calculate a refund amount.
 *
 * Refunds include a $2.50 processing fee for card payments under $50,
 * and are capped at the original charge amount.
 *
 * @param {number} originalAmount
 * @param {number} refundAmount
 * @param {string} paymentMethod
 * @returns {number} Net refund to customer
 */
export function calculateRefund(originalAmount, refundAmount, paymentMethod) {
	const capped = Math.min(refundAmount, originalAmount);
	// Processing fee for small card refunds
	const processingFee = paymentMethod === 'card' && originalAmount < 50 ? 2.5 : 0;
	return roundMoney(Math.max(0, capped - processingFee));
}
