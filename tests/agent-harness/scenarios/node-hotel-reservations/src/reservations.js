/**
 * Reservation orchestrator.
 *
 * Builds complete hotel reservations by coordinating the pricing pipeline:
 *   1. calculatePricing  — seasonal rate + resort fee + subtotal
 *   2. applyGroupDiscount — group tier rate (if multiple rooms)
 *   3. applyLoyalty      — loyalty tier rate (if member)
 *   4. recalculateSubtotal — update subtotal from finalRate
 *   5. finalizeDiscounts — apply promo code to get discountedSubtotal
 *   6. calculateTaxes    — compute tax and total
 */

import { calculatePricing, recalculateSubtotal } from './pricing.js';
import { applyLoyalty, finalizeDiscounts } from './discounts.js';
import { applyGroupDiscount } from './groups.js';
import { calculateTaxes } from './taxes.js';
import { calculateNights, roundCurrency } from './utils.js';

/**
 * Create a new reservation object with base fields.
 *
 * @param {Object} params
 * @param {string} params.roomType
 * @param {string} params.checkIn  - ISO date string
 * @param {string} params.checkOut - ISO date string
 * @param {number} [params.roomCount=1]
 * @param {string} [params.loyaltyTier]
 * @param {string} [params.promoCode]
 * @param {string} [params.guestName]
 * @returns {Object}
 */
export function createReservation(params) {
	const { roomType, checkIn, checkOut, roomCount = 1, loyaltyTier = null, promoCode = null, guestName = 'Guest' } = params;
	return {
		roomType,
		checkIn,
		checkOut,
		roomCount,
		loyaltyTier,
		promoCode,
		guestName,
		createdAt: new Date().toISOString(),
	};
}

/**
 * Build a fully-priced reservation through the complete pipeline.
 *
 * @param {Object} params - Same as createReservation params
 * @returns {Object} Completed reservation with total, tax, discounts
 */
export function buildReservation(params) {
	const reservation = createReservation(params);

	// Stage 1: Base pricing (seasonal rate + resort fee + subtotal)
	calculatePricing(reservation);

	// Stage 2: Group discount (if multiple rooms)
	if (reservation.roomCount > 1) {
		applyGroupDiscount(reservation, reservation.roomCount);
	}

	// Stage 3: Loyalty discount (if member tier provided)
	if (reservation.loyaltyTier) {
		applyLoyalty(reservation, reservation.loyaltyTier);
		// Recalculate subtotal with loyalty-adjusted finalRate
		recalculateSubtotal(reservation);
	}

	// Stage 4: Promo code discount
	finalizeDiscounts(reservation, reservation.promoCode);

	// Stage 5: Tax and final total
	calculateTaxes(reservation);

	return reservation;
}

/**
 * Format a reservation as a human-readable receipt.
 *
 * @param {Object} reservation
 * @returns {string}
 */
export function formatReceipt(reservation) {
	const lines = [
		`=== Hotel Reservation Receipt ===`,
		`Guest: ${reservation.guestName}`,
		`Room type: ${reservation.roomType}`,
		`Check-in: ${reservation.checkIn}   Check-out: ${reservation.checkOut}`,
		`Nights: ${reservation.nights}   Rooms: ${reservation.roomCount || 1}`,
		``,
		`Rate breakdown:`,
		`  Base rate:          $${(reservation.baseRate ?? 0).toFixed(2)}/night`,
		`  Seasonal rate:      $${(reservation.seasonalRate ?? 0).toFixed(2)}/night`,
		`  Nightly total:      $${(reservation.nightlyTotal ?? 0).toFixed(2)}/night`,
	];

	if (reservation.groupDiscount) {
		lines.push(`  Group discount:     ${(reservation.groupDiscount * 100).toFixed(0)}%`);
	}
	if (reservation.loyaltyDiscount) {
		lines.push(`  Loyalty discount:   ${(reservation.loyaltyDiscount * 100).toFixed(0)}% (${reservation.loyaltyTier})`);
	}
	if (reservation.promoDiscount) {
		lines.push(`  Promo (${reservation.promoCode}):        ${(reservation.promoDiscount * 100).toFixed(0)}% off`);
	}

	lines.push(
		``,
		`  Subtotal:           $${(reservation.subtotal ?? 0).toFixed(2)}`,
		`  After promo:        $${(reservation.discountedSubtotal ?? 0).toFixed(2)}`,
		`  Tax (11%):          $${(reservation.tax ?? 0).toFixed(2)}`,
		`  ─────────────────────────────`,
		`  TOTAL:              $${(reservation.total ?? 0).toFixed(2)}`,
		`=================================`,
	);

	return lines.join('\n');
}

/**
 * Compute the estimated total for a reservation without fully building it.
 * Quick estimate — does not apply group or loyalty discounts.
 *
 * @param {string} roomType
 * @param {string} checkIn
 * @param {string} checkOut
 * @returns {number}
 */
export function estimateTotal(roomType, checkIn, checkOut) {
	const nights = calculateNights(checkIn, checkOut);
	const res = createReservation({ roomType, checkIn, checkOut });
	calculatePricing(res);
	finalizeDiscounts(res, null);
	calculateTaxes(res);
	return roundCurrency(res.total);
}
