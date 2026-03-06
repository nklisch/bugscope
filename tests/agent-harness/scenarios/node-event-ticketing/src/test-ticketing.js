/**
 * Visible failing tests for the ShowTime ticketing platform.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout, applyDiscount } from './checkout.js';
import { getVenue, getAllSeats } from './venues.js';
import { SeatInventory } from './seats.js';
import { calculateEarlyBird, calculateGroupDiscount } from './discounts.js';
import { resetLockedSeats } from './inventory.js';
import { clearConfigCache } from './config.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '4242', cardExpiry: '12/27' };

// ── Test 1: surge event total is correct ───────────────────────────────────
// EVT-001 has a shallow-merged config (Bug 1: config.pricing.baseFee = undefined → NaN).
// Even after fixing Bug 1, the service fee is calculated on the original ticket price
// instead of the surge-adjusted price (Bug 4 → total is ~$14.40 too low for 2 tickets).
// Expected total: $418.20 (2 × floor at $120, 1.5x surge, $5 baseFee, 12% service fee on $180, $2.50 processing)
test('purchase 2 floor tickets for surge event: correct total', async () => {
	clearConfigCache();
	resetLockedSeats();
	const result = await checkout('EVT-001', [{ seatId: 'FLOOR-A-2' }, { seatId: 'FLOOR-B-1' }], { payment: TEST_PAYMENT });
	assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(isFinite(result.total), `Order total must be a finite number, got ${result.total}`);
	assert.ok(
		Math.abs(result.total - 418.2) < 1,
		`Expected ~$418.20 (2 floor tickets with 1.5x surge), got $${typeof result.total === 'number' ? result.total.toFixed(2) : result.total}`,
	);
});

// ── Test 2: VIP seats are available ───────────────────────────────────────
// Bug 5: venues.getAllSeats() uses .flat() (depth 1) which correctly handles regular sections
// (rows → seats) but fails for VIP (zones → rows → seats = 3 levels). VIP seat arrays
// remain nested, so inventory.availableSeats.filter(...) sees arrays not seat objects,
// and seat.status is undefined for arrays — all VIP seats disappear.
test('VIP ticket section has available seats', () => {
	const venue = getVenue('ARENA-001');
	const inventory = new SeatInventory(getAllSeats(venue));
	const vipSeats = inventory.availableSeats.filter((s) => s.section === 'VIP');
	assert.ok(vipSeats.length > 0, `Expected VIP seats to be available, but got ${vipSeats.length} seats`);
});

// ── Test 3: Early-bird discount is 20% not 0.2% ────────────────────────────
// Bug 3: calculateEarlyBird() returns a decimal fraction (0.20) but applyDiscount()
// expects an integer percentage (20). applyDiscount(price, 0.20) = price × 0.998,
// a 0.2% discount instead of the expected 20%.
test('early-bird 20% discount applies correctly for 45-day advance purchase', () => {
	const daysUntilEvent = 45; // > 30 day window → should get 20% off
	const basePrice = 120;
	const discount = calculateEarlyBird(daysUntilEvent);
	const discountedPrice = applyDiscount(basePrice, discount);
	// With all bugs fixed: applyDiscount(120, 20) = 120 × 0.80 = 96.00
	// With Bug 3:          applyDiscount(120, 0.20) = 120 × 0.998 = 119.76
	assert.ok(
		Math.abs(discountedPrice - 96) < 1,
		`Expected ~$96.00 (20% off $120), got $${discountedPrice.toFixed(2)} — early-bird discount may be in wrong format`,
	);
});

// ── Test 4: Simple single-ticket checkout completes (control) ──────────────
// EVT-002 has no pricing override in its config — defaults are fully preserved.
// Occupancy is low (30%) so no surge applies. This test establishes a baseline.
test('single lower-tier ticket checkout for jazz event completes (control)', async () => {
	clearConfigCache();
	resetLockedSeats();
	const result = await checkout('EVT-002', [{ seatId: 'LOWER-D-1' }], { payment: TEST_PAYMENT });
	assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
	assert.ok(result.order, 'Order object should exist');
});

// ── Test 5: Group discount applies correctly (passes) ──────────────────────
// calculateGroupDiscount returns integer percentages (10, 15, 20), which work correctly
// with applyDiscount. This test should pass despite the early-bird decimal bug.
test('group discount of 15% applies correctly for group of 10', () => {
	const groupSize = 10;
	const basePrice = 100;
	const discount = calculateGroupDiscount(groupSize);
	const discountedPrice = applyDiscount(basePrice, discount);
	// calculateGroupDiscount(10) = 15 (integer), applyDiscount(100, 15) = 85.00
	assert.ok(Math.abs(discountedPrice - 85) < 0.01, `Expected $85.00, got $${discountedPrice.toFixed(2)}`);
});

// ── Test 6: Order ticket count is correct (passes) ─────────────────────────
test('order contains the correct number of tickets for 3-seat purchase', async () => {
	clearConfigCache();
	resetLockedSeats();
	const result = await checkout(
		'EVT-002',
		[{ seatId: 'LOWER-D-2' }, { seatId: 'LOWER-D-3' }, { seatId: 'LOWER-D-6' }],
		{ payment: TEST_PAYMENT },
	);
	assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
	assert.strictEqual(result.order.ticketCount, 3, `Expected 3 tickets, got ${result.order.ticketCount}`);
});
