/**
 * Utility functions for the hotel reservation system.
 *
 * Date helpers, currency formatting, and validation utilities
 * used across the reservation pipeline.
 */

/**
 * Calculate the number of nights between check-in and check-out dates.
 *
 * @param {string} checkIn  - ISO date string
 * @param {string} checkOut - ISO date string
 * @returns {number} Number of nights
 */
export function calculateNights(checkIn, checkOut) {
	const msPerDay = 24 * 60 * 60 * 1000;
	const ci = new Date(checkIn);
	const co = new Date(checkOut);
	return Math.round((co - ci) / msPerDay);
}

/**
 * Format a number as a USD currency string.
 *
 * @param {number} amount
 * @returns {string} e.g. "$1,234.56"
 */
export function formatCurrency(amount) {
	if (typeof amount !== 'number' || isNaN(amount)) return '$NaN';
	const sign = amount < 0 ? '-' : '';
	const abs = Math.abs(amount);
	const dollars = Math.floor(abs);
	const cents = Math.round((abs - dollars) * 100);
	const formatted = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${sign}$${formatted}.${String(cents).padStart(2, '0')}`;
}

/**
 * Round a monetary amount to 2 decimal places.
 *
 * @param {number} amount
 * @returns {number}
 */
export function roundCurrency(amount) {
	return Math.round(amount * 100) / 100;
}

/**
 * Validate that a date string parses to a real date.
 *
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidDate(dateStr) {
	if (!dateStr) return false;
	const d = new Date(dateStr);
	return !isNaN(d.getTime());
}

/**
 * Check whether a check-in/check-out pair is valid.
 *
 * @param {string} checkIn
 * @param {string} checkOut
 * @returns {boolean}
 */
export function isValidDateRange(checkIn, checkOut) {
	if (!isValidDate(checkIn) || !isValidDate(checkOut)) return false;
	return new Date(checkOut) > new Date(checkIn);
}

/**
 * Get the month index (0-based) from an ISO date string.
 *
 * @param {string} dateStr
 * @returns {number} 0-11
 */
export function getMonthIndex(dateStr) {
	return new Date(dateStr).getMonth();
}

/**
 * Calculate the cancellation fee based on how many days before check-in
 * the cancellation occurs.
 *
 * Policy:
 *   - 7+ days before: no charge
 *   - 3–6 days before: 25% of total
 *   - 1–2 days before: 50% of total
 *   - Same day or after: 100% of total
 *
 * @param {number} totalPaid         - Original reservation total
 * @param {number} daysBeforeCheckIn - Days until check-in at cancellation time
 * @param {string} roomType          - Room type (affects refund eligibility)
 * @returns {number} Cancellation fee amount
 */
export function calculateCancellationFee(totalPaid, daysBeforeCheckIn, roomType) {
	// Suites have a stricter cancellation policy
	const strictPolicy = roomType === 'suite';

	if (daysBeforeCheckIn >= (strictPolicy ? 14 : 7)) {
		return 0;
	}
	if (daysBeforeCheckIn >= (strictPolicy ? 7 : 3)) {
		return roundCurrency(totalPaid * 0.25);
	}
	if (daysBeforeCheckIn >= 1) {
		return roundCurrency(totalPaid * 0.5);
	}
	return totalPaid; // full charge for same-day or no-show
}

/**
 * Build a human-readable stay summary line.
 *
 * @param {string} roomType
 * @param {number} nights
 * @param {string} checkIn
 * @param {string} checkOut
 * @returns {string}
 */
export function formatStaySummary(roomType, nights, checkIn, checkOut) {
	return `${nights} night(s) in ${roomType} | ${checkIn} → ${checkOut}`;
}
