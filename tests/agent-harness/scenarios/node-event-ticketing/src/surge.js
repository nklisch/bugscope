/**
 * Surge pricing calculator for the ShowTime ticketing platform.
 *
 * Computes dynamic price multipliers based on venue occupancy, time
 * remaining until the event, and per-event surge caps.
 *
 * Surge multipliers are determined by comparing the current occupancy
 * rate against occupancy breakpoints and selecting the corresponding tier.
 */

// Occupancy breakpoints that trigger each surge tier.
// Must align with pricingConfig.tiers in the same index order.
const OCCUPANCY_BREAKPOINTS = [0, 0.5, 0.65, 0.8];

/**
 * Calculate the surge multiplier for an event given its occupancy rate.
 *
 * @param {Object} pricingConfig - From config.js (may be partially populated after Bug 1)
 * @param {number} occupancyRate - Current fractional occupancy (0.0 – 1.0)
 * @returns {number} Surge multiplier (>= 1.0)
 */
export function getSurgeMultiplier(pricingConfig, occupancyRate) {
	const tiers = pricingConfig.tiers ?? [1.0];
	const cap = pricingConfig.surgeCap ?? 2.0;

	let tierIndex = 0;
	for (let i = 0; i < OCCUPANCY_BREAKPOINTS.length; i++) {
		if (occupancyRate >= OCCUPANCY_BREAKPOINTS[i]) {
			tierIndex = i;
		}
	}

	const multiplier = tiers[tierIndex] ?? 1.0;
	return Math.min(multiplier, cap);
}

/**
 * Describe the current surge level as a human-readable label.
 *
 * Used in notifications and pricing disclosures.
 *
 * @param {number} multiplier
 * @returns {string}
 */
export function getSurgeLabel(multiplier) {
	if (multiplier >= 2.0) return 'High Demand';
	if (multiplier >= 1.5) return 'Elevated Demand';
	if (multiplier >= 1.2) return 'Moderate Demand';
	return 'Standard Pricing';
}

/**
 * Determine whether surge pricing is active for an event.
 *
 * @param {number} occupancyRate
 * @returns {boolean}
 */
export function isSurgeActive(occupancyRate) {
	return occupancyRate >= OCCUPANCY_BREAKPOINTS[1]; // above 50%
}

/**
 * Calculate a time-based surge decay factor.
 *
 * As an event approaches, unsold seats may be discounted.
 * This function is informational — it returns the decay factor
 * but does not apply it (checkout applies the final multiplier).
 *
 * @param {number} daysUntilEvent
 * @returns {number} Decay factor in range [0.85, 1.0]
 */
export function getTimeDecayFactor(daysUntilEvent) {
	if (daysUntilEvent <= 1) return 0.85;
	if (daysUntilEvent <= 3) return 0.90;
	if (daysUntilEvent <= 7) return 0.95;
	return 1.0;
}
