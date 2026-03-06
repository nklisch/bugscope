/**
 * Dynamic pricing engine for ShopEasy.
 *
 * Applies volume discount tiers to cart line items.
 * Volume tiers are determined by the total quantity of a single SKU.
 */

import { getVolumeTiers } from './config.js';
import { roundMoney } from './utils.js';

/**
 * Determine the applicable volume discount tier for a given quantity.
 *
 * Iterates the tiers (assumed to be in sorted order) and returns
 * the last tier whose threshold is <= quantity.
 *
 * @param {number} quantity
 * @param {Array} tiers - Sorted array of { threshold, discount, label }
 * @returns {{ threshold: string, discount: number, label: string }}
 */
export function getVolumeTier(quantity, tiers) {
	let applicableTier = tiers[0];
	for (const tier of tiers) {
		if (quantity >= Number(tier.threshold)) {
			applicableTier = tier;
		}
	}
	return applicableTier;
}

/**
 * Apply volume discounts to all cart line items.
 *
 * Mutates each item in place, adding:
 *   - item.volumeDiscount: fraction (e.g. 0.10)
 *   - item.discountedUnitPrice: price after volume discount
 *   - item.lineTotal: quantity × discountedUnitPrice
 *
 * @param {Object} cart
 * @returns {Object}
 */
export function applyVolumePricing(cart) {
	const tiers = getVolumeTiers();
	let pricedTotal = 0;

	for (const item of cart.items) {
		const tier = getVolumeTier(item.quantity, tiers);
		item.volumeDiscount = tier.discount;
		item.discountLabel = tier.label;
		item.discountedUnitPrice = roundMoney(item.unitPrice * (1 - tier.discount));
		item.lineTotal = roundMoney(item.discountedUnitPrice * item.quantity);
		pricedTotal += item.lineTotal;
	}

	cart.currentTotal = roundMoney(pricedTotal);
	return cart;
}

/**
 * Compute a pricing summary for a single SKU and quantity.
 *
 * @param {string} sku
 * @param {number} quantity
 * @param {number} unitPrice
 * @returns {{ tier: string, discount: number, discountedPrice: number, lineTotal: number }}
 */
export function priceSummary(sku, quantity, unitPrice) {
	const tiers = getVolumeTiers();
	const tier = getVolumeTier(quantity, tiers);
	const discountedPrice = roundMoney(unitPrice * (1 - tier.discount));
	return {
		sku,
		quantity,
		tier: tier.label,
		discount: tier.discount,
		discountedPrice,
		lineTotal: roundMoney(discountedPrice * quantity),
	};
}

/**
 * Check whether any volume discount applies to the given quantity.
 *
 * @param {number} quantity
 * @returns {boolean}
 */
export function hasVolumeDiscount(quantity) {
	const tiers = getVolumeTiers();
	const tier = getVolumeTier(quantity, tiers);
	return tier.discount > 0;
}
