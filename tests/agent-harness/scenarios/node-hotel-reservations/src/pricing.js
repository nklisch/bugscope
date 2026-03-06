/**
 * Rate calculation engine for hotel reservations.
 *
 * Computes nightly rates with seasonal adjustments and populates
 * the reservation object with pricing data before discounts are applied.
 */

import { getRoomConfig, getSeasonalMultiplier } from './config.js';
import { calculateNights, getMonthIndex } from './utils.js';

// FIXME: check seasonal rate boundaries for edge-of-month dates
// (e.g. a stay that starts in late October and crosses into November)

/**
 * Compute the seasonal base rate for a room type on a given check-in date.
 *
 * @param {string} roomType  - Room type key
 * @param {string} checkIn   - ISO date string
 * @returns {number} Seasonal rate per night (before resort fee)
 */
export function getSeasonalRate(roomType, checkIn) {
	const roomConfig = getRoomConfig(roomType);
	const month = getMonthIndex(checkIn);
	const multiplier = getSeasonalMultiplier(month);
	return roomConfig.baseRate * multiplier;
}

/**
 * Compute the full nightly rate including resort fee.
 *
 * @param {number} seasonalRate - Base rate after seasonal adjustment
 * @param {number|string} resortFee  - Resort fee from room config
 * @returns {number} Nightly total (seasonal rate + resort fee)
 */
export function calculateNightlyTotal(seasonalRate, resortFee) {
	return seasonalRate + resortFee;
}

/**
 * Compute the stay subtotal for a single room.
 *
 * @param {number} nightlyTotal
 * @param {number} nights
 * @returns {number}
 */
export function calculateStaySubtotal(nightlyTotal, nights) {
	return nightlyTotal * nights;
}

/**
 * Populate a reservation object with initial pricing information.
 * Sets baseRate, seasonalRate, nightlyTotal, and subtotal.
 *
 * This function mutates the reservation object in place and returns it.
 * Later pipeline stages (groups, discounts, taxes) will also mutate the object.
 *
 * @param {Object} reservation
 * @returns {Object} The mutated reservation with pricing fields
 */
export function calculatePricing(reservation) {
	const roomConfig = getRoomConfig(reservation.roomType);
	const nights = calculateNights(reservation.checkIn, reservation.checkOut);

	const seasonalRate = getSeasonalRate(reservation.roomType, reservation.checkIn);
	const nightlyTotal = calculateNightlyTotal(seasonalRate, roomConfig.resortFee);
	const subtotal = calculateStaySubtotal(nightlyTotal, nights);

	reservation.nights = nights;
	reservation.baseRate = roomConfig.baseRate;
	reservation.seasonalRate = seasonalRate;
	reservation.nightlyTotal = nightlyTotal;
	reservation.subtotal = subtotal;
	reservation.finalRate = nightlyTotal; // default, overridden by discount pipeline

	return reservation;
}

/**
 * Recalculate the reservation subtotal from the current finalRate.
 * Called after loyalty / group discount stages update finalRate.
 *
 * @param {Object} reservation
 * @returns {Object}
 */
export function recalculateSubtotal(reservation) {
	reservation.subtotal = reservation.finalRate * reservation.nights * (reservation.roomCount || 1);
	return reservation;
}

/**
 * Compute a detailed nightly rate breakdown for display purposes.
 *
 * @param {string} roomType
 * @param {string} checkIn
 * @returns {{ baseRate: number, seasonalMultiplier: number, seasonalRate: number, resortFee: number, nightlyTotal: number }}
 */
export function getRateBreakdown(roomType, checkIn) {
	const roomConfig = getRoomConfig(roomType);
	const month = getMonthIndex(checkIn);
	const multiplier = getSeasonalMultiplier(month);
	const seasonalRate = roomConfig.baseRate * multiplier;
	return {
		baseRate: roomConfig.baseRate,
		seasonalMultiplier: multiplier,
		seasonalRate,
		resortFee: roomConfig.resortFee,
		nightlyTotal: seasonalRate + roomConfig.resortFee,
	};
}
