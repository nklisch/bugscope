/**
 * Visible failing tests for the hotel reservation system.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReservation } from './reservations.js';

test('single deluxe room, 3 nights — correct total', () => {
	const res = buildReservation({
		roomType: 'deluxe',
		checkIn: '2024-09-10',
		checkOut: '2024-09-13',
		guestName: 'Alice Chen',
	});
	// Expected: (250 + 45) * 3 nights, then 11% tax = 885 * 1.11 = 982.35
	assert.equal(res.total, 982.35, `Expected $982.35, got $${res.total}`);
});

test('group booking: 3 deluxe rooms, 5 nights, gold loyalty, SAVE10 promo', () => {
	const res = buildReservation({
		roomType: 'deluxe',
		checkIn: '2024-09-15',
		checkOut: '2024-09-20',
		roomCount: 3,
		loyaltyTier: 'gold',
		promoCode: 'SAVE10',
		guestName: 'Meridian Corp',
	});
	// Expected: finalRate = 295*0.85*0.90 = 225.675, subtotal = 225.675*5*3 = 3385.125
	// discountedSubtotal = 3385.125*0.90 = 3046.6125, tax = 3046.6125*0.11 = 335.13 → total = 3381.74
	assert.ok(Math.abs(res.total - 3381.74) < 0.02, `Expected ~$3381.74, got $${res.total}`);
});

test('standard room, 2 nights — control case', () => {
	const res = buildReservation({
		roomType: 'standard',
		checkIn: '2024-05-01',
		checkOut: '2024-05-03',
		guestName: 'Bob Smith',
	});
	// Expected: (150 + 15) * 2 = 330, tax = 330 * 0.11 = 36.30, total = 366.30
	assert.equal(res.total, 366.3, `Expected $366.30, got $${res.total}`);
});

test('group booking assigns correct room count', () => {
	const res = buildReservation({
		roomType: 'deluxe',
		checkIn: '2024-10-01',
		checkOut: '2024-10-04',
		roomCount: 3,
	});
	assert.equal(res.roomCount, 3, `Expected roomCount 3, got ${res.roomCount}`);
});
