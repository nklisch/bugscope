/**
 * Ticket cart management for the ShowTime ticketing platform.
 *
 * Manages seat selection, ticket state, and cart totals during
 * the checkout flow. Each cart is associated with a session and
 * holds the selected seats with their pricing information.
 */

import { roundMoney } from './utils.js';

/**
 * Create an empty ticket cart.
 *
 * @param {string} sessionId
 * @param {string} eventId
 * @returns {Object} Empty cart
 */
export function createCart(sessionId, eventId) {
	return {
		sessionId,
		eventId,
		tickets: [],
		subtotal: 0,
		feesTotal: 0,
		discountsTotal: 0,
		total: 0,
		appliedDiscounts: [],
		createdAt: new Date().toISOString(),
	};
}

/**
 * Add a priced ticket to the cart.
 *
 * @param {Object} cart
 * @param {Object} ticket - Priced ticket item with finalPrice
 * @returns {Object} Updated cart
 */
export function addTicket(cart, ticket) {
	cart.tickets.push(ticket);
	recalcCartTotals(cart);
	return cart;
}

/**
 * Remove a ticket from the cart by seat ID.
 *
 * @param {Object} cart
 * @param {string} seatId
 * @returns {Object} Updated cart
 */
export function removeTicket(cart, seatId) {
	cart.tickets = cart.tickets.filter((t) => t.seatId !== seatId);
	recalcCartTotals(cart);
	return cart;
}

/**
 * Recalculate cart subtotal and total from current tickets.
 *
 * @param {Object} cart
 */
export function recalcCartTotals(cart) {
	cart.subtotal = roundMoney(cart.tickets.reduce((sum, t) => sum + (t.finalPrice ?? t.surgeTotal ?? 0), 0));
	cart.total = roundMoney(cart.subtotal + cart.feesTotal - cart.discountsTotal);
}

/**
 * Apply fee totals to the cart.
 *
 * @param {Object} cart
 * @param {number} feesTotal
 */
export function applyFeesToCart(cart, feesTotal) {
	cart.feesTotal = roundMoney(feesTotal);
	recalcCartTotals(cart);
}

/**
 * Record a discount applied to the cart.
 *
 * @param {Object} cart
 * @param {string} type - 'early-bird', 'group', 'promo'
 * @param {number} amount - Amount saved
 * @param {string} description
 */
export function recordDiscount(cart, type, amount, description) {
	cart.appliedDiscounts.push({ type, amount: roundMoney(amount), description });
	cart.discountsTotal = roundMoney(cart.appliedDiscounts.reduce((sum, d) => sum + d.amount, 0));
	recalcCartTotals(cart);
}

/**
 * Sort cart tickets by category for display (VIP first, then floor, then lower).
 * Uses a stable sort with a numeric comparator.
 *
 * @param {Object} cart
 * @returns {Array} Sorted tickets
 */
export function getSortedTickets(cart) {
	const order = { vip: 0, floor: 1, lower: 2 };
	return cart.tickets.slice().sort((a, b) => {
		const aOrder = order[a.category] ?? 99;
		const bOrder = order[b.category] ?? 99;
		return aOrder - bOrder;
	});
}

/**
 * Check whether the cart has any VIP tickets.
 *
 * @param {Object} cart
 * @returns {boolean}
 */
export function hasVipTickets(cart) {
	return cart.tickets.some((t) => t.category === 'vip');
}
