/**
 * Tax calculation for hotel reservations.
 *
 * Computes combined state, city, and occupancy tax on the appropriate
 * subtotal and assembles the final reservation total.
 */

import { getTaxRate } from './config.js';
import { roundCurrency } from './utils.js';

/**
 * Compute the combined tax on a subtotal amount.
 *
 * @param {number} taxableAmount - The amount to tax
 * @returns {number} Tax amount (rounded to 2 decimal places)
 */
export function computeTax(taxableAmount) {
	return roundCurrency(taxableAmount * getTaxRate());
}

/**
 * Apply tax to the reservation and compute the final total.
 *
 * Tax is calculated on the pre-discount subtotal (before promo codes).
 * The final total is: discountedSubtotal + tax.
 *
 * @param {Object} reservation
 * @returns {Object}
 */
export function calculateTaxes(reservation) {
	// Tax base: use the pre-discount subtotal
	// Both reservation.subtotal and reservation.discountedSubtotal are available here.
	const taxBase = reservation.subtotal;
	const tax = computeTax(taxBase);

	reservation.tax = tax;
	reservation.total = roundCurrency(reservation.discountedSubtotal + tax);
	reservation.taxRate = getTaxRate();

	return reservation;
}

/**
 * Get a detailed tax breakdown by component.
 *
 * @param {number} taxableAmount
 * @returns {{ stateTax: number, cityTax: number, occupancyTax: number, total: number }}
 */
export function getTaxBreakdown(taxableAmount) {
	// Fixed component rates matching the config
	const stateTaxRate = 0.06;
	const cityTaxRate = 0.025;
	const occupancyTaxRate = 0.025;

	const stateTax = roundCurrency(taxableAmount * stateTaxRate);
	const cityTax = roundCurrency(taxableAmount * cityTaxRate);
	const occupancyTax = roundCurrency(taxableAmount * occupancyTaxRate);

	return {
		stateTax,
		cityTax,
		occupancyTax,
		total: roundCurrency(stateTax + cityTax + occupancyTax),
	};
}

/**
 * Format a tax breakdown as a human-readable string.
 *
 * @param {Object} reservation
 * @returns {string}
 */
export function formatTaxSummary(reservation) {
	const breakdown = getTaxBreakdown(reservation.subtotal);
	return [
		`  State tax (6%):     $${breakdown.stateTax.toFixed(2)}`,
		`  City tax (2.5%):    $${breakdown.cityTax.toFixed(2)}`,
		`  Occupancy (2.5%):   $${breakdown.occupancyTax.toFixed(2)}`,
		`  Total tax:          $${breakdown.total.toFixed(2)}`,
	].join('\n');
}
