/**
 * Hidden oracle validation for node-event-ticketing.
 * Tests each bug independently then verifies integrated behaviour.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, clearConfigCache } from './config.js';
import { getVenue, getAllSeats } from './venues.js';
import { SeatInventory } from './seats.js';
import { getSurgeMultiplier } from './surge.js';
import { applyDynamicPricing, buildTicketItem } from './pricing.js';
import { calculateEarlyBird, calculateGroupDiscount } from './discounts.js';
import { calculateServiceFee, calculateOrderFees } from './fees.js';
import { checkout, applyDiscount } from './checkout.js';
import { resetLockedSeats } from './inventory.js';
import { getEvent } from './events.js';

const TEST_PAYMENT = { method: 'card', cardLast4: '1234', cardExpiry: '06/28' };

// ═══════════════════════════════════════════════════════════════════════
// Bug 1 — Object.assign shallow merge drops nested pricing defaults
// ═══════════════════════════════════════════════════════════════════════
describe('Bug 1 — shallow config merge drops pricing defaults', () => {
	it('loadConfig preserves pricing.baseFee from defaults after override merge', () => {
		clearConfigCache();
		const config = loadConfig('EVT-001');
		assert.strictEqual(
			typeof config.pricing.baseFee,
			'number',
			`config.pricing.baseFee should be a number, got ${typeof config.pricing.baseFee} — Object.assign drops nested objects`,
		);
		assert.strictEqual(config.pricing.baseFee, 5.0, `baseFee should be 5.00, got ${config.pricing.baseFee}`);
	});

	it('loadConfig preserves pricing.tiers from defaults after override merge', () => {
		clearConfigCache();
		const config = loadConfig('EVT-001');
		assert.ok(Array.isArray(config.pricing.tiers), `config.pricing.tiers should be an array, got ${typeof config.pricing.tiers}`);
		assert.strictEqual(config.pricing.tiers.length, 4, `Expected 4 tiers, got ${config.pricing.tiers.length}`);
	});

	it('loadConfig retains event-specific override (surgeCap=3.0) after merge', () => {
		clearConfigCache();
		const config = loadConfig('EVT-001');
		assert.strictEqual(config.pricing.surgeCap, 3.0, `surgeCap should be overridden to 3.0, got ${config.pricing.surgeCap}`);
	});

	it('EVT-002 config has no pricing override — all defaults preserved', () => {
		clearConfigCache();
		const config = loadConfig('EVT-002');
		assert.strictEqual(config.pricing.baseFee, 5.0);
		assert.strictEqual(config.pricing.surgeCap, 2.0, 'EVT-002 should retain default surgeCap of 2.0');
		assert.ok(Array.isArray(config.pricing.tiers));
	});

	it('surge calculation does not produce NaN for EVT-001', () => {
		clearConfigCache();
		const config = loadConfig('EVT-001');
		const multiplier = getSurgeMultiplier(config.pricing, 0.72);
		assert.ok(isFinite(multiplier), `Surge multiplier must be finite, got ${multiplier}`);
	});

	it('dynamic pricing does not produce NaN surgeTotal for EVT-001', () => {
		clearConfigCache();
		const config = loadConfig('EVT-001');
		const event = getEvent('EVT-001');
		const items = [{ seatId: 'FLOOR-A-2', section: 'FLOOR', row: 'A', number: 2, category: 'floor', price: 120 }];
		const priced = applyDynamicPricing(items, event, config);
		assert.ok(isFinite(priced[0].surgeTotal), `surgeTotal must be finite, got ${priced[0].surgeTotal}`);
		assert.ok(Math.abs(priced[0].surgeTotal - 185) < 0.1, `Expected surgeTotal ~185 (180+5), got ${priced[0].surgeTotal}`);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Bug 2 — ghost bug: SeatInventory.getSeats() bypasses available filter
// ═══════════════════════════════════════════════════════════════════════
describe('Bug 2 — lazy getter: getSeats() returns all seats before availableSeats accessed', () => {
	it('getSeats returns only available seats WITHOUT accessing .availableSeats first', () => {
		const allSeats = [
			{ id: 'FLOOR-A-1', section: 'FLOOR', row: 'A', number: 1, category: 'floor', status: 'sold' },
			{ id: 'FLOOR-A-2', section: 'FLOOR', row: 'A', number: 2, category: 'floor', status: 'available' },
			{ id: 'FLOOR-A-3', section: 'FLOOR', row: 'A', number: 3, category: 'floor', status: 'held' },
			{ id: 'LOWER-D-1', section: 'LOWER', row: 'D', number: 1, category: 'lower', status: 'available' },
		];
		const inventory = new SeatInventory(allSeats);
		// Do NOT access inventory.availableSeats here — that would trigger lazy init and hide the bug
		const floorSeats = inventory.getSeats('FLOOR');
		assert.ok(
			floorSeats.every((s) => s.status === 'available'),
			`getSeats('FLOOR') should only return available seats. Got statuses: ${floorSeats.map((s) => s.status).join(', ')}`,
		);
		assert.strictEqual(floorSeats.length, 1, `Expected 1 available floor seat, got ${floorSeats.length} (sold/held seats leaked in)`);
	});

	it('getSeats returns only available seats for LOWER section', () => {
		const allSeats = [
			{ id: 'LOWER-D-1', section: 'LOWER', row: 'D', number: 1, category: 'lower', status: 'available' },
			{ id: 'LOWER-D-2', section: 'LOWER', row: 'D', number: 2, category: 'lower', status: 'sold' },
			{ id: 'LOWER-D-3', section: 'LOWER', row: 'D', number: 3, category: 'lower', status: 'available' },
			{ id: 'VIP-N-1-1', section: 'VIP', row: '1', number: 1, category: 'vip', status: 'available' },
		];
		const inventory = new SeatInventory(allSeats);
		const lowerSeats = inventory.getSeats('LOWER');
		assert.ok(
			lowerSeats.every((s) => s.status === 'available'),
			`getSeats('LOWER') must only return available seats, got: ${lowerSeats.map((s) => `${s.id}(${s.status})`).join(', ')}`,
		);
	});

	it('getSeats returns correct count for section with mixed availability', () => {
		const allSeats = [
			{ id: 'FLOOR-B-1', section: 'FLOOR', row: 'B', number: 1, category: 'floor', status: 'available' },
			{ id: 'FLOOR-B-2', section: 'FLOOR', row: 'B', number: 2, category: 'floor', status: 'sold' },
			{ id: 'FLOOR-B-3', section: 'FLOOR', row: 'B', number: 3, category: 'floor', status: 'held' },
			{ id: 'FLOOR-B-4', section: 'FLOOR', row: 'B', number: 4, category: 'floor', status: 'available' },
		];
		const inventory = new SeatInventory(allSeats);
		const seats = inventory.getSeats('FLOOR');
		assert.strictEqual(seats.length, 2, `Expected 2 available floor seats (B1, B4), got ${seats.length}`);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Bug 3 — early-bird returns decimal, applyDiscount expects percentage
// ═══════════════════════════════════════════════════════════════════════
describe('Bug 3 — early-bird discount format mismatch (decimal vs percentage)', () => {
	it('calculateEarlyBird(45) returns a value that gives 20% off when passed to applyDiscount', () => {
		const discount = calculateEarlyBird(45);
		const result = applyDiscount(100, discount);
		// Correct: applyDiscount(100, 20) = 80
		// Bug 3:   applyDiscount(100, 0.20) = 99.80
		assert.ok(Math.abs(result - 80) < 0.1, `Expected $80 (20% off $100), got $${result.toFixed(2)} — early-bird discount value is ${discount}`);
	});

	it('calculateEarlyBird(45) gives 20% off a $120 ticket → $96', () => {
		const discount = calculateEarlyBird(45);
		const result = applyDiscount(120, discount);
		assert.ok(Math.abs(result - 96) < 0.1, `Expected $96 (20% off $120), got $${result.toFixed(2)}`);
	});

	it('calculateEarlyBird(20) returns 10% (14-29 days window)', () => {
		const discount = calculateEarlyBird(20);
		const result = applyDiscount(100, discount);
		// Correct: applyDiscount(100, 10) = 90
		// Bug 3:   applyDiscount(100, 0.10) = 99.90
		assert.ok(Math.abs(result - 90) < 0.1, `Expected $90 (10% off $100), got $${result.toFixed(2)}`);
	});

	it('calculateEarlyBird(5) returns 0 (no early-bird within 5 days)', () => {
		const discount = calculateEarlyBird(5);
		const result = applyDiscount(100, discount);
		assert.strictEqual(result, 100, `No discount expected for 5 days, got $${result}`);
	});

	it('group discount of 15 (integer) works correctly with applyDiscount', () => {
		// Group discount returns an integer percentage — verify this is not affected
		const discount = calculateGroupDiscount(10);
		const result = applyDiscount(100, discount);
		assert.ok(Math.abs(result - 85) < 0.01, `Group discount: expected $85, got $${result}`);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Bug 4 — service fee uses item.price instead of item.adjustedPrice
// ═══════════════════════════════════════════════════════════════════════
describe('Bug 4 — service fee calculated on original price, not surge-adjusted price', () => {
	it('calculateServiceFee uses adjustedPrice (surge) not original price', () => {
		const item = { price: 50, adjustedPrice: 75, surgeMultiplier: 1.5 };
		const feeConfig = { servicePercent: 0.12, processingFlat: 2.5 };
		const fee = calculateServiceFee(item, feeConfig);
		// Correct: 75 × 0.12 = 9.00
		// Bug 4:   50 × 0.12 = 6.00
		assert.ok(Math.abs(fee - 9.0) < 0.01, `Expected service fee $9.00 (12% of $75 surge price), got $${fee.toFixed(2)}`);
	});

	it('calculateServiceFee for $120 base ticket with 1.5x surge → fee on $180', () => {
		const item = { price: 120, adjustedPrice: 180, surgeMultiplier: 1.5 };
		const feeConfig = { servicePercent: 0.12, processingFlat: 2.5 };
		const fee = calculateServiceFee(item, feeConfig);
		// Correct: 180 × 0.12 = 21.60
		// Bug 4:   120 × 0.12 = 14.40
		assert.ok(Math.abs(fee - 21.6) < 0.01, `Expected fee $21.60 (12% of adjusted $180), got $${fee.toFixed(2)}`);
	});

	it('calculateOrderFees totals use adjusted price for service fee', () => {
		const items = [
			{ seatId: 'FLOOR-A-2', price: 120, adjustedPrice: 180, surgeMultiplier: 1.5 },
			{ seatId: 'FLOOR-B-1', price: 120, adjustedPrice: 180, surgeMultiplier: 1.5 },
		];
		const feeConfig = { servicePercent: 0.12, processingFlat: 2.5 };
		const fees = calculateOrderFees(items, feeConfig);
		// Correct: 2 × (21.60 + 2.50) = 48.20
		// Bug 4:   2 × (14.40 + 2.50) = 33.80
		assert.ok(Math.abs(fees.total - 48.2) < 0.1, `Expected total fees $48.20, got $${fees.total.toFixed(2)}`);
		assert.ok(Math.abs(fees.serviceFeeTotal - 43.2) < 0.1, `Expected service fees $43.20, got $${fees.serviceFeeTotal.toFixed(2)}`);
	});

	it('no-surge ticket: service fee is same regardless of price/adjustedPrice', () => {
		// When there is no surge, price === adjustedPrice, so Bug 4 has no effect
		const item = { price: 75, adjustedPrice: 75, surgeMultiplier: 1.0 };
		const feeConfig = { servicePercent: 0.12, processingFlat: 2.5 };
		const fee = calculateServiceFee(item, feeConfig);
		assert.ok(Math.abs(fee - 9.0) < 0.01, `Expected $9.00 (12% of $75), got $${fee.toFixed(2)}`);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Bug 5 — Array.flat() depth 1 fails for VIP 3-level nesting
// ═══════════════════════════════════════════════════════════════════════
describe('Bug 5 — Array.flat() default depth-1 leaves VIP seats nested', () => {
	it('getAllSeats returns VIP seats as individual seat objects (not arrays)', () => {
		const venue = getVenue('ARENA-001');
		const allSeats = getAllSeats(venue);
		const vipItems = allSeats.filter((s) => s && typeof s === 'object' && !Array.isArray(s) && s.section === 'VIP');
		assert.ok(vipItems.length > 0, `Expected VIP seat objects in getAllSeats result, got 0 — flat() may not be flattening VIP zones`);
	});

	it('getAllSeats returns 16 VIP seat objects (2 zones × 2 rows × 4 seats)', () => {
		const venue = getVenue('ARENA-001');
		const allSeats = getAllSeats(venue);
		const vipSeats = allSeats.filter((s) => s && typeof s === 'object' && !Array.isArray(s) && s.section === 'VIP');
		assert.strictEqual(vipSeats.length, 16, `Expected 16 VIP seats, got ${vipSeats.length}`);
	});

	it('all VIP items in getAllSeats have valid .id and .status properties', () => {
		const venue = getVenue('ARENA-001');
		const allSeats = getAllSeats(venue);
		const vipItems = allSeats.filter((s) => s && typeof s === 'object' && !Array.isArray(s) && s.section === 'VIP');
		for (const seat of vipItems) {
			assert.ok(typeof seat.id === 'string', `VIP seat must have string id, got ${typeof seat.id}`);
			assert.ok(['available', 'sold', 'held'].includes(seat.status), `VIP seat status must be valid, got ${seat.status}`);
		}
	});

	it('SeatInventory.availableSeats includes VIP available seats', () => {
		const venue = getVenue('ARENA-001');
		const inventory = new SeatInventory(getAllSeats(venue));
		const vipAvailable = inventory.availableSeats.filter((s) => s.section === 'VIP');
		assert.ok(vipAvailable.length > 0, `Expected VIP seats in availableSeats, got ${vipAvailable.length}`);
		assert.strictEqual(vipAvailable.length, 16, `All 16 VIP seats should be available, got ${vipAvailable.length}`);
	});

	it('getAllSeats total count: 15 floor + 40 lower + 16 VIP = 71', () => {
		const venue = getVenue('ARENA-001');
		const allSeats = getAllSeats(venue);
		const seatObjects = allSeats.filter((s) => s && typeof s === 'object' && !Array.isArray(s));
		assert.strictEqual(seatObjects.length, 71, `Expected 71 total seats, got ${seatObjects.length}`);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// Integration — full checkout with all bugs fixed
// ═══════════════════════════════════════════════════════════════════════
describe('Integration — checkout correct after all bugs fixed', () => {
	it('surge event checkout: total is finite and correct (~$418.20)', async () => {
		clearConfigCache();
		resetLockedSeats();
		const result = await checkout('EVT-001', [{ seatId: 'FLOOR-A-3' }, { seatId: 'FLOOR-B-2' }], { payment: TEST_PAYMENT });
		assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
		assert.ok(isFinite(result.total), `Total must be finite, got ${result.total}`);
		assert.ok(Math.abs(result.total - 418.2) < 1, `Expected ~$418.20, got $${result.total?.toFixed(2)}`);
	});

	it('VIP ticket checkout succeeds when VIP seats are found', async () => {
		clearConfigCache();
		resetLockedSeats();
		const result = await checkout('EVT-001', [{ seatId: 'VIP-NORTH-1-1' }], { payment: TEST_PAYMENT });
		assert.strictEqual(result.success, true, `VIP checkout failed: ${result.error}`);
		assert.strictEqual(result.order.tickets[0].category, 'vip');
	});

	it('early-bird discount gives meaningful savings on EVT-001 (>$10 saved)', async () => {
		clearConfigCache();
		resetLockedSeats();
		// EVT-001 is ~45 days away; early-bird should give 20% off surgeTotal
		// surgeTotal per ticket = 120 * 1.5 + 5 = 185 → 20% off = $37 savings
		// With Bug 3 (0.20 decimal): savings = 185 * 0.002 = $0.37 — nearly nothing
		const result = await checkout('EVT-001', [{ seatId: 'FLOOR-C-1' }], {
			payment: TEST_PAYMENT,
		});
		assert.strictEqual(result.success, true, `Checkout failed: ${result.error}`);
		assert.ok(isFinite(result.total), `Total must be finite, got ${result.total}`);
		assert.ok(
			result.order.discountsTotal > 10,
			`Expected early-bird savings >$10 (should be ~$37 for 20% off $185), got $${result.order.discountsTotal} — early-bird discount may be returning decimal instead of percentage`,
		);
	});

	it('EVT-002 control checkout succeeds with correct ticket count', async () => {
		clearConfigCache();
		resetLockedSeats();
		const result = await checkout(
			'EVT-002',
			[{ seatId: 'LOWER-F-1' }, { seatId: 'LOWER-F-2' }],
			{ payment: TEST_PAYMENT },
		);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.order.ticketCount, 2);
		assert.ok(isFinite(result.total));
	});
});
