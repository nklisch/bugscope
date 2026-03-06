/**
 * Checkout orchestrator for the ShowTime ticketing platform.
 *
 * Coordinates the full ticket purchase pipeline:
 *   1. Load event configuration
 *   2. Resolve selected seats from venue layout
 *   3. Apply dynamic (surge) pricing
 *   4. Apply applicable discounts (early-bird, group, promo)
 *   5. Calculate service fees
 *   6. Lock seats and process payment
 *   7. Create and return confirmed order
 */

import { loadConfig, getFeesConfig } from './config.js';
import { getEvent, getDaysUntilEvent } from './events.js';
import { getVenue, getAllSeats } from './venues.js';
import { buildTicketItem, applyDynamicPricing } from './pricing.js';
import { calculateEarlyBird, calculateGroupDiscount, applyPromoCode } from './discounts.js';
import { calculateOrderFees } from './fees.js';
import { lockSeats, releaseSessionLocks } from './inventory.js';
import { authorisePayment } from './payment.js';
import { createOrder } from './orders.js';
import { generateOrderId, roundMoney } from './utils.js';

/**
 * Apply a discount to a price.
 *
 * discount values are percentages (0-100)
 *
 * @param {number} price
 * @param {number} discountValue - Percentage to discount (0-100 scale)
 * @returns {number} Discounted price
 */
export function applyDiscount(price, discountValue) {
	return roundMoney(price * (1 - discountValue / 100));
}

/**
 * Run the complete ticket checkout pipeline.
 *
 * @param {string} eventId
 * @param {Array<{ seatId: string }>} seatSelections
 * @param {Object} options
 * @param {Object} options.payment - Payment details
 * @param {number} [options.groupSize=1] - Group size for group discount eligibility
 * @param {string} [options.promoCode] - Optional promotional code
 * @returns {Promise<{ success: boolean, total: number|null, order: Object|null, error: string|null }>}
 */
export async function checkout(eventId, seatSelections, options = {}) {
	const { payment, groupSize = 1, promoCode } = options;
	const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

	// Stage 1: Load event and configuration
	const config = loadConfig(eventId); // Bug 1: shallow merge may have dropped pricing defaults
	const event = getEvent(eventId);

	// Stage 2: Resolve selected seats from venue layout
	const venue = getVenue(event.venueId);
	const allSeats = getAllSeats(venue); // Bug 5: VIP sections remain nested after .flat()
	const selectedSeats = seatSelections.map((sel) => allSeats.find((s) => s.id === sel.seatId)).filter(Boolean);

	if (selectedSeats.length !== seatSelections.length) {
		const missingIds = seatSelections.filter((sel) => !selectedSeats.find((s) => s.id === sel.seatId)).map((sel) => sel.seatId);
		return { success: false, total: null, order: null, error: `Seats not found: ${missingIds.join(', ')}` };
	}

	// Stage 3: Build and price ticket items
	const rawItems = selectedSeats.map((seat) => buildTicketItem(seat, event, config));
	const pricedItems = applyDynamicPricing(rawItems, event, config);
	// After applyDynamicPricing: item.surgeTotal = item.price * multiplier + config.pricing.baseFee
	// Bug 1 effect: config.pricing.baseFee is undefined → surgeTotal is NaN

	// Stage 4: Apply discounts
	const daysUntil = getDaysUntilEvent(eventId);
	const earlyBirdRate = calculateEarlyBird(daysUntil); // Bug 3: returns 0.20 (decimal) not 20 (percent)
	const groupRate = calculateGroupDiscount(groupSize);
	// Early-bird and group discounts are mutually exclusive; early-bird takes priority
	const effectiveDiscountRate = earlyBirdRate > 0 ? earlyBirdRate : groupRate;

	const discountedItems = pricedItems.map((item) => ({
		...item,
		finalPrice: effectiveDiscountRate > 0 ? applyDiscount(item.surgeTotal, effectiveDiscountRate) : item.surgeTotal,
		// Bug 3 interaction: applyDiscount(surgeTotal, 0.20) = surgeTotal * 0.998 (0.2% off, not 20%)
	}));

	const appliedDiscounts = [];
	if (effectiveDiscountRate > 0) {
		const label = earlyBirdRate > 0 ? `Early-bird (${daysUntil} days)` : `Group (${groupSize} tickets)`;
		const savings = roundMoney(pricedItems.reduce((sum, item) => sum + item.surgeTotal, 0) - discountedItems.reduce((sum, item) => sum + item.finalPrice, 0));
		appliedDiscounts.push({ type: earlyBirdRate > 0 ? 'early-bird' : 'group', amount: savings, description: label });
	}

	// Apply promo code on top of other discounts
	let promoResult = null;
	let promoSavings = 0;
	if (promoCode) {
		const productTotal = roundMoney(discountedItems.reduce((sum, item) => sum + item.finalPrice, 0));
		promoResult = applyPromoCode(productTotal, promoCode);
		if (promoResult.applied) {
			promoSavings = promoResult.savings;
			appliedDiscounts.push({ type: 'promo', amount: promoSavings, description: promoResult.description });
		}
	}

	// Stage 5: Calculate fees
	// Bug 4: calculateOrderFees → calculateServiceFee reads item.price (original) not item.adjustedPrice
	const fees = calculateOrderFees(discountedItems, config.fees);

	// Stage 6: Lock seats and process payment
	const seatIds = selectedSeats.map((s) => s.id);
	const lockResult = lockSeats(seatIds, sessionId);
	if (!lockResult.success) {
		return { success: false, total: null, order: null, error: lockResult.error };
	}

	const productSubtotal = roundMoney(discountedItems.reduce((sum, item) => sum + item.finalPrice, 0) - promoSavings);
	const orderTotal = roundMoney(productSubtotal + fees.total);

	const paymentResult = authorisePayment(payment, orderTotal);
	if (!paymentResult.authorised) {
		releaseSessionLocks(sessionId);
		return { success: false, total: null, order: null, error: paymentResult.error };
	}

	// Stage 7: Create order
	const cart = { tickets: discountedItems };
	const order = createOrder({
		cart,
		fees,
		eventId,
		payment: { ...payment, transactionRef: paymentResult.transactionRef },
		appliedDiscounts,
	});

	return { success: true, total: order.total, order };
}
