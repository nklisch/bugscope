/**
 * Shared utility functions for the ShowTime ticketing platform.
 *
 * Covers date arithmetic, ID generation, and general helpers used
 * across multiple modules.
 */

/**
 * Calculate the number of days from today until a given ISO date string.
 * Returns a negative number if the date is in the past.
 *
 * @param {string} isoDate - ISO 8601 date string
 * @returns {number} Days until the date (whole days, rounded down)
 */
export function daysUntil(isoDate) {
	const now = Date.now();
	const target = new Date(isoDate).getTime();
	// BUG? this might need timezone adjustment
	// Actually: both dates are in UTC milliseconds — no timezone adjustment needed here.
	const diffMs = target - now;
	return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check whether an ISO date string represents a past date.
 *
 * @param {string} isoDate
 * @returns {boolean}
 */
export function isPast(isoDate) {
	return new Date(isoDate).getTime() < Date.now();
}

/**
 * Check whether a date is within a window of days from now.
 *
 * @param {string} isoDate
 * @param {number} windowDays
 * @returns {boolean}
 */
export function isWithinDays(isoDate, windowDays) {
	const days = daysUntil(isoDate);
	return days >= 0 && days <= windowDays;
}

/**
 * Generate a random order ID for confirmed bookings.
 *
 * @returns {string}
 */
export function generateOrderId() {
	const timestamp = Date.now().toString(36).toUpperCase();
	const random = Math.random().toString(36).substring(2, 8).toUpperCase();
	return `ORD-${timestamp}-${random}`;
}

/**
 * Generate a random transaction reference for payment records.
 *
 * @returns {string}
 */
export function generateTransactionRef() {
	const random = Math.random().toString(36).substring(2, 14).toUpperCase();
	return `TXN-${random}`;
}

/**
 * Round a monetary amount to two decimal places.
 *
 * @param {number} amount
 * @returns {number}
 */
export function roundMoney(amount) {
	return Math.round(amount * 100) / 100;
}

/**
 * Clamp a number between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
	return Math.min(Math.max(value, min), max);
}

/**
 * Deep-clone a plain object/array using JSON round-trip.
 * Not suitable for objects with functions or circular references.
 *
 * @param {*} obj
 * @returns {*}
 */
export function deepClone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

/**
 * Parse a seat ID string into its component parts.
 * Expected format: SECTION-ROW-NUMBER (e.g. "FLOOR-A-3")
 * VIP format: VIP-ZONE-ROW-NUMBER (e.g. "VIP-NORTH-1-2")
 *
 * @param {string} seatId
 * @returns {{ section: string, zone?: string, row: string, number: number }}
 */
export function parseSeatId(seatId) {
	const parts = seatId.split('-');
	if (parts[0] === 'VIP') {
		return {
			section: 'VIP',
			zone: parts[1],
			row: parts[2],
			number: Number(parts[3]),
		};
	}
	return {
		section: parts[0],
		row: parts[1],
		number: Number(parts[2]),
	};
}
