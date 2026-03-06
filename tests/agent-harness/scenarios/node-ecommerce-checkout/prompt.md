The e-commerce checkout system is producing wrong order totals. A customer buying 30 units
of a product should get a bulk volume discount, but the order total is higher than expected —
it looks like the wrong discount tier is being applied. A checkout with a bundle deal and a
coupon code seems to apply the coupon even when it shouldn't qualify (the cart is below the
minimum spend after the bundle discount). The inventory reservation count is also wrong after
processing multi-item orders.

The main flow starts in `orders.js` which coordinates `cart.js`, `pricing.js`,
`promotions.js`, `inventory.js`, and `shipping.js`. Configuration including volume tiers is
loaded in `config.js`. Several things seem wrong — there are likely multiple bugs.
Run `node --test test-checkout.js` to see the failures.
