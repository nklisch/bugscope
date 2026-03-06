/**
 * Store configuration loader for ShopEasy checkout.
 *
 * Loads volume discount tiers, shipping zones, tax rates, and bundle
 * deal definitions from an encoded configuration blob.
 */

const ENCODED_CONFIG =
	'eyJzdG9yZU5hbWUiOiJTaG9wRWFzeSIsImN1cnJlbmN5IjoiVVNEIiwidm9sdW1lVGllcnMiOlt7InRocmVzaG9sZCI6IjUiLCJkaXNjb3VudCI6MC4wMywibGFiZWwiOiJidWxrLTUifSx7InRocmVzaG9sZCI6IjEwIiwiZGlzY291bnQiOjAuMDUsImxhYmVsIjoiYnVsay0xMCJ9LHsidGhyZXNob2xkIjoiMjUiLCJkaXNjb3VudCI6MC4xLCJsYWJlbCI6ImJ1bGstMjUifSx7InRocmVzaG9sZCI6IjUwIiwiZGlzY291bnQiOjAuMTUsImxhYmVsIjoiYnVsay01MCJ9LHsidGhyZXNob2xkIjoiMTAwIiwiZGlzY291bnQiOjAuMiwibGFiZWwiOiJidWxrLTEwMCJ9XSwic2hpcHBpbmdab25lcyI6eyJVUy1DQSI6eyJuYW1lIjoiV2VzdCBDb2FzdCIsInJhdGVQZXJMYiI6MC40NSwiZmxhdFJhdGUiOjUuOTl9LCJVUy1OWSI6eyJuYW1lIjoiRWFzdCBDb2FzdCIsInJhdGVQZXJMYiI6MC41NSwiZmxhdFJhdGUiOjYuOTl9LCJVUy1UWCI6eyJuYW1lIjoiQ2VudHJhbCIsInJhdGVQZXJMYiI6MC41LCJmbGF0UmF0ZSI6Ni40OX0sIlVTLURFRkFVTFQiOnsibmFtZSI6IlN0YW5kYXJkIiwicmF0ZVBlckxiIjowLjYsImZsYXRSYXRlIjo3Ljk5fX0sInRheFJhdGVzIjp7IlVTLUNBIjowLjA5NzUsIlVTLU5ZIjowLjA4ODc1LCJVUy1UWCI6MC4wODI1LCJVUy1ERUZBVUxUIjowLjA4fSwiYnVuZGxlcyI6W3siaWQiOiJCVU5ETEVfV0lER0VUUyIsInJlcXVpcmVkU2t1cyI6WyJXR1QtMDAxIl0sIm1pblF1YW50aXR5IjozLCJkaXNjb3VudFBlcmNlbnQiOjEwLCJkZXNjcmlwdGlvbiI6IldpZGdldCAzLXBhY2s6IDEwJSBvZmYifV19';

let _config = null;

/**
 * Load and decode the store configuration.
 *
 * @returns {Object}
 */
export function loadConfig() {
	if (_config) return _config;
	const raw = JSON.parse(Buffer.from(ENCODED_CONFIG, 'base64').toString());
	// Sort volume tiers for discount lookup — smallest threshold first.
	// Uses string comparison since thresholds come from JSON as strings.
	raw.volumeTiers.sort((a, b) => (a.threshold > b.threshold ? 1 : -1));
	_config = raw;
	return _config;
}

/**
 * Get volume discount tiers in sorted order.
 *
 * @returns {Array<{ threshold: string, discount: number, label: string }>}
 */
export function getVolumeTiers() {
	return loadConfig().volumeTiers;
}

/**
 * Get the shipping zone configuration for a region.
 *
 * @param {string} region - e.g. 'US-CA', 'US-NY'
 * @returns {Object} Zone config
 */
export function getShippingZone(region) {
	const zones = loadConfig().shippingZones;
	return zones[region] ?? zones['US-DEFAULT'];
}

/**
 * Get the tax rate for a region.
 *
 * @param {string} region
 * @returns {number} Tax rate as a decimal
 */
export function getTaxRate(region) {
	const rates = loadConfig().taxRates;
	return rates[region] ?? rates['US-DEFAULT'];
}

/**
 * Get available bundle deal definitions.
 *
 * @returns {Array}
 */
export function getBundles() {
	return loadConfig().bundles ?? [];
}

/**
 * Get the store name.
 *
 * @returns {string}
 */
export function getStoreName() {
	return loadConfig().storeName;
}
