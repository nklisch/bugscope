/**
 * Hotel configuration loader.
 *
 * Loads room types, seasonal multipliers, tax rates, loyalty tiers,
 * group pricing tiers, and promo codes from an encoded configuration blob.
 * The encoded format protects sensitive rate information from casual inspection.
 */

// Encoded hotel configuration — decoded at runtime by loadConfig()
const ENCODED_CONFIG =
	'eyJyb29tVHlwZXMiOnsic3RhbmRhcmQiOnsibmFtZSI6IlN0YW5kYXJkIFJvb20iLCJiYXNlUmF0ZSI6MTUwLCJyZXNvcnRGZWUiOjE1LCJtYXhPY2N1cGFuY3kiOjIsImFtZW5pdGllcyI6WyJ3aWZpIiwidHYiXX0sImRlbHV4ZSI6eyJuYW1lIjoiRGVsdXhlIFJvb20iLCJiYXNlUmF0ZSI6MjUwLCJyZXNvcnRGZWUiOiI0NSIsIm1heE9jY3VwYW5jeSI6MywiYW1lbml0aWVzIjpbIndpZmkiLCJ0diIsIm1pbmliYXIiLCJiYWxjb255Il19LCJzdWl0ZSI6eyJuYW1lIjoiRXhlY3V0aXZlIFN1aXRlIiwiYmFzZVJhdGUiOjQ1MCwicmVzb3J0RmVlIjo2NSwibWF4T2NjdXBhbmN5Ijo0LCJhbWVuaXRpZXMiOlsid2lmaSIsInR2IiwibWluaWJhciIsImtpdGNoZW5ldHRlIiwiamFjdXp6aSJdfX0sInNlYXNvbnMiOnsic3VtbWVyIjp7Im1vbnRocyI6WzYsNyw4XSwibXVsdGlwbGllciI6MS4yNSwibmFtZSI6IlN1bW1lciBQZWFrIn0sImhvbGlkYXkiOnsibW9udGhzIjpbMTEsMTJdLCJtdWx0aXBsaWVyIjoxLjUsIm5hbWUiOiJIb2xpZGF5IFNlYXNvbiJ9LCJzdGFuZGFyZCI6eyJtb250aHMiOlsxLDIsMyw0LDUsOSwxMF0sIm11bHRpcGxpZXIiOjEsIm5hbWUiOiJTdGFuZGFyZCBTZWFzb24ifX0sInRheFJhdGVzIjp7InN0YXRlVGF4IjowLjA2LCJjaXR5VGF4IjowLjAyNSwib2NjdXBhbmN5VGF4IjowLjAyNX0sImxveWFsdHlUaWVycyI6eyJzaWx2ZXIiOnsiZGlzY291bnQiOjAuMDUsIm1pblBvaW50cyI6MTAwfSwiZ29sZCI6eyJkaXNjb3VudCI6MC4xLCJtaW5Qb2ludHMiOjUwMH0sInBsYXRpbnVtIjp7ImRpc2NvdW50IjowLjE1LCJtaW5Qb2ludHMiOjEwMDB9fSwiZ3JvdXBUaWVycyI6W3sibWluUm9vbXMiOjEsImRpc2NvdW50IjowfSx7Im1pblJvb21zIjozLCJkaXNjb3VudCI6MC4xNX0seyJtaW5Sb29tcyI6NSwiZGlzY291bnQiOjAuMn0seyJtaW5Sb29tcyI6MTAsImRpc2NvdW50IjowLjI1fV0sInByb21vQ29kZXMiOnsiU0FWRTEwIjp7ImRpc2NvdW50IjowLjEsIm1pbk5pZ2h0cyI6MiwiZGVzY3JpcHRpb24iOiIxMCUgb2ZmIDIrIG5pZ2h0cyJ9LCJTVU1NRVIxNSI6eyJkaXNjb3VudCI6MC4xNSwibWluTmlnaHRzIjozLCJkZXNjcmlwdGlvbiI6IjE1JSBvZmYgc3VtbWVyIHN0YXlzIn0sIldJTlRFUjIwIjp7ImRpc2NvdW50IjowLjIsIm1pbk5pZ2h0cyI6NSwiZGVzY3JpcHRpb24iOiIyMCUgb2ZmIHdpbnRlciBnZXRhd2F5In19fQ==';

let _cachedConfig = null;

/**
 * Load and parse the hotel configuration.
 * Result is cached after the first call.
 *
 * @returns {Object} Parsed hotel configuration
 */
export function loadConfig() {
	if (_cachedConfig) return _cachedConfig;
	const decoded = Buffer.from(ENCODED_CONFIG, 'base64').toString('utf-8');
	_cachedConfig = JSON.parse(decoded);
	return _cachedConfig;
}

/**
 * Get configuration for a specific room type.
 *
 * @param {string} roomType - e.g. 'standard', 'deluxe', 'suite'
 * @returns {Object} Room type configuration
 */
export function getRoomConfig(roomType) {
	const config = loadConfig();
	const room = config.roomTypes[roomType];
	if (!room) throw new Error(`Unknown room type: ${roomType}`);
	return room;
}

/**
 * Get the seasonal pricing multiplier for a given check-in month.
 * Month is 0-based (from Date.getMonth()).
 *
 * @param {number} month - 0-based month index
 * @returns {number} Seasonal multiplier (e.g. 1.0, 1.25, 1.50)
 */
export function getSeasonalMultiplier(month) {
	const config = loadConfig();
	// Config stores months as 1-based; getMonth() returns 0-based
	const monthNum = month + 1;
	for (const [, season] of Object.entries(config.seasons)) {
		if (season.months.includes(monthNum)) {
			return season.multiplier;
		}
	}
	return 1.0;
}

/**
 * Get the combined tax rate (state + city + occupancy).
 *
 * @returns {number} Combined tax rate as a decimal
 */
export function getTaxRate() {
	const config = loadConfig();
	const { stateTax, cityTax, occupancyTax } = config.taxRates;
	return stateTax + cityTax + occupancyTax;
}

/**
 * Get the loyalty discount fraction for a tier.
 *
 * @param {string} tier - 'silver', 'gold', or 'platinum'
 * @returns {number} Discount as a decimal (e.g. 0.10 for gold)
 */
export function getLoyaltyDiscount(tier) {
	const config = loadConfig();
	return config.loyaltyTiers[tier]?.discount ?? 0;
}

/**
 * Get the group discount fraction for a given room count.
 *
 * @param {number} roomCount
 * @returns {number} Discount as a decimal (e.g. 0.15 for 3+ rooms)
 */
export function getGroupDiscount(roomCount) {
	const config = loadConfig();
	const tiers = [...config.groupTiers].sort((a, b) => a.minRooms - b.minRooms);
	let discount = 0;
	for (const tier of tiers) {
		if (roomCount >= tier.minRooms) {
			discount = tier.discount;
		}
	}
	return discount;
}

/**
 * Look up a promo code and return its details, or null if not valid.
 *
 * @param {string} code - Promo code string
 * @returns {{ discount: number, minNights: number, description: string } | null}
 */
export function lookupPromoCode(code) {
	const config = loadConfig();
	return config.promoCodes[code] ?? null;
}

/**
 * Get all available room type keys.
 *
 * @returns {string[]} Array of room type identifiers
 */
export function getRoomTypes() {
	const config = loadConfig();
	return Object.keys(config.roomTypes);
}
