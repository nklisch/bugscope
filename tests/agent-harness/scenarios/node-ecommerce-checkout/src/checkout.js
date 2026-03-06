/**
 * Checkout orchestrator for ShopEasy.
 *
 * Coordinates the full checkout pipeline:
 *   1. Apply volume pricing
 *   2. Apply bundle promotions
 *   3. Apply coupon code (if provided)
 *   4. Calculate shipping
 *   5. Calculate tax
 *   6. Reserve inventory
 *   7. Process payment
 *   8. Create order
 */

import { createCart, addItem } from './cart.js';
import { applyVolumePricing } from './pricing.js';
import { applyBundles, applyCoupon } from './promotions.js';
import { calculateShipping } from './shipping.js';
import { calculateTax } from './tax.js';
import { checkStock, reserveItems } from './inventory.js';
import { authorisePayment } from './payment.js';
import { createOrder } from './orders.js';
import { roundMoney } from './utils.js';

/**
 * Run the complete checkout pipeline for a customer's cart.
 *
 * @param {Object} cart       - Cart with items already added
 * @param {Object} options
 * @param {string} options.region      - Customer region (e.g. 'US-CA')
 * @param {string} [options.coupon]    - Optional coupon code
 * @param {Object} options.payment     - Payment details
 * @returns {Promise<{ success: boolean, order: Object | null, error: string | null }>}
 */
export async function checkout(cart, options) {
	const { region = 'US-DEFAULT', coupon, payment } = options;

	// Stage 1: Volume pricing
	applyVolumePricing(cart);

	// Stage 2: Bundle promotions
	applyBundles(cart);

	// Stage 3: Coupon code
	if (coupon) {
		applyCoupon(cart, coupon);
	}

	// Stage 4: Shipping
	const { cost: shippingCost, zone } = calculateShipping(cart, region);

	// Stage 5: Tax (on post-discount product total, before shipping)
	const taxableAmount = cart.currentTotal;
	const taxAmount = calculateTax(taxableAmount, region);

	// Stage 6: Inventory check and reservation
	const stockCheck = await checkStock(cart.items);
	if (!stockCheck.available) {
		const shortage = stockCheck.shortages[0];
		return { success: false, order: null, error: `Insufficient stock for ${shortage.sku}` };
	}

	const reservedUnits = await reserveItems(cart.items);

	// Stage 7: Payment
	const orderTotal = roundMoney(cart.currentTotal + shippingCost + taxAmount);
	const paymentResult = authorisePayment(payment, orderTotal);
	if (!paymentResult.authorised) {
		return { success: false, order: null, error: paymentResult.error };
	}

	// Stage 8: Create order
	const order = createOrder({
		cart,
		shippingCost,
		taxAmount,
		region,
		payment,
		transactionId: paymentResult.transactionId,
	});

	return { success: true, order, reservedUnits };
}

/**
 * Build a cart from a list of { sku, quantity } items.
 *
 * @param {Array<{ sku: string, quantity: number }>} items
 * @param {string} [customerId]
 * @returns {Object} Populated cart
 */
export function buildCart(items, customerId = null) {
	const cart = createCart(customerId);
	for (const { sku, quantity } of items) {
		addItem(cart, sku, quantity);
	}
	return cart;
}
