/**
 * Visible tests for the hotel reservation system.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReservation } from './reservations.js';

test('group booking assigns correct room count', () => {
	const res = buildReservation({
		roomType: 'deluxe',
		checkIn: '2024-10-01',
		checkOut: '2024-10-04',
		roomCount: 3,
	});
	assert.equal(res.roomCount, 3, `Expected roomCount 3, got ${res.roomCount}`);
});

test('reservation result has expected numeric fields', () => {
	const res = buildReservation({
		roomType: 'standard',
		checkIn: '2024-05-01',
		checkOut: '2024-05-02',
		guestName: 'Test Guest',
	});
	assert.ok(typeof res.total === 'number', `total should be a number, got ${typeof res.total}`);
	assert.ok(isFinite(res.total), `total should be finite, got ${res.total}`);
	assert.ok(res.total > 0, `total should be positive, got ${res.total}`);
});
