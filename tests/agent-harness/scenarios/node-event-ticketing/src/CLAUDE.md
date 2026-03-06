# ShowTime Ticketing Platform

Event ticketing platform handling seat selection, dynamic surge pricing, early-bird and group discounts, service fees, and order creation.

## Files

- `config.js` — platform configuration and event definitions (cached after first load)
- `events.js` — event data and lookup
- `venues.js` — `getVenue(id)`, `getAllSeats(venue)` — venue maps and seat sections
- `seats.js` — `SeatInventory` class, seat availability
- `inventory.js` — seat locking and reservation (`resetLockedSeats()`)
- `surge.js` — surge pricing multiplier based on occupancy
- `pricing.js` — base ticket price calculation
- `discounts.js` — `calculateEarlyBird(daysUntil)`, `calculateGroupDiscount(size)`
- `fees.js` — service fee and processing fee calculation
- `cart.js` — cart accumulation
- `payment.js` — payment processing
- `orders.js` — order assembly
- `checkout.js` — `checkout(eventId, seats, options)` and `applyDiscount(price, discount)`
- `waitlist.js` — waitlist management
- `notifications.js` — booking notifications
- `analytics.js` — purchase analytics
- `formatters.js` — display formatting
- `validators.js` — input validation
- `utils.js` — shared utilities
- `test-ticketing.js` — test suite

## Running

```bash
node --test test-ticketing.js
```
