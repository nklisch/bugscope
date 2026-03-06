/**
 * Shipping rate calculation for ShopEasy.
 *
 * Computes shipping costs based on destination region and total cart weight.
 * Rates come from the store configuration (zone-based flat + per-lb pricing).
 */

import { getShippingZone } from './config.js';
import { roundMoney } from './utils.js';

/**
 * Calculate the shipping cost for a cart.
 *
 * @param {Object} cart    - Cart with items and weights
 * @param {string} region  - Destination region (e.g. 'US-CA')
 * @returns {{ cost: number, zone: string, weightLb: number }}
 */
export function calculateShipping(cart, region) {
	if (cart.freeShipping) {
		return { cost: 0, zone: 'free', weightLb: 0 };
	}

	const zone = getShippingZone(region);
	const totalWeight = cart.items.reduce((sum, item) => sum + item.weightLb * item.quantity, 0);
	const cost = roundMoney(zone.flatRate + totalWeight * zone.ratePerLb);

	return {
		cost,
		zone: zone.name,
		weightLb: roundMoney(totalWeight),
	};
}

/**
 * Get a list of available shipping zones with their rates.
 *
 * @returns {Array<{ region: string, name: string, estimatedCost: number }>}
 */
export function listShippingOptions(weightLb) {
	const regions = ['US-CA', 'US-NY', 'US-TX', 'US-DEFAULT'];
	return regions.map((region) => {
		const zone = getShippingZone(region);
		return {
			region,
			name: zone.name,
			estimatedCost: roundMoney(zone.flatRate + weightLb * zone.ratePerLb),
		};
	});
}

/**
 * Check whether a region qualifies for free shipping based on order value.
 *
 * @param {number} orderValue
 * @param {string} region
 * @returns {boolean}
 */
export function qualifiesForFreeShipping(orderValue, region) {
	// Free shipping threshold: $75 for West Coast, $100 elsewhere
	const westCoastRegions = ['US-CA', 'US-OR', 'US-WA'];
	const threshold = westCoastRegions.includes(region) ? 75 : 100;
	return orderValue >= threshold;
}
