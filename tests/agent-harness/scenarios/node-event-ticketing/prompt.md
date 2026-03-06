The ShowTime event ticketing platform has multiple issues. Purchasing floor tickets for a
surge-priced event returns NaN as the order total. VIP seats show as unavailable even though
the venue map shows they should exist. Early-bird discount purchases barely apply any
discount — a 45-day advance purchase that should get 20% off is getting almost nothing.
There may also be a subtle issue with how service fees are calculated.

The main checkout flow starts in `checkout.js` and coordinates `pricing.js`, `fees.js`,
`discounts.js`, `seats.js`, `venues.js`, and `orders.js`. Platform configuration is loaded
in `config.js`. Run `node --test test-ticketing.js` to see the failures — multiple things
seem wrong across different parts of the system.
