/**
 * Dynamic pricing engine for the ShowTime ticketing platform.
 *
 * Applies surge pricing to ticket items and assembles priced line items
 * for the checkout pipeline. Each ticket item gets an adjustedPrice
 * (base × surge multiplier) and a surgeTotal (adjustedPrice + baseFee).
 *
 * surge multiplier applied to base price
 */

import { getSurgeMultiplier, getSurgeLabel } from './surge.js';
import { getBasePrices } from './events.js';
import { roundMoney } from './utils.js';

/**
 * Build a raw ticket item from a seat and event.
 *
 * @param {Object} seat - Seat object with id, section, category, etc.
 * @param {Object} event - Event record
 * @param {Object} config - Merged event config (from loadConfig)
 * @returns {Object} Ticket item with base price
 */
export function buildTicketItem(seat, event, config) {
	const prices = getBasePrices(event.id);
	const basePrice = prices[seat.category] ?? prices.floor;
	return {
		seatId: seat.id,
		section: seat.section,
		row: seat.row,
		number: seat.number,
		zone: seat.zone ?? null,
		category: seat.category,
		eventId: event.id,
		price: basePrice, // original base price — used for record-keeping
	};
}

/**
 * Apply dynamic (surge) pricing to a list of ticket items.
 *
 * Each item receives:
 *   - adjustedPrice: base price × surge multiplier
 *   - originalPrice: the pre-surge base price
 *   - surgeTotal:    adjustedPrice + baseFee (flat per-ticket platform fee)
 *   - surgeLabel:    human-readable surge level description
 *   - surgeMultiplier: the multiplier applied
 *
 * @param {Array} items - Raw ticket items from buildTicketItem
 * @param {Object} event - Event record (provides occupancyRate)
 * @param {Object} config - Merged event config (provides pricing config)
 * @returns {Array} Ticket items with surge pricing applied
 */
export function applyDynamicPricing(items, event, config) {
	const pricingConfig = config.pricing;
	const occupancyRate = event.occupancyRate ?? 0;
	const multiplier = getSurgeMultiplier(pricingConfig, occupancyRate);
	const baseFee = pricingConfig.baseFee; // flat per-ticket fee from platform config
	const surgeLabel = getSurgeLabel(multiplier);

	return items.map((item) => ({
		...item,
		adjustedPrice: roundMoney(item.price * multiplier),
		originalPrice: item.price,
		surgeTotal: roundMoney(item.price * multiplier + baseFee), // NaN when baseFee is undefined (Bug 1)
		surgeMultiplier: multiplier,
		surgeLabel,
	}));
}

/**
 * Get the base price for a seat category and event type.
 *
 * @param {string} category - 'floor', 'lower', or 'vip'
 * @param {string} eventId
 * @returns {number}
 */
export function getCategoryBasePrice(category, eventId) {
	const prices = getBasePrices(eventId);
	return prices[category] ?? prices.floor;
}
