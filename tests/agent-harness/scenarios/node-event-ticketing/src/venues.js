/**
 * Venue management for the ShowTime ticketing platform.
 *
 * Defines venue layouts including sections, rows, and seat assignments.
 * Regular sections use a two-level structure (rows → seats).
 * VIP sections use a three-level structure (zones → rows → seats).
 */

// ─── Venue catalog ────────────────────────────────────────────────────────────

const VENUE_CATALOG = {
	'ARENA-001': {
		id: 'ARENA-001',
		name: 'Riverside Arena',
		city: 'Portland',
		state: 'OR',
		capacity: 71,
		sections: [
			// ── Regular floor section: rows → seats (2 levels) ──
			{
				id: 'FLOOR',
				name: 'Floor',
				category: 'floor',
				rows: [
					{
						rowId: 'A',
						seats: [
							{ id: 'FLOOR-A-1', section: 'FLOOR', row: 'A', number: 1, category: 'floor', status: 'sold' },
							{ id: 'FLOOR-A-2', section: 'FLOOR', row: 'A', number: 2, category: 'floor', status: 'available' },
							{ id: 'FLOOR-A-3', section: 'FLOOR', row: 'A', number: 3, category: 'floor', status: 'available' },
							{ id: 'FLOOR-A-4', section: 'FLOOR', row: 'A', number: 4, category: 'floor', status: 'held' },
							{ id: 'FLOOR-A-5', section: 'FLOOR', row: 'A', number: 5, category: 'floor', status: 'available' },
						],
					},
					{
						rowId: 'B',
						seats: [
							{ id: 'FLOOR-B-1', section: 'FLOOR', row: 'B', number: 1, category: 'floor', status: 'available' },
							{ id: 'FLOOR-B-2', section: 'FLOOR', row: 'B', number: 2, category: 'floor', status: 'available' },
							{ id: 'FLOOR-B-3', section: 'FLOOR', row: 'B', number: 3, category: 'floor', status: 'available' },
							{ id: 'FLOOR-B-4', section: 'FLOOR', row: 'B', number: 4, category: 'floor', status: 'available' },
							{ id: 'FLOOR-B-5', section: 'FLOOR', row: 'B', number: 5, category: 'floor', status: 'available' },
						],
					},
					{
						rowId: 'C',
						seats: [
							{ id: 'FLOOR-C-1', section: 'FLOOR', row: 'C', number: 1, category: 'floor', status: 'available' },
							{ id: 'FLOOR-C-2', section: 'FLOOR', row: 'C', number: 2, category: 'floor', status: 'available' },
							{ id: 'FLOOR-C-3', section: 'FLOOR', row: 'C', number: 3, category: 'floor', status: 'sold' },
							{ id: 'FLOOR-C-4', section: 'FLOOR', row: 'C', number: 4, category: 'floor', status: 'available' },
							{ id: 'FLOOR-C-5', section: 'FLOOR', row: 'C', number: 5, category: 'floor', status: 'available' },
						],
					},
				],
			},
			// ── Lower tier section: rows → seats (2 levels) ──
			{
				id: 'LOWER',
				name: 'Lower Tier',
				category: 'lower',
				rows: [
					{
						rowId: 'D',
						seats: [
							{ id: 'LOWER-D-1', section: 'LOWER', row: 'D', number: 1, category: 'lower', status: 'available' },
							{ id: 'LOWER-D-2', section: 'LOWER', row: 'D', number: 2, category: 'lower', status: 'available' },
							{ id: 'LOWER-D-3', section: 'LOWER', row: 'D', number: 3, category: 'lower', status: 'available' },
							{ id: 'LOWER-D-4', section: 'LOWER', row: 'D', number: 4, category: 'lower', status: 'sold' },
							{ id: 'LOWER-D-5', section: 'LOWER', row: 'D', number: 5, category: 'lower', status: 'sold' },
							{ id: 'LOWER-D-6', section: 'LOWER', row: 'D', number: 6, category: 'lower', status: 'available' },
							{ id: 'LOWER-D-7', section: 'LOWER', row: 'D', number: 7, category: 'lower', status: 'available' },
							{ id: 'LOWER-D-8', section: 'LOWER', row: 'D', number: 8, category: 'lower', status: 'available' },
						],
					},
					{
						rowId: 'E',
						seats: [
							{ id: 'LOWER-E-1', section: 'LOWER', row: 'E', number: 1, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-2', section: 'LOWER', row: 'E', number: 2, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-3', section: 'LOWER', row: 'E', number: 3, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-4', section: 'LOWER', row: 'E', number: 4, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-5', section: 'LOWER', row: 'E', number: 5, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-6', section: 'LOWER', row: 'E', number: 6, category: 'lower', status: 'available' },
							{ id: 'LOWER-E-7', section: 'LOWER', row: 'E', number: 7, category: 'lower', status: 'held' },
							{ id: 'LOWER-E-8', section: 'LOWER', row: 'E', number: 8, category: 'lower', status: 'available' },
						],
					},
					{
						rowId: 'F',
						seats: [
							{ id: 'LOWER-F-1', section: 'LOWER', row: 'F', number: 1, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-2', section: 'LOWER', row: 'F', number: 2, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-3', section: 'LOWER', row: 'F', number: 3, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-4', section: 'LOWER', row: 'F', number: 4, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-5', section: 'LOWER', row: 'F', number: 5, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-6', section: 'LOWER', row: 'F', number: 6, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-7', section: 'LOWER', row: 'F', number: 7, category: 'lower', status: 'available' },
							{ id: 'LOWER-F-8', section: 'LOWER', row: 'F', number: 8, category: 'lower', status: 'available' },
						],
					},
					{
						rowId: 'G',
						seats: [
							{ id: 'LOWER-G-1', section: 'LOWER', row: 'G', number: 1, category: 'lower', status: 'sold' },
							{ id: 'LOWER-G-2', section: 'LOWER', row: 'G', number: 2, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-3', section: 'LOWER', row: 'G', number: 3, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-4', section: 'LOWER', row: 'G', number: 4, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-5', section: 'LOWER', row: 'G', number: 5, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-6', section: 'LOWER', row: 'G', number: 6, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-7', section: 'LOWER', row: 'G', number: 7, category: 'lower', status: 'available' },
							{ id: 'LOWER-G-8', section: 'LOWER', row: 'G', number: 8, category: 'lower', status: 'available' },
						],
					},
					{
						rowId: 'H',
						seats: [
							{ id: 'LOWER-H-1', section: 'LOWER', row: 'H', number: 1, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-2', section: 'LOWER', row: 'H', number: 2, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-3', section: 'LOWER', row: 'H', number: 3, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-4', section: 'LOWER', row: 'H', number: 4, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-5', section: 'LOWER', row: 'H', number: 5, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-6', section: 'LOWER', row: 'H', number: 6, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-7', section: 'LOWER', row: 'H', number: 7, category: 'lower', status: 'available' },
							{ id: 'LOWER-H-8', section: 'LOWER', row: 'H', number: 8, category: 'lower', status: 'available' },
						],
					},
				],
			},
			// ── VIP section: zones → rows → seats (3 levels) ──
			{
				id: 'VIP',
				name: 'VIP',
				category: 'vip',
				zones: [
					{
						zoneId: 'NORTH',
						name: 'North VIP',
						rows: [
							{
								rowId: '1',
								seats: [
									{ id: 'VIP-NORTH-1-1', section: 'VIP', zone: 'NORTH', row: '1', number: 1, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-1-2', section: 'VIP', zone: 'NORTH', row: '1', number: 2, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-1-3', section: 'VIP', zone: 'NORTH', row: '1', number: 3, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-1-4', section: 'VIP', zone: 'NORTH', row: '1', number: 4, category: 'vip', status: 'available' },
								],
							},
							{
								rowId: '2',
								seats: [
									{ id: 'VIP-NORTH-2-1', section: 'VIP', zone: 'NORTH', row: '2', number: 1, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-2-2', section: 'VIP', zone: 'NORTH', row: '2', number: 2, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-2-3', section: 'VIP', zone: 'NORTH', row: '2', number: 3, category: 'vip', status: 'available' },
									{ id: 'VIP-NORTH-2-4', section: 'VIP', zone: 'NORTH', row: '2', number: 4, category: 'vip', status: 'available' },
								],
							},
						],
					},
					{
						zoneId: 'SOUTH',
						name: 'South VIP',
						rows: [
							{
								rowId: '1',
								seats: [
									{ id: 'VIP-SOUTH-1-1', section: 'VIP', zone: 'SOUTH', row: '1', number: 1, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-1-2', section: 'VIP', zone: 'SOUTH', row: '1', number: 2, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-1-3', section: 'VIP', zone: 'SOUTH', row: '1', number: 3, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-1-4', section: 'VIP', zone: 'SOUTH', row: '1', number: 4, category: 'vip', status: 'available' },
								],
							},
							{
								rowId: '2',
								seats: [
									{ id: 'VIP-SOUTH-2-1', section: 'VIP', zone: 'SOUTH', row: '2', number: 1, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-2-2', section: 'VIP', zone: 'SOUTH', row: '2', number: 2, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-2-3', section: 'VIP', zone: 'SOUTH', row: '2', number: 3, category: 'vip', status: 'available' },
									{ id: 'VIP-SOUTH-2-4', section: 'VIP', zone: 'SOUTH', row: '2', number: 4, category: 'vip', status: 'available' },
								],
							},
						],
					},
				],
			},
		],
	},
};

/**
 * Retrieve a venue by ID.
 *
 * @param {string} venueId
 * @returns {Object} Venue record
 * @throws {Error} If venue not found
 */
export function getVenue(venueId) {
	const venue = VENUE_CATALOG[venueId];
	if (!venue) throw new Error(`Venue not found: ${venueId}`);
	return venue;
}

/**
 * Get all seat objects from a venue as a flat array.
 *
 * Handles both regular sections (rows → seats) and VIP sections
 * (zones → rows → seats).
 *
 * @param {Object} venue
 * @returns {Array} Flat array of seat objects
 */
export function getAllSeats(venue) {
	// flat() handles nested venue structure
	return venue.sections
		.map((section) =>
			section.rows
				? section.rows.flatMap((row) => row.seats) // regular: produce 1D per section
				: section.zones.map((zone) => zone.rows.map((row) => row.seats)), // VIP: still 3-level nested
		)
		.flat();
}

/**
 * Get all sections for a venue.
 *
 * @param {string} venueId
 * @returns {Array}
 */
export function getVenueSections(venueId) {
	const venue = getVenue(venueId);
	return venue.sections.map((s) => ({ id: s.id, name: s.name, category: s.category }));
}

/**
 * Get the total seat count for a venue (all statuses).
 *
 * @param {string} venueId
 * @returns {number}
 */
export function getTotalSeatCount(venueId) {
	const venue = getVenue(venueId);
	return venue.capacity;
}
