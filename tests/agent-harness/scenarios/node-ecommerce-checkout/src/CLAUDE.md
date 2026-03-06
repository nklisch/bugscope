# ShopEasy Checkout

E-commerce checkout system handling cart management, volume pricing, bundle promotions, coupons, inventory reservation, and order creation.

## Files

- `config.js` — product catalog, volume discount tiers, and platform settings
- `catalog.js` — product lookup
- `cart.js` — `buildCart(items)` and cart state management
- `pricing.js` — `applyVolumePricing(cart)` based on quantity tiers
- `promotions.js` — `applyBundles(cart)`, `applyCoupon(cart, code)`
- `inventory.js` — `reserveItems(items)`, `resetStock(stock)`
- `shipping.js` — shipping cost calculation
- `tax.js` — tax rate lookup by region
- `payment.js` — payment processing
- `orders.js` — order creation and orchestration
- `receipts.js` — receipt generation
- `checkout.js` — `checkout(cart, options)` top-level entry point
- `test-checkout.js` — test suite

## Running

```bash
node --test test-checkout.js
```
