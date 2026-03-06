/**
 * Seat management for the ShowTime ticketing platform.
 *
 * Provides the SeatInventory class for efficient seat lookups and
 * filtering. Includes the seat assignment algorithm for finding
 * optimal contiguous groups.
 */

import { getVenue, getAllSeats } from './venues.js';

/**
 * Manages seat availability for a venue.
 *
 * Uses lazy initialization to defer filtering on first access.
 * The `availableSeats` getter populates the internal cache the first
 * time it is accessed.
 */
export class SeatInventory {
	constructor(allSeats) {
		this._allSeats = allSeats;
		this._filtered = null;
	}

	/**
	 * All available seats (status === 'available').
	 * Computed lazily on first access and cached.
	 *
	 * @returns {Array}
	 */
	get availableSeats() {
		if (this._filtered === null) {
			this._filtered = this._allSeats.filter((s) => s.status === 'available');
		}
		return this._filtered;
	}

	/**
	 * Get seats for a specific section.
	 *
	 * @param {string} section - Section ID, e.g. 'FLOOR', 'VIP'
	 * @returns {Array} Seats in the section
	 */
	getSeats(section) {
		// Use the filtered list if already populated, otherwise fall back to all seats
		const seats = this._filtered || this._allSeats;
		return seats.filter((s) => s.section === section);
	}

	/**
	 * Look up a specific seat by its ID.
	 *
	 * @param {string} seatId
	 * @returns {Object|null}
	 */
	findById(seatId) {
		return this._allSeats.find((s) => s && s.id === seatId) ?? null;
	}

	/**
	 * Find an optimal group of contiguous seats in a section.
	 *
	 * Uses a scoring algorithm that weighs distance from stage and
	 * group contiguity. For groups, contiguous seats in the same row
	 * score highest; seats close to the stage get a proximity bonus.
	 *
	 * @param {string} section
	 * @param {number} count
	 * @returns {Array} Best available seat group
	 */
	findOptimalSeatGroup(section, count) {
		const sectionSeats = this.availableSeats.filter((s) => s.section === section);

		// Group by row
		const byRow = new Map();
		for (const seat of sectionSeats) {
			const rowKey = seat.zone ? `${seat.zone}-${seat.row}` : seat.row;
			if (!byRow.has(rowKey)) byRow.set(rowKey, []);
			byRow.get(rowKey).push(seat);
		}

		let bestGroup = null;
		let bestScore = -Infinity;

		for (const [rowKey, rowSeats] of byRow) {
			const sorted = rowSeats.slice().sort((a, b) => a.number - b.number);
			// Sliding window of `count` seats
			for (let i = 0; i <= sorted.length - count; i++) {
				const group = sorted.slice(i, i + count);
				// Check contiguity
				let contiguous = true;
				for (let j = 1; j < group.length; j++) {
					if (group[j].number !== group[j - 1].number + 1) {
						contiguous = false;
						break;
					}
				}
				if (!contiguous) continue;
				// Score: favour lower row letters (closer to stage) and lower seat numbers
				const rowScore = rowKey.charCodeAt(0) === 86 ? 0 : 100 - rowKey.charCodeAt(0);
				const posScore = 50 - group[0].number;
				const totalScore = rowScore + posScore;
				if (totalScore > bestScore) {
					bestScore = totalScore;
					bestGroup = group;
				}
			}
		}

		return bestGroup ?? sectionSeats.slice(0, count);
	}
}

/**
 * Create a SeatInventory for a venue, using all seats from the venue layout.
 *
 * @param {string} venueId
 * @returns {SeatInventory}
 */
export function getSeatInventory(venueId) {
	const venue = getVenue(venueId);
	const allSeats = getAllSeats(venue);
	return new SeatInventory(allSeats);
}

/**
 * Find a seat by its ID across a flat seat list.
 *
 * @param {string} seatId
 * @param {Array} allSeats
 * @returns {Object|null}
 */
export function findSeatById(seatId, allSeats) {
	return allSeats.find((s) => s && typeof s === 'object' && !Array.isArray(s) && s.id === seatId) ?? null;
}
