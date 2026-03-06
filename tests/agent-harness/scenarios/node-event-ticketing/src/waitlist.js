/**
 * Waitlist management for the ShowTime ticketing platform.
 *
 * When seats sell out, customers can join a waitlist. If a seat becomes
 * available (due to order cancellation or lock expiry), the highest-priority
 * waitlist member is offered the seat first.
 *
 * Priority is determined by join timestamp and tier membership.
 * VIP members are bumped ahead of standard members.
 */

// Waitlist: eventId → array of waitlist entries sorted by priority
const _waitlists = new Map();

/**
 * Add a customer to the waitlist for an event.
 *
 * @param {string} eventId
 * @param {string} customerId
 * @param {Object} options
 * @param {string} [options.tier] - 'vip' | 'standard' (default)
 * @param {string} [options.preferredSection] - Preferred section if available
 * @returns {Object} Waitlist entry
 */
export function joinWaitlist(eventId, customerId, options = {}) {
	if (!_waitlists.has(eventId)) _waitlists.set(eventId, []);
	const list = _waitlists.get(eventId);

	// Check for existing entry
	const existing = list.find((e) => e.customerId === customerId);
	if (existing) return { ...existing, alreadyEnrolled: true };

	const entry = {
		id: `WL-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
		eventId,
		customerId,
		joinedAt: Date.now(),
		tier: options.tier ?? 'standard',
		preferredSection: options.preferredSection ?? null,
		notified: false,
		position: list.length + 1,
	};

	list.push(entry);
	sortWaitlist(eventId);
	return entry;
}

/**
 * Get the current waitlist position for a customer.
 *
 * @param {string} eventId
 * @param {string} customerId
 * @returns {number|null} 1-based position, or null if not on waitlist
 */
export function getWaitlistPosition(eventId, customerId) {
	const list = _waitlists.get(eventId) ?? [];
	const idx = list.findIndex((e) => e.customerId === customerId);
	return idx === -1 ? null : idx + 1;
}

/**
 * Remove a customer from the waitlist.
 *
 * @param {string} eventId
 * @param {string} customerId
 * @returns {boolean}
 */
export function leaveWaitlist(eventId, customerId) {
	const list = _waitlists.get(eventId);
	if (!list) return false;
	const before = list.length;
	const updated = list.filter((e) => e.customerId !== customerId);
	_waitlists.set(eventId, updated);
	return updated.length < before;
}

/**
 * Get the next customer to notify when a seat opens up.
 *
 * @param {string} eventId
 * @param {string} [preferredSection] - Only match customers who want this section
 * @returns {Object|null}
 */
export function getNextInQueue(eventId, preferredSection = null) {
	const list = _waitlists.get(eventId) ?? [];
	if (preferredSection) {
		const match = list.find((e) => e.preferredSection === preferredSection && !e.notified);
		if (match) return match;
	}
	return list.find((e) => !e.notified) ?? null;
}

/**
 * Mark a waitlist entry as notified.
 *
 * @param {string} eventId
 * @param {string} customerId
 */
export function markNotified(eventId, customerId) {
	const list = _waitlists.get(eventId) ?? [];
	const entry = list.find((e) => e.customerId === customerId);
	if (entry) entry.notified = true;
}

/**
 * Sort a waitlist by priority: VIP members first, then by join timestamp.
 *
 * @param {string} eventId
 */
function sortWaitlist(eventId) {
	const list = _waitlists.get(eventId);
	if (!list) return;
	list.sort((a, b) => {
		if (a.tier === 'vip' && b.tier !== 'vip') return -1;
		if (a.tier !== 'vip' && b.tier === 'vip') return 1;
		return a.joinedAt - b.joinedAt;
	});
	// Re-number positions
	list.forEach((e, i) => {
		e.position = i + 1;
	});
}

/**
 * Clear all waitlists (used in testing).
 */
export function resetWaitlists() {
	_waitlists.clear();
}
