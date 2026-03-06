/**
 * Group booking logic for hotel reservations.
 *
 * Handles multi-room bookings with bulk pricing tiers,
 * room assignment, and group-specific discount calculation.
 */

import { getGroupDiscount } from './config.js';
import { assignRooms } from './rooms.js';

/**
 * Apply a group discount to a reservation based on room count.
 *
 * Reads the nightly total from the reservation (already computed by
 * calculatePricing) and applies the group tier discount to derive
 * perRoomRate. Also recalculates the subtotal for all rooms.
 *
 * @param {Object} reservation
 * @param {number} roomCount
 * @returns {Object}
 */
export function applyGroupDiscount(reservation, roomCount) {
	if (roomCount <= 1) return reservation;

	const discount = getGroupDiscount(roomCount);
	if (discount === 0) return reservation;

	// Apply group discount to the per-night rate (inclusive of resort fee)
	reservation.perRoomRate = reservation.nightlyTotal * (1 - discount);
	reservation.groupDiscount = discount;
	reservation.roomCount = roomCount;

	// Recalculate subtotal for all rooms
	reservation.finalRate = reservation.perRoomRate;
	reservation.subtotal = reservation.perRoomRate * reservation.nights * roomCount;

	return reservation;
}

/**
 * Build a group booking object that covers multiple rooms of the same type.
 *
 * @param {Object} params
 * @param {string} params.roomType
 * @param {number} params.roomCount
 * @param {string} params.checkIn
 * @param {string} params.checkOut
 * @returns {{ rooms: Object[], checkIn: string, checkOut: string, roomCount: number }}
 */
export function buildGroupBooking(params) {
	const { roomType, roomCount, checkIn, checkOut } = params;
	const rooms = assignRooms(roomType, roomCount, checkIn, checkOut);
	return {
		rooms,
		checkIn,
		checkOut,
		roomType,
		roomCount: rooms.length,
	};
}

/**
 * Get the group discount tier label for a given room count.
 *
 * @param {number} roomCount
 * @returns {string} e.g. 'standard', 'group-15', 'group-20', 'group-25'
 */
export function getGroupTierLabel(roomCount) {
	const discount = getGroupDiscount(roomCount);
	if (discount === 0) return 'standard';
	return `group-${Math.round(discount * 100)}`;
}

/**
 * Check whether a booking qualifies for group rates.
 *
 * @param {number} roomCount
 * @returns {boolean}
 */
export function isGroupBooking(roomCount) {
	return getGroupDiscount(roomCount) > 0;
}

/**
 * Compute the per-room savings from a group discount.
 *
 * @param {number} rackRate  - Normal nightly rate per room
 * @param {number} roomCount
 * @returns {number} Savings per room per night
 */
export function getGroupSavings(rackRate, roomCount) {
	const discount = getGroupDiscount(roomCount);
	return Math.round(rackRate * discount * 100) / 100;
}
