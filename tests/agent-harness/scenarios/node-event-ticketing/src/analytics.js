/**
 * Sales analytics for the ShowTime ticketing platform.
 *
 * Aggregates order data into summary statistics for revenue reporting,
 * category breakdowns, and occupancy tracking.
 */

import { roundMoney } from './utils.js';

/**
 * Compute revenue summary statistics from a list of orders.
 *
 * @param {Array} orders - Confirmed order records
 * @returns {Object} Revenue summary
 */
export function computeRevenueSummary(orders) {
	if (!orders || orders.length === 0) {
		return { totalRevenue: 0, orderCount: 0, ticketCount: 0, avgOrderValue: 0, avgTicketPrice: 0 };
	}

	const totalRevenue = roundMoney(orders.reduce((sum, o) => sum + (o.total ?? 0), 0));
	const ticketCount = orders.reduce((sum, o) => sum + (o.ticketCount ?? 0), 0);
	const avgOrderValue = orders.length > 0 ? roundMoney(totalRevenue / orders.length) : 0;
	const avgTicketPrice = ticketCount > 0 ? roundMoney(totalRevenue / ticketCount) : 0;

	return {
		totalRevenue,
		orderCount: orders.length,
		ticketCount,
		avgOrderValue,
		avgTicketPrice,
	};
}

/**
 * Break down revenue by ticket category (floor, lower, vip).
 *
 * @param {Array} orders
 * @returns {Object} Revenue per category
 */
export function revenueByCategory(orders) {
	const breakdown = { floor: 0, lower: 0, vip: 0, other: 0 };

	for (const order of orders) {
		for (const ticket of order.tickets ?? []) {
			const cat = ticket.category ?? 'other';
			if (!(cat in breakdown)) breakdown[cat] = 0;
			breakdown[cat] = roundMoney(breakdown[cat] + (ticket.finalPrice ?? 0));
		}
	}

	return breakdown;
}

/**
 * Compute the average surge multiplier across all orders for an event.
 *
 * @param {Array} orders
 * @returns {number}
 */
export function averageSurgeMultiplier(orders) {
	const multipliers = orders
		.flatMap((o) => o.tickets ?? [])
		.map((t) => t.surgeMultiplier)
		.filter((m) => typeof m === 'number');

	if (multipliers.length === 0) return 1.0;
	return roundMoney(multipliers.reduce((sum, m) => sum + m, 0) / multipliers.length);
}

/**
 * Compute a time-series breakdown of ticket sales by hour.
 *
 * Groups order creation timestamps into hourly buckets and counts
 * tickets sold per hour. Uses a sorted Map to maintain time order.
 *
 * @param {Array} orders
 * @returns {Array<{ hour: string, tickets: number, revenue: number }>}
 */
export function salesByHour(orders) {
	const buckets = new Map();

	for (const order of orders) {
		const created = new Date(order.createdAt);
		const hourKey = `${created.getUTCFullYear()}-${String(created.getUTCMonth() + 1).padStart(2, '0')}-${String(created.getUTCDate()).padStart(2, '0')}T${String(created.getUTCHours()).padStart(2, '0')}:00Z`;

		if (!buckets.has(hourKey)) {
			buckets.set(hourKey, { hour: hourKey, tickets: 0, revenue: 0 });
		}

		const bucket = buckets.get(hourKey);
		bucket.tickets += order.ticketCount ?? 0;
		bucket.revenue = roundMoney(bucket.revenue + (order.total ?? 0));
	}

	// Return sorted by hour
	return Array.from(buckets.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

/**
 * Identify the top N revenue-generating events.
 *
 * @param {Array} orders - Must include eventId field
 * @param {number} [n=5]
 * @returns {Array<{ eventId: string, revenue: number, ticketCount: number }>}
 */
export function topEventsByRevenue(orders, n = 5) {
	const byEvent = new Map();

	for (const order of orders) {
		if (!order.eventId) continue;
		if (!byEvent.has(order.eventId)) {
			byEvent.set(order.eventId, { eventId: order.eventId, revenue: 0, ticketCount: 0 });
		}
		const agg = byEvent.get(order.eventId);
		agg.revenue = roundMoney(agg.revenue + (order.total ?? 0));
		agg.ticketCount += order.ticketCount ?? 0;
	}

	return Array.from(byEvent.values())
		.sort((a, b) => b.revenue - a.revenue)
		.slice(0, n);
}
