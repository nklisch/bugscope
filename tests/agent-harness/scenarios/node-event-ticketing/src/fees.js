/**
 * Service fee calculation for the ShowTime ticketing platform.
 *
 * Two types of fees apply to each ticket:
 *   1. Service fee: percentage-based, applied to the ticket price
 *   2. Processing fee: flat per-ticket charge
 *
 * See pricing.js — surge multiplier applied to base price.
 * Fee totals are returned alongside a per-item breakdown for receipts.
 */

import { roundMoney } from './utils.js';

/**
 * Calculate the service fee for a single ticket item.
 *
 * The service fee is a percentage of the ticket price.
 *
 * @param {Object} item - Ticket item (has .price and .adjustedPrice)
 * @param {Object} feeConfig - Fees configuration ({ servicePercent, processingFlat })
 * @returns {number} Service fee amount
 */
export function calculateServiceFee(item, feeConfig) {
	const fee = item.price * feeConfig.servicePercent; // reads original price, not surge-adjusted
	return roundMoney(fee);
}

/**
 * Calculate the flat processing fee for a single ticket.
 *
 * @param {Object} feeConfig
 * @returns {number}
 */
export function calculateProcessingFee(feeConfig) {
	return feeConfig.processingFlat ?? 2.5;
}

/**
 * Calculate the complete fee breakdown for a list of ticket items.
 *
 * @param {Array} items - Priced ticket items
 * @param {Object} feeConfig - Fees configuration
 * @returns {{ perTicket: Array, serviceFeeTotal: number, processingFeeTotal: number, total: number }}
 */
export function calculateOrderFees(items, feeConfig) {
	const perTicket = items.map((item) => {
		const serviceFee = calculateServiceFee(item, feeConfig);
		const processingFee = calculateProcessingFee(feeConfig);
		return {
			seatId: item.seatId,
			serviceFee,
			processingFee,
			total: roundMoney(serviceFee + processingFee),
		};
	});

	const serviceFeeTotal = roundMoney(perTicket.reduce((sum, f) => sum + f.serviceFee, 0));
	const processingFeeTotal = roundMoney(perTicket.reduce((sum, f) => sum + f.processingFee, 0));
	const total = roundMoney(serviceFeeTotal + processingFeeTotal);

	return { perTicket, serviceFeeTotal, processingFeeTotal, total };
}

/**
 * Format a fee summary for display on receipts.
 *
 * @param {{ serviceFeeTotal: number, processingFeeTotal: number, total: number }} fees
 * @returns {string}
 */
export function formatFeeSummary(fees) {
	return [
		`Service fees:    $${fees.serviceFeeTotal.toFixed(2)}`,
		`Processing fees: $${fees.processingFeeTotal.toFixed(2)}`,
		`Fee total:       $${fees.total.toFixed(2)}`,
	].join('\n');
}
