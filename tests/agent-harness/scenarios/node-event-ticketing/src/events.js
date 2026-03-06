/**
 * Event catalog for the ShowTime ticketing platform.
 *
 * Maintains the list of upcoming events with metadata, venue assignments,
 * pricing tiers, and ticket availability information.
 */

import { daysUntil, isPast } from './utils.js';

// Static event catalog (would be database-backed in production)
const EVENT_CATALOG = {
	'EVT-001': {
		id: 'EVT-001',
		name: 'Summer Rock Festival',
		artist: 'The Voltage Kings',
		venueId: 'ARENA-001',
		date: '2026-04-19T20:00:00Z',
		durationMinutes: 150,
		genre: 'rock',
		status: 'on-sale',
		occupancyRate: 0.72,
		ageRestriction: null,
		description: 'An electrifying rock night featuring chart-topping hits',
	},
	'EVT-002': {
		id: 'EVT-002',
		name: 'Jazz Night',
		artist: 'Blue Note Quartet',
		venueId: 'ARENA-001',
		date: '2026-04-01T19:00:00Z',
		durationMinutes: 120,
		genre: 'jazz',
		status: 'on-sale',
		occupancyRate: 0.3,
		ageRestriction: null,
		description: 'A sophisticated evening of classic and contemporary jazz',
	},
};

/**
 * Retrieve an event by ID.
 *
 * @param {string} eventId
 * @returns {Object} Event record
 * @throws {Error} If event not found
 */
export function getEvent(eventId) {
	const event = EVENT_CATALOG[eventId];
	if (!event) throw new Error(`Event not found: ${eventId}`);
	return { ...event };
}

/**
 * List all events for a given venue.
 *
 * @param {string} venueId
 * @returns {Array}
 */
export function getEventsByVenue(venueId) {
	return Object.values(EVENT_CATALOG).filter((e) => e.venueId === venueId);
}

/**
 * Get all upcoming (not yet past) events.
 *
 * @returns {Array}
 */
export function getUpcomingEvents() {
	return Object.values(EVENT_CATALOG).filter((e) => !isPast(e.date) && e.status !== 'cancelled');
}

/**
 * Calculate how many days until an event.
 *
 * @param {string} eventId
 * @returns {number} Days remaining (negative if past)
 */
export function getDaysUntilEvent(eventId) {
	const event = getEvent(eventId);
	return daysUntil(event.date);
}

/**
 * Check whether an event is currently on sale.
 *
 * @param {string} eventId
 * @returns {boolean}
 */
export function isOnSale(eventId) {
	const event = getEvent(eventId);
	return event.status === 'on-sale' && !isPast(event.date);
}

/**
 * Get the base prices for each seating category for an event.
 * Prices vary by event tier (concert, festival, etc.).
 *
 * @param {string} eventId
 * @returns {{ floor: number, lower: number, vip: number }}
 */
export function getBasePrices(eventId) {
	const event = getEvent(eventId);
	const multipliers = {
		concert: { floor: 120, lower: 75, vip: 250 },
		jazz: { floor: 65, lower: 45, vip: 130 },
		festival: { floor: 95, lower: 65, vip: 200 },
	};
	return multipliers[event.genre] ?? multipliers.concert;
}
