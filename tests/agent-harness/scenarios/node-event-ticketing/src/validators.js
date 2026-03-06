/**
 * Input validation for the ShowTime ticketing platform.
 *
 * All validation functions return { valid: boolean, errors: string[] }.
 * Validation is applied at system boundaries (API handlers, checkout entry).
 */

/**
 * Validate a seat selection request.
 *
 * @param {Array<{ seatId: string }>} selections
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSeatSelections(selections) {
	const errors = [];
	if (!Array.isArray(selections) || selections.length === 0) {
		errors.push('At least one seat must be selected');
		return { valid: false, errors };
	}
	if (selections.length > 12) {
		errors.push('Cannot purchase more than 12 tickets at once');
	}
	const seen = new Set();
	for (const sel of selections) {
		if (!sel.seatId || typeof sel.seatId !== 'string') {
			errors.push('Each selection must have a valid seatId string');
			continue;
		}
		if (seen.has(sel.seatId)) {
			errors.push(`Duplicate seat: ${sel.seatId}`);
		}
		seen.add(sel.seatId);
		if (!isValidSeatIdFormat(sel.seatId)) {
			errors.push(`Invalid seat ID format: ${sel.seatId}`);
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Validate the seat ID format.
 * Accepts: SECTION-ROW-NUMBER or VIP-ZONE-ROW-NUMBER.
 *
 * @param {string} seatId
 * @returns {boolean}
 */
function isValidSeatIdFormat(seatId) {
	return /^(FLOOR|LOWER)-[A-Z]-\d+$/.test(seatId) || /^VIP-(NORTH|SOUTH)-\d+-\d+$/.test(seatId);
}

/**
 * Validate payment details.
 *
 * @param {Object} payment
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePayment(payment) {
	const errors = [];
	if (!payment || typeof payment !== 'object') {
		errors.push('Payment details required');
		return { valid: false, errors };
	}
	if (!payment.method) errors.push('payment.method required');
	if (payment.method === 'card') {
		if (!payment.cardLast4 || !/^\d{4}$/.test(payment.cardLast4)) {
			errors.push('payment.cardLast4 must be 4 digits');
		}
		if (!payment.cardExpiry || !/^\d{2}\/\d{2}$/.test(payment.cardExpiry)) {
			errors.push('payment.cardExpiry must be MM/YY format');
		}
	}
	return { valid: errors.length === 0, errors };
}

/**
 * Validate event ID format.
 *
 * @param {string} eventId
 * @returns {boolean}
 */
export function isValidEventId(eventId) {
	return typeof eventId === 'string' && /^EVT-\d{3,}$/.test(eventId);
}

/**
 * Validate a coupon code format.
 * Coupons are 6-12 uppercase alphanumeric characters.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isValidCouponFormat(code) {
	return typeof code === 'string' && /^[A-Z0-9]{6,12}$/.test(code);
}

/**
 * Validate a group size.
 * Groups must have between 5 and 50 members.
 *
 * @param {number} groupSize
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateGroupSize(groupSize) {
	const errors = [];
	if (typeof groupSize !== 'number' || !Number.isInteger(groupSize)) {
		errors.push('Group size must be a whole number');
	} else if (groupSize < 5) {
		errors.push('Group bookings require at least 5 tickets');
	} else if (groupSize > 50) {
		errors.push('Group bookings cannot exceed 50 tickets');
	}
	return { valid: errors.length === 0, errors };
}
