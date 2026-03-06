/**
 * Hidden oracle validation for node-hotel-reservations.
 * Tests each bug independently then verifies integrated behaviour.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig, getRoomConfig } from './config.js';
import { calculateNightlyTotal, getSeasonalRate, calculatePricing } from './pricing.js';
import { applyGroupDiscount } from './groups.js';
import { applyLoyalty, finalizeDiscounts } from './discounts.js';
import { calculateTaxes } from './taxes.js';
import { buildReservation, createReservation } from './reservations.js';

describe('Bug 1 — string resortFee in encoded config causes string concatenation', () => {
	it('deluxe resortFee must be a number, not a string', () => {
		const config = loadConfig();
		assert.strictEqual(
			typeof config.roomTypes.deluxe.resortFee,
			'number',
			`resortFee should be number, got ${typeof config.roomTypes.deluxe.resortFee} ("${config.roomTypes.deluxe.resortFee}")`,
		);
	});

	it('deluxe nightly total is a number, not a string-concatenated value', () => {
		const roomConfig = getRoomConfig('deluxe');
		const seasonalRate = getSeasonalRate('deluxe', '2024-09-10'); // standard season (1.0x)
		const nightlyTotal = calculateNightlyTotal(seasonalRate, roomConfig.resortFee);
		assert.strictEqual(typeof nightlyTotal, 'number', `nightlyTotal type should be 'number', got '${typeof nightlyTotal}' (value: ${nightlyTotal})`);
		assert.strictEqual(nightlyTotal, 295, `Expected 250 + 45 = 295, got ${nightlyTotal}`);
	});

	it('single deluxe 3-night stay total is 982.35 (not in the tens of thousands)', () => {
		const res = buildReservation({ roomType: 'deluxe', checkIn: '2024-09-10', checkOut: '2024-09-13' });
		assert.ok(typeof res.total === 'number' && isFinite(res.total), `total must be a finite number, got ${res.total}`);
		assert.strictEqual(res.total, 982.35, `Expected 982.35, got ${res.total}`);
	});
});

describe('Bug 2 — loyalty discount reads baseRate instead of nightlyTotal/perRoomRate', () => {
	it('loyalty on a single room uses nightlyTotal (295), not baseRate (250)', () => {
		const res = createReservation({ roomType: 'deluxe', checkIn: '2024-04-01', checkOut: '2024-04-03', loyaltyTier: 'silver' });
		calculatePricing(res);
		applyLoyalty(res, 'silver');
		// silver = 5%, applied to nightlyTotal (295) → 295 * 0.95 = 280.25
		// BUG applies to baseRate (250) → 250 * 0.95 = 237.5
		assert.ok(Math.abs(res.finalRate - 280.25) < 0.01, `Expected finalRate 280.25 (295 * 0.95), got ${res.finalRate}`);
	});

	it('group discount sets perRoomRate before loyalty is applied', () => {
		const res = createReservation({ roomType: 'deluxe', checkIn: '2024-09-15', checkOut: '2024-09-20', roomCount: 3 });
		calculatePricing(res);
		applyGroupDiscount(res, 3);
		assert.ok(Math.abs(res.perRoomRate - 250.75) < 0.01, `Expected perRoomRate 250.75 (295*0.85), got ${res.perRoomRate}`);
	});

	it('gold loyalty on group booking uses perRoomRate (250.75), giving finalRate 225.675', () => {
		const res = createReservation({ roomType: 'deluxe', checkIn: '2024-09-15', checkOut: '2024-09-20', roomCount: 3 });
		calculatePricing(res);
		applyGroupDiscount(res, 3);
		applyLoyalty(res, 'gold');
		// gold = 10%, applied to perRoomRate (250.75) → 225.675
		// BUG reads baseRate (250) → 225.0
		assert.ok(Math.abs(res.finalRate - 225.675) < 0.01, `Expected finalRate 225.675 (250.75 * 0.90), got ${res.finalRate}`);
	});

	it('silver loyalty single deluxe 2 nights: total ≈ 622.16', () => {
		const res = buildReservation({ roomType: 'deluxe', checkIn: '2024-04-01', checkOut: '2024-04-03', loyaltyTier: 'silver' });
		// subtotal = 280.25 * 2 = 560.5, tax = 560.5 * 0.11 = 61.655, total = 622.155
		assert.ok(Math.abs(res.total - 622.16) < 0.02, `Expected ~622.16, got ${res.total}`);
	});
});

describe('Bug 3 — tax calculated on pre-discount subtotal instead of discountedSubtotal', () => {
	it('tax is computed on discountedSubtotal, not subtotal', () => {
		// Construct a reservation object directly with known values
		const res = {
			subtotal: 1000,
			discountedSubtotal: 900, // 10% promo applied
			nights: 5,
			roomCount: 1,
		};
		calculateTaxes(res);
		// Correct: tax = 900 * 0.11 = 99.00, total = 900 + 99 = 999.00
		// Bug 3:   tax = 1000 * 0.11 = 110.00, total = 900 + 110 = 1010.00
		assert.ok(Math.abs(res.tax - 99) < 0.01, `Expected tax 99.00 (on discountedSubtotal 900), got ${res.tax}`);
		assert.ok(Math.abs(res.total - 999) < 0.01, `Expected total 999.00, got ${res.total}`);
	});

	it('SAVE10 promo reduces the tax base, not just the final total', () => {
		// Build with SAVE10, check that tax < subtotal * taxRate
		const res = buildReservation({
			roomType: 'deluxe',
			checkIn: '2024-09-15',
			checkOut: '2024-09-20',
			roomCount: 3,
			loyaltyTier: 'gold',
			promoCode: 'SAVE10',
		});
		// After fix: tax should be based on discountedSubtotal (~3046.61), not subtotal (~3385.13)
		// Correct tax ≈ 3046.61 * 0.11 = 335.13
		// Bug 3 tax ≈ 3385.13 * 0.11 = 372.36
		assert.ok(Math.abs(res.tax - 335.13) < 0.5, `Expected tax ~335.13 (on discountedSubtotal), got ${res.tax}`);
	});
});

describe('Integration — full reservation totals with all bugs fixed', () => {
	it('standard room 2 nights = 366.30 (control)', () => {
		const res = buildReservation({ roomType: 'standard', checkIn: '2024-05-01', checkOut: '2024-05-03' });
		assert.strictEqual(res.total, 366.3);
	});

	it('group booking 3 deluxe rooms, 5 nights, gold loyalty, SAVE10 ≈ 3381.74', () => {
		const res = buildReservation({
			roomType: 'deluxe',
			checkIn: '2024-09-15',
			checkOut: '2024-09-20',
			roomCount: 3,
			loyaltyTier: 'gold',
			promoCode: 'SAVE10',
		});
		assert.ok(Math.abs(res.total - 3381.74) < 0.02, `Expected ~3381.74, got ${res.total}`);
	});

	it('summer season multiplier applies: deluxe July nightly = 356.25 (250*1.25 + 45)', () => {
		const res = createReservation({ roomType: 'deluxe', checkIn: '2024-07-10', checkOut: '2024-07-11' });
		calculatePricing(res);
		assert.ok(Math.abs(res.nightlyTotal - 356.25) < 0.01, `Expected nightlyTotal 356.25 (250*1.25+45), got ${res.nightlyTotal}`);
	});

	it('suite 1 night standard season total = 571.65', () => {
		const res = buildReservation({ roomType: 'suite', checkIn: '2024-03-10', checkOut: '2024-03-11' });
		assert.ok(Math.abs(res.total - 571.65) < 0.02, `Expected ~571.65, got ${res.total}`);
	});
});
