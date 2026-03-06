/**
 * Room catalog and availability management.
 *
 * Provides functions to query available rooms by type, check capacity,
 * and sort room lists for presentation or assignment.
 */

import { getRoomConfig } from './config.js';

// Room inventory — 15 rooms across three types
const ROOM_INVENTORY = [
	{ id: 'S101', type: 'standard', floor: 1, view: 'courtyard', beds: 'queen' },
	{ id: 'S102', type: 'standard', floor: 1, view: 'courtyard', beds: 'queen' },
	{ id: 'S201', type: 'standard', floor: 2, view: 'pool', beds: 'king' },
	{ id: 'S202', type: 'standard', floor: 2, view: 'pool', beds: 'king' },
	{ id: 'S301', type: 'standard', floor: 3, view: 'street', beds: 'twin' },
	{ id: 'D101', type: 'deluxe', floor: 1, view: 'garden', beds: 'king' },
	{ id: 'D201', type: 'deluxe', floor: 2, view: 'pool', beds: 'king' },
	{ id: 'D202', type: 'deluxe', floor: 2, view: 'pool', beds: 'king' },
	{ id: 'D301', type: 'deluxe', floor: 3, view: 'ocean', beds: 'king' },
	{ id: 'D302', type: 'deluxe', floor: 3, view: 'ocean', beds: 'king' },
	{ id: 'D401', type: 'deluxe', floor: 4, view: 'ocean', beds: 'king' },
	{ id: 'E501', type: 'suite', floor: 5, view: 'ocean', beds: 'king' },
	{ id: 'E502', type: 'suite', floor: 5, view: 'ocean', beds: 'king' },
	{ id: 'E601', type: 'suite', floor: 6, view: 'panoramic', beds: 'king' },
	{ id: 'E602', type: 'suite', floor: 6, view: 'panoramic', beds: 'king' },
];

// Simulated bookings for availability checking
const EXISTING_BOOKINGS = [
	{ roomId: 'S101', checkIn: '2024-09-01', checkOut: '2024-09-05' },
	{ roomId: 'D101', checkIn: '2024-07-15', checkOut: '2024-07-22' },
	{ roomId: 'E501', checkIn: '2024-12-20', checkOut: '2024-12-28' },
];

/**
 * Check whether a room is available for the given date range.
 *
 * @param {string} roomId
 * @param {string} checkIn  - ISO date string
 * @param {string} checkOut - ISO date string
 * @returns {boolean}
 */
function isRoomAvailable(roomId, checkIn, checkOut) {
	const ci = new Date(checkIn);
	const co = new Date(checkOut);
	for (const booking of EXISTING_BOOKINGS) {
		if (booking.roomId !== roomId) continue;
		const bIn = new Date(booking.checkIn);
		const bOut = new Date(booking.checkOut);
		// Overlapping if: ci < bOut AND co > bIn
		if (ci < bOut && co > bIn) return false;
	}
	return true;
}

/**
 * Get all rooms of a given type.
 *
 * @param {string} type - Room type key
 * @returns {Object[]} Matching room objects
 */
export function getRoomsByType(type) {
	return ROOM_INVENTORY.filter((r) => r.type === type);
}

/**
 * Get available rooms of a given type for the requested date range.
 *
 * @param {string} type
 * @param {string} checkIn  - ISO date string
 * @param {string} checkOut - ISO date string
 * @returns {Object[]} Available room objects
 */
export function getAvailableRooms(type, checkIn, checkOut) {
	return getRoomsByType(type).filter((r) => isRoomAvailable(r.id, checkIn, checkOut));
}

/**
 * Get the count of available rooms for a type on given dates.
 *
 * @param {string} type
 * @param {string} checkIn
 * @param {string} checkOut
 * @returns {number}
 */
export function getAvailableCount(type, checkIn, checkOut) {
	return getAvailableRooms(type, checkIn, checkOut).length;
}

/**
 * Sort rooms by their configured daily rate, ascending by default.
 * Uses a proper numeric comparator — not lexicographic.
 *
 * @param {Object[]} rooms   - Array of room objects
 * @param {boolean} ascending - Sort order (default: true)
 * @returns {Object[]} Sorted copy
 */
export function sortByPrice(rooms, ascending = true) {
	return [...rooms].sort((a, b) => {
		const rateA = getRoomConfig(a.type).baseRate;
		const rateB = getRoomConfig(b.type).baseRate;
		return ascending ? rateA - rateB : rateB - rateA;
	});
}

/**
 * Get a room by its ID.
 *
 * @param {string} roomId
 * @returns {Object | undefined}
 */
export function getRoomById(roomId) {
	return ROOM_INVENTORY.find((r) => r.id === roomId);
}

/**
 * Get the amenities list for a room type.
 *
 * @param {string} type
 * @returns {string[]}
 */
export function getRoomAmenities(type) {
	return getRoomConfig(type).amenities ?? [];
}

/**
 * Check whether a room type can accommodate the requested guest count.
 *
 * @param {string} type
 * @param {number} guestCount
 * @returns {boolean}
 */
export function canAccommodate(type, guestCount) {
	return getRoomConfig(type).maxOccupancy >= guestCount;
}

/**
 * Assign specific rooms from the available pool for a group booking.
 * Selects the first N available rooms of the requested type.
 *
 * @param {string} type
 * @param {number} count
 * @param {string} checkIn
 * @param {string} checkOut
 * @returns {Object[]} Assigned room objects
 * @throws {Error} if fewer than count rooms are available
 */
export function assignRooms(type, count, checkIn, checkOut) {
	const available = getAvailableRooms(type, checkIn, checkOut);
	if (available.length < count) {
		throw new Error(`Only ${available.length} ${type} rooms available for requested dates (need ${count})`);
	}
	return available.slice(0, count);
}
