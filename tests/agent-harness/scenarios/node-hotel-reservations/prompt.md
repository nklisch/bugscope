The hotel reservation system is producing wrong totals. A single deluxe room for 3 nights
should cost around $982, but the system is returning a value in the tens of thousands.
A group booking for 3 deluxe rooms over 5 nights with a gold-tier loyalty member and the
SAVE10 promo code should total around $3,382, but it's also coming out wrong.

Start with `reservations.js` which orchestrates the pricing pipeline, and trace through
`config.js`, `pricing.js`, `discounts.js`, `groups.js`, and `taxes.js`. The room and
rate configuration is loaded from `config.js`. Multiple things seem wrong.
Run `node --test test-reservations.js` to see the failures.
