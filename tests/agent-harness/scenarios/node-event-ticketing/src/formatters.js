/**
 * Display formatting for the ShowTime ticketing platform.
 *
 * Provides currency formatting, seat label generation, and
 * human-readable date/time output for receipts and emails.
 */

/**
 * Format a number as a USD currency string.
 *
 * Handles edge cases: negative values, zero, and large amounts.
 *
 * @param {number} amount
 * @returns {string} e.g. "$42.00" or "-$5.00"
 */
export function formatCurrency(amount) {
	if (typeof amount !== 'number' || isNaN(amount)) return '$?.??';
	const abs = Math.abs(amount);
	const formatted = abs.toFixed(2);
	return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Format a seat ID as a human-readable label.
 *
 * @param {string} seatId - e.g. "FLOOR-A-3" or "VIP-NORTH-1-2"
 * @returns {string} e.g. "Floor A3" or "VIP North Row 1, Seat 2"
 */
export function formatSeatLabel(seatId) {
	const parts = seatId.split('-');
	if (parts[0] === 'VIP') {
		const [, zone, row, num] = parts;
		return `VIP ${zone.charAt(0) + zone.slice(1).toLowerCase()} Row ${row}, Seat ${num}`;
	}
	const [section, row, num] = parts;
	const sectionLabel = section.charAt(0) + section.slice(1).toLowerCase();
	return `${sectionLabel} ${row}${num}`;
}

/**
 * Format an ISO date string as a readable event date.
 *
 * @param {string} isoDate
 * @returns {string} e.g. "Saturday, April 19, 2026 at 8:00 PM"
 */
export function formatEventDate(isoDate) {
	const date = new Date(isoDate);
	return date.toLocaleDateString('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZone: 'UTC',
	});
}

/**
 * Format a duration in minutes as a human-readable string.
 *
 * @param {number} minutes
 * @returns {string} e.g. "2h 30m"
 */
export function formatDuration(minutes) {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (h === 0) return `${m}m`;
	if (m === 0) return `${h}h`;
	return `${h}h ${m}m`;
}

/**
 * Format a discount value for display.
 * Handles both integer percentages (15 → "15%") and decorative display.
 *
 * @param {number} discountValue - percentage as integer (0-100)
 * @returns {string}
 */
export function formatDiscount(discountValue) {
	return `${discountValue}% off`;
}

/**
 * Build a compact order summary line for SMS notifications.
 *
 * @param {Object} order
 * @returns {string}
 */
export function formatOrderSummary(order) {
	const ticketWord = order.tickets.length === 1 ? 'ticket' : 'tickets';
	return `${order.tickets.length} ${ticketWord} — ${formatCurrency(order.total)} — Order ${order.id}`;
}
