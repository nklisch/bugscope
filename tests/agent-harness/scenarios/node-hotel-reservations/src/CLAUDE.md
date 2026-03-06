# Hotel Reservation System

Calculates reservation totals through a pricing pipeline with room rates, loyalty discounts, group pricing, promo codes, and tax.

## Files

- `config.js` — room types, base rates, and platform configuration
- `rooms.js` — room availability and selection
- `pricing.js` — nightly rate and subtotal calculation
- `discounts.js` — loyalty tier and promo code discounts
- `groups.js` — group booking logic (multi-room)
- `taxes.js` — tax calculation and application
- `utils.js` — shared utilities
- `reservations.js` — `buildReservation(options)` orchestration
- `test-reservations.js` — test suite

## Running

```bash
node --test test-reservations.js
```
