/**
 * Platform configuration loader for ShowTime ticketing.
 *
 * Loads platform-wide defaults and merges event-specific overrides
 * from encoded configuration blobs. Each event can override any
 * top-level configuration key.
 */

// Platform-wide defaults. Individual event configs can override any key.
const DEFAULTS = {
	pricing: {
		baseFee: 5.0,
		surgeCap: 2.0,
		tiers: [1.0, 1.2, 1.5, 2.0],
		earlyBirdWindow: 30,
	},
	fees: {
		servicePercent: 0.12,
		processingFlat: 2.5,
	},
	venue: {
		maxCapacity: 10000,
		lockTimeoutSeconds: 600,
	},
};

// Base64-encoded JSON configs for each event.
// EVT-001: Summer Rock Festival — overrides pricing.surgeCap only
const EVENT_CONFIGS = {
	'EVT-001':
		'eyJwcmljaW5nIjp7InN1cmdlQ2FwIjozfSwiZXZlbnROYW1lIjoiU3VtbWVyIFJvY2sgRmVzdGl2YWwiLCJldmVudFR5cGUiOiJjb25jZXJ0IiwibWF4VGlja2V0c1Blck9yZGVyIjo4fQ==',
	// EVT-002: Jazz Night — no pricing override, defaults fully preserved
	'EVT-002':
		'eyJldmVudE5hbWUiOiJKYXp6IE5pZ2h0IiwiZXZlbnRUeXBlIjoiamF6eiIsIm1heFRpY2tldHNQZXJPcmRlciI6Nn0=',
};

const _cache = new Map();

/**
 * Load the merged configuration for an event.
 *
 * Event-specific overrides are merged on top of platform defaults.
 *
 * @param {string} eventId
 * @returns {Object} Merged configuration
 */
export function loadConfig(eventId) {
	if (_cache.has(eventId)) return _cache.get(eventId);

	const encoded = EVENT_CONFIGS[eventId];
	if (!encoded) throw new Error(`No configuration found for event ${eventId}`);

	const eventOverrides = JSON.parse(Buffer.from(encoded, 'base64').toString());

	// Merge event overrides on top of defaults.
	// Object.assign performs a shallow merge — event-level keys replace entire default objects.
	const config = Object.assign({}, DEFAULTS, eventOverrides);

	_cache.set(eventId, config);
	return config;
}

/**
 * Get the pricing configuration for an event.
 *
 * @param {string} eventId
 * @returns {Object} Pricing config (baseFee, surgeCap, tiers, earlyBirdWindow)
 */
export function getPricingConfig(eventId) {
	return loadConfig(eventId).pricing;
}

/**
 * Get the fees configuration for an event.
 *
 * @param {string} eventId
 * @returns {Object} Fees config (servicePercent, processingFlat)
 */
export function getFeesConfig(eventId) {
	return loadConfig(eventId).fees;
}

/**
 * Get the venue configuration for an event.
 *
 * @param {string} eventId
 * @returns {Object} Venue config (maxCapacity, lockTimeoutSeconds)
 */
export function getVenueConfig(eventId) {
	return loadConfig(eventId).venue;
}

/**
 * Clear the configuration cache (used in testing).
 */
export function clearConfigCache() {
	_cache.clear();
}
