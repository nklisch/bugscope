/**
 * Shopping cart for ShopEasy.
 *
 * Manages a collection of line items, computes the original subtotal,
 * and provides helpers for cart manipulation.
 */

import { getProduct } from './catalog.js';
import { roundMoney } from './utils.js';

/**
 * Create a new empty cart.
 *
 * @param {string} [customerId]
 * @returns {Object} Cart object
 */
export function createCart(customerId = null) {
	return {
		customerId,
		items: [],
		subtotal: 0,
		currentTotal: 0,
		appliedBundles: [],
		appliedCoupons: [],
		createdAt: Date.now(),
	};
}

/**
 * Add a product to the cart or increase its quantity if already present.
 *
 * @param {Object} cart
 * @param {string} sku
 * @param {number} quantity
 * @returns {Object} Updated cart
 */
export function addItem(cart, sku, quantity) {
	const product = getProduct(sku);
	if (!product) throw new Error(`Product ${sku} not found`);

	const existing = cart.items.find((i) => i.sku === sku);
	if (existing) {
		existing.quantity += quantity;
	} else {
		cart.items.push({
			sku,
			name: product.name,
			unitPrice: product.price,
			quantity,
			weightLb: product.weightLb,
		});
	}

	return recalcSubtotal(cart);
}

/**
 * Remove an item from the cart entirely.
 *
 * @param {Object} cart
 * @param {string} sku
 * @returns {Object}
 */
export function removeItem(cart, sku) {
	cart.items = cart.items.filter((i) => i.sku !== sku);
	return recalcSubtotal(cart);
}

/**
 * Update the quantity of an item. Removes the item if quantity <= 0.
 *
 * @param {Object} cart
 * @param {string} sku
 * @param {number} quantity
 * @returns {Object}
 */
export function updateQuantity(cart, sku, quantity) {
	if (quantity <= 0) return removeItem(cart, sku);
	const item = cart.items.find((i) => i.sku === sku);
	if (!item) throw new Error(`Item ${sku} not in cart`);
	item.quantity = quantity;
	return recalcSubtotal(cart);
}

/**
 * Recalculate the cart subtotal from current line items.
 * Subtotal is the sum before any discounts are applied.
 *
 * @param {Object} cart
 * @returns {Object}
 */
export function recalcSubtotal(cart) {
	cart.subtotal = roundMoney(cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
	cart.currentTotal = cart.subtotal;
	return cart;
}

/**
 * Sort cart items by unit price, descending (highest-value first).
 * Uses a proper numeric comparator to avoid lexicographic ordering.
 *
 * @param {Object} cart
 * @returns {Object}
 */
export function sortCartItems(cart) {
	cart.items = [...cart.items].sort((a, b) => b.unitPrice - a.unitPrice);
	return cart;
}

/**
 * Get the total weight of all items in the cart.
 *
 * @param {Object} cart
 * @returns {number} Total weight in lbs
 */
export function getCartWeight(cart) {
	return roundMoney(cart.items.reduce((sum, item) => sum + item.weightLb * item.quantity, 0));
}

/**
 * Get a line item by SKU.
 *
 * @param {Object} cart
 * @param {string} sku
 * @returns {Object | undefined}
 */
export function getLineItem(cart, sku) {
	return cart.items.find((i) => i.sku === sku);
}

/**
 * Check whether the cart is empty.
 *
 * @param {Object} cart
 * @returns {boolean}
 */
export function isEmpty(cart) {
	return cart.items.length === 0;
}
