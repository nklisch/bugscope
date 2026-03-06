/**
 * Notification dispatch for the ShowTime ticketing platform.
 *
 * Handles email and SMS templates for order confirmations, waitlist
 * alerts, and event reminders. In production this delegates to a
 * notification provider (SendGrid, Twilio, etc.).
 */

import { formatCurrency, formatEventDate, formatSeatLabel, formatOrderSummary } from './formatters.js';

/**
 * Build an email order confirmation.
 *
 * @param {Object} order - Confirmed order record
 * @param {Object} event - Event record
 * @returns {{ subject: string, body: string }}
 */
export function buildOrderConfirmationEmail(order, event) {
	const subject = `Your tickets for ${event.name} — Order ${order.id}`;

	const ticketLines = order.tickets.map((t) => `  ${formatSeatLabel(t.seatId)} — ${formatCurrency(t.finalPrice)}`).join('\n');

	const discountLines =
		order.discounts.length > 0 ? '\nDiscounts applied:\n' + order.discounts.map((d) => `  ${d.description}: -${formatCurrency(d.amount)}`).join('\n') : '';

	const body = [
		`Hello,`,
		``,
		`Your booking is confirmed! Here are your order details:`,
		``,
		`Event:    ${event.name}`,
		`Date:     ${formatEventDate(event.date)}`,
		`Venue:    Riverside Arena`,
		``,
		`Tickets:`,
		ticketLines,
		discountLines,
		``,
		`Subtotal:  ${formatCurrency(order.productSubtotal)}`,
		`Fees:      ${formatCurrency(order.fees.total)}`,
		`Total:     ${formatCurrency(order.total)}`,
		``,
		`Order ID:  ${order.id}`,
		`Payment:   ${order.payment.method.toUpperCase()}${order.payment.cardLast4 ? ` ending ${order.payment.cardLast4}` : ''}`,
		``,
		`Questions? Contact support@showtime.example`,
	].join('\n');

	return { subject, body };
}

/**
 * Build an SMS order summary (max 160 characters).
 *
 * @param {Object} order
 * @returns {string}
 */
export function buildOrderSms(order) {
	return formatOrderSummary(order).substring(0, 160);
}

/**
 * Build a waitlist notification email.
 *
 * @param {Object} entry - Waitlist entry
 * @param {Object} event - Event record
 * @param {string} seatId - The seat that became available
 * @returns {{ subject: string, body: string }}
 */
export function buildWaitlistNotificationEmail(entry, event, seatId) {
	const subject = `Seat available for ${event.name} — Act fast!`;
	const body = [
		`Good news! A seat has become available for ${event.name}.`,
		``,
		`Seat: ${formatSeatLabel(seatId)}`,
		`Event: ${formatEventDate(event.date)}`,
		``,
		`This offer expires in 15 minutes. Visit our website to complete your purchase.`,
		``,
		`Waitlist position (when notified): #${entry.position}`,
	].join('\n');
	return { subject, body };
}

/**
 * Build an event reminder email (sent 24h before the event).
 *
 * @param {Object} order
 * @param {Object} event
 * @returns {{ subject: string, body: string }}
 */
export function buildEventReminderEmail(order, event) {
	const subject = `Reminder: ${event.name} is tomorrow!`;
	const body = [
		`Don't forget — ${event.name} is tomorrow!`,
		``,
		`Date: ${formatEventDate(event.date)}`,
		`Venue: Riverside Arena, Portland OR`,
		`Your tickets: ${order.ticketCount}`,
		`Order: ${order.id}`,
		``,
		`Doors open 1 hour before showtime. Enjoy the show!`,
	].join('\n');
	return { subject, body };
}
