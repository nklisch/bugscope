/**
 * Tax calculation module for ShopEasy.
 *
 * Applies regional tax rates to the taxable order amount.
 * Tax is always computed on the post-discount, pre-shipping total.
 */

import { getTaxRate } from './config.js';
import { roundMoney } from './utils.js';

/**
 * Calculate the tax amount for an order.
 *
 * @param {number} taxableAmount - Post-discount product subtotal (no shipping)
 * @param {string} region        - Customer region code
 * @returns {number} Tax amount
 */
export function calculateTax(taxableAmount, region) {
	const rate = getTaxRate(region);
	return roundMoney(taxableAmount * rate);
}

/**
 * Get the effective tax rate for a region.
 *
 * @param {string} region
 * @returns {number} Rate as a decimal
 */
export function getEffectiveTaxRate(region) {
	return getTaxRate(region);
}

/**
 * Compute a full tax breakdown for display in receipts.
 *
 * @param {number} taxableAmount
 * @param {string} region
 * @returns {{ taxableAmount: number, rate: number, taxAmount: number, region: string }}
 */
export function getTaxBreakdown(taxableAmount, region) {
	const rate = getTaxRate(region);
	return {
		taxableAmount,
		rate,
		taxAmount: roundMoney(taxableAmount * rate),
		region,
	};
}
