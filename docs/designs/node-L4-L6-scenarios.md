# Design: Node.js L4-L6 Agent Harness Scenarios

Three advanced Node.js debugging scenarios that require runtime inspection to solve. Each escalates in codebase size, bug count, interaction complexity, and misdirection.

## Reference: Existing Node.js Scenarios

| Level | Scenario | Files | Lines | Bugs | Pattern |
|-------|----------|-------|-------|------|---------|
| L1 | `node-float-accumulation` | 3 | ~200 | 1 | Float precision in bill splitting |
| L1 | `node-regex-lastindex` | 3 | ~200 | 1 | RegExp lastIndex statefulness |
| L2 | `node-data-pipeline` | 6 | ~460 | 2 | DD/MM date parse + comma in parseFloat |
| L3 | `node-expense-tracker` | 8 | ~775 | 3 | Year filter + refund sign + whitespace key |

---

## Implementation Units

### Unit 1: `node-hotel-reservations` (Level 4)

**Scenario directory**: `tests/agent-harness/scenarios/node-hotel-reservations/`

A hotel booking system that calculates room costs with seasonal pricing, group discounts, loyalty tiers, taxes, and resort fees. Three bugs scattered across the pricing pipeline — two require runtime inspection to find.

#### Files (10 source + 2 test, ~1200 lines)

| File | Purpose | Lines |
|------|---------|-------|
| `src/config.js` | Hotel config loader — decodes base64 JSON with room types, seasonal rates, tax rates | ~120 |
| `src/rooms.js` | Room catalog, availability checking, room type lookups | ~130 |
| `src/pricing.js` | Rate engine: base rate x seasonal multiplier x length-of-stay adjustments | ~150 |
| `src/discounts.js` | Loyalty tier discounts, group discounts, promo code validation | ~140 |
| `src/taxes.js` | Multi-component tax: state tax, city tax, occupancy tax, resort fee addition | ~110 |
| `src/reservations.js` | Orchestrator: builds full reservation by calling pricing → discounts → taxes | ~160 |
| `src/groups.js` | Group booking logic: room assignment, bulk rate calculation | ~120 |
| `src/utils.js` | Date range helpers, currency formatting, nights calculation | ~80 |
| `src/test-reservations.js` | Visible test | ~40 |
| `hidden/test_validation.js` | Oracle validation | ~100 |

**Total**: ~1150 lines

#### `scenario.json`

```json
{
  "scenario": {
    "name": "node-hotel-reservations",
    "language": "node",
    "description": "Hotel reservation system calculates wrong totals for group bookings with loyalty discounts",
    "timeout_seconds": 480,
    "level": 4
  },
  "setup": {
    "commands": []
  },
  "visible_test": {
    "command": "node --test test-reservations.js"
  },
  "validation": {
    "command": "node --test test_validation.js"
  }
}
```

#### `prompt.md`

```markdown
The hotel reservation system is producing wrong totals. A group booking for 3 deluxe rooms
for 5 nights with a gold-tier loyalty member is showing a total of $NaN instead of the
expected ~$4,200. Even individual deluxe room bookings seem to have wrong totals — a
single 3-night stay should be ~$1,020 but shows something completely different.

Start with `reservations.js` which orchestrates the pricing pipeline, and trace through
`pricing.js`, `discounts.js`, `groups.js`, and `taxes.js`. The room configuration is
loaded in `config.js`. Run `node --test test-reservations.js` to see the failures.
```

#### Bug 1: String `resortFee` from encoded config causes concatenation (runtime-only)

**Location**: `config.js` (encoded data) → `taxes.js` (where it manifests)

The base64-encoded hotel config JSON contains room type definitions. Most numeric values are proper numbers, but the deluxe room type has `resortFee: "45"` (a string) instead of `resortFee: 45` (a number). This is a realistic data entry error in a JSON config.

The `taxes.js` module computes the total with resort fee:

```javascript
function addResortFee(subtotal, roomConfig) {
    const total = subtotal + roomConfig.resortFee;
    return total;
}
```

When `subtotal` is `295` (number) and `resortFee` is `"45"` (string): `295 + "45"` = `"29545"` (string concatenation). This cascading string value causes `NaN` when later used in tax multiplication (`"29545" * 0.08875` = NaN in tax calc... actually this coerces to a number. Let me reconsider).

**Revised mechanism**: The resort fee is added per-night BEFORE multiplication:

```javascript
function calculateNightlyTotal(baseRate, resortFee) {
    return baseRate + resortFee; // "250" + 45 or 250 + "45" — string concat
}

function calculateStayTotal(nightlyTotal, nights) {
    return nightlyTotal * nights; // NaN if nightlyTotal is "29545" — wait, "29545" * 3 = 88635
}
```

JS coerces strings to numbers in multiplication, so `"29545" * 3` = 88635, not NaN. The bug's EFFECT is a wildly wrong total ($88,635 instead of $1,020 for a 3-night stay), not NaN.

**Corrected bug mechanism**: The config has `resortFee: "45"`. The nightly rate calculation:
```javascript
const nightlyTotal = baseRate + resortFee; // 250 + "45" = "25045" (string concat)
const stayTotal = nightlyTotal * nights;   // "25045" * 3 = 75135 (coerced to number)
```

The stay total is 75,135 instead of 885 (= (250+45) * 3). The visible test shows a wildly wrong total. The agent needs to inspect the `resortFee` value at runtime to see it's a string, since the source code just shows `config.roomTypes[type].resortFee` which looks correct.

**Why runtime-only**: The encoded config is a base64 string in the source. The agent would need to either decode it manually or set a breakpoint to inspect the parsed object and see that `typeof resortFee === 'string'`. The source code for `addResortFee` looks perfectly correct — `subtotal + fee` is standard addition.

#### Bug 2: Group discount overwritten by loyalty discount (cross-module interaction)

**Location**: `groups.js` → `reservations.js` → `discounts.js`

When processing a group booking, `groups.js` calculates a per-room group discount and sets it on the reservation object:

```javascript
// groups.js
function applyGroupDiscount(reservation, roomCount) {
    const discount = getGroupTier(roomCount); // e.g., 0.15 for 3+ rooms
    reservation.perRoomRate = reservation.baseRate * (1 - discount);
    reservation.groupDiscount = discount;
    return reservation;
}
```

Then `reservations.js` calls `discounts.applyLoyalty()`:

```javascript
// reservations.js
function buildReservation(params) {
    const reservation = createBaseReservation(params);
    if (params.roomCount > 1) {
        applyGroupDiscount(reservation, params.roomCount);
    }
    applyLoyalty(reservation, params.loyaltyTier);
    // ...
}
```

The loyalty module reads `reservation.baseRate` instead of `reservation.perRoomRate`:

```javascript
// discounts.js
function applyLoyalty(reservation, tier) {
    const discount = getLoyaltyDiscount(tier); // e.g., 0.10 for gold
    reservation.finalRate = reservation.baseRate * (1 - discount);
    // Should read reservation.perRoomRate (group-discounted) not reservation.baseRate
}
```

The loyalty discount OVERWRITES the effective rate, applying only to the original base rate. The group discount is silently lost. Neither function is wrong in isolation — the bug is in the data contract between modules.

**Why runtime inspection helps**: You need to set breakpoints in `applyGroupDiscount` and `applyLoyalty` to see that `perRoomRate` is correctly set to 212.50 (after 15% group discount on 250), but then `applyLoyalty` ignores it and sets `finalRate` to 225 (10% off 250 base). Inspecting `reservation` between the two calls reveals the issue.

#### Bug 3: Tax calculated on pre-discount subtotal (shared mutable object)

**Location**: `pricing.js` → `discounts.js` → `taxes.js`

The reservation object flows through a pipeline where each stage mutates it:

```javascript
// pricing.js
function calculatePricing(reservation) {
    reservation.subtotal = reservation.finalRate * reservation.nights;
    return reservation;
}

// discounts.js (after loyalty is applied)
function finalizeDiscounts(reservation) {
    reservation.discountedSubtotal = reservation.subtotal * (1 - reservation.promoDiscount);
    return reservation;
}

// taxes.js
function calculateTaxes(reservation) {
    const taxBase = reservation.subtotal; // BUG: should be reservation.discountedSubtotal
    reservation.tax = Math.round(taxBase * reservation.taxRate * 100) / 100;
    reservation.total = reservation.discountedSubtotal + reservation.tax;
    return reservation;
}
```

The tax module reads `reservation.subtotal` (the pre-promo-discount amount) instead of `reservation.discountedSubtotal`. Both properties exist on the object with different values. The tax is calculated on the higher amount, overcharging.

**Why runtime inspection helps**: Both `subtotal` and `discountedSubtotal` exist on the reservation object. You need to inspect the object's state between pipeline stages to see that `taxes.js` reads the wrong property. Reading any single file looks correct — the property names are plausible.

#### Misdirection Techniques

1. **`// FIXME: check seasonal rate boundaries for edge-of-month dates`** — comment placed near the CORRECT seasonal rate lookup in `pricing.js`. The seasonal logic handles month boundaries properly.

2. **Complex cancellation policy** — `utils.js` has a `calculateCancellationFee` function with branching logic for different cancellation windows. It looks suspicious (nested ternaries, magic numbers) but is correct and unused by the test path.

3. **Suspicious promo code validator** — `discounts.js` has a `validatePromoCode` function with a complex regex that appears to have ReDoS potential. The regex is fine and not related to the bugs.

4. **Numeric sort red herring** — `rooms.js` has a `sortByPrice` function that correctly uses `(a, b) => a.price - b.price`. An agent might expect a sort bug (common Node.js footgun) but the sort is correct.

#### Visible Test

```javascript
// test-reservations.js — 4 tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test 1: Single deluxe room, 3 nights (catches Bug 1 — string concat makes total ~75,000)
// Expected: ~$1,020, actual: wildly wrong

// Test 2: Group booking, 3 deluxe rooms, 5 nights, gold loyalty
// Expected: ~$4,200, actual: wrong (Bugs 1+2+3 compound)

// Test 3: Standard room, 2 nights, no discounts (control — may pass if standard room has no string bug)
// Expected: ~$380

// Test 4: Group booking room count
// Expected: 3 rooms assigned
```

Tests 1 and 2 fail visibly. Test 3 may pass (if the string bug only affects deluxe rooms). Test 4 passes.

#### Hidden Validation

```javascript
// test_validation.js — 12+ assertions

// Bug 1 isolation:
// - Assert typeof config.roomTypes.deluxe.resortFee === 'number' after fix
// - Assert single deluxe nightly total is 295 (250 + 45), not "25045"
// - Assert 3-night deluxe stay total is 885

// Bug 2 isolation:
// - Assert group discount applied: perRoomRate for 3-room group is 212.50
// - Assert loyalty discount stacks: finalRate for gold + group is 191.25 (not 225)
// - Assert group booking of 3 rooms × 5 nights uses stacked rate

// Bug 3 isolation:
// - Assert tax is calculated on discountedSubtotal, not subtotal
// - Assert 10% promo discount reduces tax base
// - Assert total = discountedSubtotal + tax (not subtotal + tax)

// Integration:
// - Full group booking total with all discounts and correct tax
// - Standard room booking (control case) total is correct
// - Single deluxe booking without group/loyalty
```

---

### Unit 2: `node-ecommerce-checkout` (Level 5)

**Scenario directory**: `tests/agent-harness/scenarios/node-ecommerce-checkout/`

An e-commerce checkout pipeline — cart management, dynamic pricing with volume tiers, promotional campaigns, inventory management, shipping, and order finalization. Four bugs, two runtime-only, one async race, and one Node.js prototype footgun.

#### Files (13 source + 2 test, ~2000 lines)

| File | Purpose | Lines |
|------|---------|-------|
| `src/config.js` | Store config from base64 — fee tables, volume tiers, shipping zones | ~120 |
| `src/catalog.js` | Product catalog with base pricing, categories, metadata | ~150 |
| `src/cart.js` | Shopping cart: add/remove/update, quantity management, subtotal | ~150 |
| `src/pricing.js` | Dynamic pricing engine: volume tiers, time-limited sales | ~180 |
| `src/promotions.js` | Campaign engine: coupon codes, bundle deals, BOGO, loyalty points | ~200 |
| `src/shipping.js` | Shipping rate calculation by weight and destination zone | ~150 |
| `src/tax.js` | Multi-jurisdiction tax calculation | ~140 |
| `src/inventory.js` | Stock management: checking, reservation, async batch updates | ~150 |
| `src/payment.js` | Payment processing simulation with validation | ~120 |
| `src/orders.js` | Order creation, line item assembly, total computation | ~150 |
| `src/receipts.js` | Receipt generation, line item formatting, summary | ~130 |
| `src/utils.js` | Currency formatting, validation helpers, Array.prototype.sum extension | ~100 |
| `src/test-checkout.js` | Visible test | ~50 |
| `hidden/test_validation.js` | Oracle validation | ~150 |

**Total**: ~1940 lines

#### `scenario.json`

```json
{
  "scenario": {
    "name": "node-ecommerce-checkout",
    "language": "node",
    "description": "E-commerce checkout produces wrong order totals with incorrect volume discounts and missing inventory",
    "timeout_seconds": 600,
    "level": 5
  },
  "setup": {
    "commands": []
  },
  "visible_test": {
    "command": "node --test test-checkout.js"
  },
  "validation": {
    "command": "node --test test_validation.js"
  }
}
```

#### `prompt.md`

```markdown
The e-commerce checkout system is producing wrong order totals. A customer buying 30 units
of a product should get a volume discount but the order total is too high. Additionally,
a checkout with a bundle deal and a coupon code seems to apply the coupon when it shouldn't
qualify. The inventory system also seems unreliable — sometimes stock counts don't match
after processing orders.

The main flow starts in `orders.js` which coordinates `cart.js`, `pricing.js`,
`promotions.js`, `inventory.js`, and `shipping.js`. Configuration is loaded in `config.js`.
Several things seem wrong. Run `node --test test-checkout.js` to see the failures.
```

#### Bug 1: Volume tier lexicographic sort (runtime-only)

**Location**: `config.js` (data) → `pricing.js` (logic)

Volume discount tiers are loaded from base64 config. The tier thresholds are stored as strings in the JSON: `"5"`, `"10"`, `"25"`, `"50"`, `"100"`. The config loader sorts tiers for lookup:

```javascript
// config.js
function loadConfig() {
    const raw = JSON.parse(Buffer.from(ENCODED_CONFIG, 'base64').toString());
    raw.volumeTiers.sort((a, b) => a.threshold > b.threshold ? 1 : -1);
    return raw;
}
```

This sorts strings lexicographically: `["10", "100", "25", "5", "50"]`. The pricing module iterates to find the highest qualifying tier:

```javascript
// pricing.js
function getVolumeTier(quantity, tiers) {
    let applicableTier = tiers[0]; // default tier
    for (const tier of tiers) {
        if (quantity >= Number(tier.threshold)) {
            applicableTier = tier;
        }
    }
    return applicableTier;
}
```

For quantity 30: iterates `["10", "100", "25", "5", "50"]` as numbers [10, 100, 25, 5, 50]. Matches 10 (yes), 100 (no), 25 (yes), 5 (yes), 50 (no). Last match is threshold 5, which has the **smallest** discount. Should match threshold 25 (the largest qualifying tier). The `sort` produces `[10, 100, 25, 5, 50]` — the iteration takes the last match, so it gets tier 5 instead of tier 25.

**Why runtime-only**: The sort comparator `a.threshold > b.threshold` looks correct if thresholds are numbers. You need to inspect the actual sorted array at runtime to see the lexicographic ordering: `["10", "100", "25", "5", "50"]`. The source code for `getVolumeTier` looks correct — it's the input data order that's wrong.

#### Bug 2: Coupon validates against pre-bundle subtotal (cross-module, silent wrong)

**Location**: `cart.js` → `promotions.js`

The promotion engine processes discounts in order: bundles first, then coupons. A bundle deal "buy 3 widgets, get 10% off" reduces the cart subtotal. Then a coupon with a minimum spend requirement is checked:

```javascript
// promotions.js
function applyCoupon(cart, couponCode) {
    const coupon = lookupCoupon(couponCode);
    if (!coupon) return cart;

    // BUG: checks cart.subtotal (original) instead of cart.currentTotal (post-bundle)
    if (cart.subtotal < coupon.minimumSpend) {
        return cart; // doesn't qualify
    }
    cart.currentTotal -= coupon.discount;
    cart.appliedCoupons.push(coupon);
    return cart;
}
```

The cart object has `subtotal` (original, set by `cart.js`) and `currentTotal` (updated by bundle processing). The coupon checks `cart.subtotal` ($52) instead of `cart.currentTotal` ($46.80 after bundle). A coupon with $50 minimum spend applies when it shouldn't (post-bundle total is below threshold). This is a cross-module data staleness issue.

**Why runtime inspection helps**: Both properties exist on the cart object. You need to inspect the cart state after bundle processing to see `subtotal: 52.00` vs `currentTotal: 46.80` and realize the coupon check reads the wrong one.

#### Bug 3: Async inventory reservation race (concurrency)

**Location**: `inventory.js`

The inventory module reserves stock for checkout items using `Promise.all`:

```javascript
// inventory.js
let reservedTotal = 0;

async function reserveItems(items) {
    await Promise.all(items.map(async (item) => {
        const current = reservedTotal;
        await checkWarehouse(item.sku);  // async operation
        reservedTotal = current + item.quantity;
    }));
    return reservedTotal;
}
```

Classic async race: all promises read `reservedTotal = 0` before any writes. Each sets `reservedTotal = 0 + item.quantity`. The final value is the LAST promise's quantity, not the sum. For a cart with 3 items of quantities [5, 3, 2], `reservedTotal` ends up as 2 (the last item) instead of 10.

**Why runtime inspection helps**: The code looks correct when read linearly — `current` captures the value, await pauses, then sets it. You need to step through the concurrent execution to see all promises read 0 for `current` before any write completes.

#### Bug 4: `for...in` on array with prototype pollution (Node.js footgun)

**Location**: `utils.js` (pollution source) → `orders.js` (manifestation)

The utils module adds a convenience method to Array:

```javascript
// utils.js
Array.prototype.sum = function() {
    return this.reduce((acc, val) => acc + val, 0);
};
```

The orders module iterates line items with `for...in`:

```javascript
// orders.js
function computeOrderTotal(lineItems) {
    let total = 0;
    for (const idx in lineItems) {
        const item = lineItems[idx];
        total += item.quantity * item.unitPrice;
    }
    return total;
}
```

`for...in` on an array iterates: "0", "1", "2", ..., AND "sum" (the prototype method). When `idx = "sum"`, `lineItems["sum"]` returns the function. `func.quantity` is `undefined`, so `undefined * undefined` = `NaN`, and `total += NaN` makes the total `NaN` for the rest of the calculation.

**Why runtime inspection helps**: The `for...in` loop looks correct for iterating array indexes. The prototype pollution is in a completely different file (`utils.js`). The NaN appears in `orders.js` but the root cause is in `utils.js`. You need to step through the loop and inspect `idx` values to see "sum" appearing as a key, then trace it back to the prototype extension.

#### Misdirection Techniques

1. **`// TODO: handle timezone edge cases for flash sales`** — near correct UTC comparison logic in `promotions.js`. The timezone handling is fine.

2. **Complex coupon hash validation** — `promotions.js` has a `validateCouponHash` function with SHA-256 verification. Looks complex and suspicious but works correctly.

3. **`sortCartItems()` with proper numeric comparator** — `cart.js` has a sort function that correctly uses `(a, b) => a.price - b.price`. Agent might expect a sort bug here (red herring) since the real sort bug is in the config loader.

4. **Unused `calculateRefund` function** — `payment.js` has a refund calculator with suspicious-looking rounding. It's correct but unused.

5. **Non-obvious test failures**: The visible test shows "order total does not match expected" without indicating which component is wrong. The NaN from Bug 4 manifests as "expected 156.80, got NaN" which could point anywhere.

#### Visible Test

```javascript
// test-checkout.js — 5 tests

// Test 1: Standard checkout with volume pricing (30 units)
// Expected: volume discount at tier 25 applied, total ~$XX
// Fails due to Bug 1 (wrong tier) and Bug 4 (NaN from for...in)

// Test 2: Checkout with bundle + coupon
// Expected: coupon rejected (below minimum after bundle)
// Fails due to Bug 2 (coupon applied incorrectly)

// Test 3: Inventory reservation count after checkout
// Expected: 10 total reserved (5 + 3 + 2)
// Fails due to Bug 3 (race: only last item's quantity)

// Test 4: Simple single-item checkout (control)
// May pass (no volume tier, no bundle, single reservation, no for...in issue if only 1 item)

// Test 5: Receipt line item count matches cart
// May pass or fail depending on Bug 4 manifestation
```

#### Hidden Validation

```javascript
// test_validation.js — 15+ assertions

// Bug 1 (volume tiers):
// - Assert tiers are sorted numerically: [5, 10, 25, 50, 100]
// - Assert quantity 30 gets tier 25 discount
// - Assert quantity 7 gets tier 5 discount
// - Assert quantity 150 gets tier 100 discount

// Bug 2 (coupon stacking):
// - Assert coupon with $50 min rejected when post-bundle total is $46.80
// - Assert coupon with $40 min accepted when post-bundle total is $46.80
// - Assert bundle discount applied correctly: $52 → $46.80

// Bug 3 (inventory race):
// - Assert reserveItems([{qty: 5}, {qty: 3}, {qty: 2}]) returns 10
// - Assert stock levels decremented by total quantity
// - Assert concurrent reservations don't lose updates

// Bug 4 (for...in prototype):
// - Assert order total is a finite number (not NaN)
// - Assert order total matches sum of (quantity * unitPrice) for all items
// - Assert no prototype keys appear in line item iteration

// Integration:
// - Full checkout flow with volume pricing + promotion + inventory
// - Receipt total matches order total
// - Inventory after checkout reflects all reserved items
```

---

### Unit 3: `node-event-ticketing` (Level 6)

**Scenario directory**: `tests/agent-harness/scenarios/node-event-ticketing/`

A concert/event ticketing platform with venue management, seat selection, dynamic surge pricing, early-bird discounts, service fees, waitlist management, and order processing. Five bugs across different concern areas, with a ghost bug, deep data flow, and active misdirection. This is the hardest Node.js scenario.

#### Files (20 source + 2 test, ~3200 lines)

| File | Purpose | Lines |
|------|---------|-------|
| `src/config.js` | Platform config from encoded data — pricing params, fee tables | ~120 |
| `src/events.js` | Event catalog, scheduling, metadata | ~140 |
| `src/venues.js` | Venue layout, section types, seating maps | ~160 |
| `src/seats.js` | Seat management: availability, filtering, assignment | ~170 |
| `src/pricing.js` | Dynamic pricing: base price + surge + early-bird + group | ~180 |
| `src/surge.js` | Surge pricing calculator: demand curves, multipliers | ~140 |
| `src/discounts.js` | Discount engine: early-bird, group rates, promo codes | ~160 |
| `src/cart.js` | Ticket cart management, seat selection | ~130 |
| `src/checkout.js` | Checkout orchestrator: pricing → fees → discounts → payment | ~180 |
| `src/inventory.js` | Seat inventory: locking, releasing, concurrent access | ~150 |
| `src/waitlist.js` | Waitlist queue: priority, notification, auto-assignment | ~130 |
| `src/payment.js` | Payment processing simulation | ~130 |
| `src/orders.js` | Order finalization, confirmation | ~140 |
| `src/notifications.js` | Email/SMS dispatch, template rendering | ~120 |
| `src/fees.js` | Service fees: per-ticket, percentage-based, processing | ~130 |
| `src/analytics.js` | Sales analytics, revenue reporting | ~130 |
| `src/validators.js` | Input validation, schema checks | ~110 |
| `src/formatters.js` | Display formatting: currency, dates, seat labels | ~100 |
| `src/utils.js` | Date math, crypto helpers, general utilities | ~100 |
| `src/test-ticketing.js` | Visible test | ~60 |
| `hidden/test_validation.js` | Oracle validation | ~200 |

**Total**: ~3160 lines

#### `scenario.json`

```json
{
  "scenario": {
    "name": "node-event-ticketing",
    "language": "node",
    "description": "Event ticketing platform produces wrong prices, missing VIP seats, and incorrect order totals",
    "timeout_seconds": 900,
    "level": 6
  },
  "setup": {
    "commands": []
  },
  "visible_test": {
    "command": "node --test test-ticketing.js"
  },
  "validation": {
    "command": "node --test test_validation.js"
  }
}
```

#### `prompt.md`

```markdown
The event ticketing platform has multiple issues. VIP ticket purchases show $NaN for the
total. Regular ticket orders seem slightly wrong on the service fee. Early-bird discount
purchases show almost no discount applied. A customer reported that VIP seats show as
unavailable even though the venue map says they should exist.

The checkout flow starts in `checkout.js` and coordinates `pricing.js`, `fees.js`,
`discounts.js`, `seats.js`, and `orders.js`. Venue data is in `venues.js` and seat
management in `seats.js`. Platform configuration is loaded in `config.js`. Multiple
things seem wrong — there are likely several bugs across different parts of the system.
Run `node --test test-ticketing.js` to see the failures.
```

#### Bug 1: Shallow config merge drops nested defaults (runtime-only)

**Location**: `config.js`

Platform config is assembled from defaults and event-specific overrides. The merge uses `Object.assign`:

```javascript
// config.js
const DEFAULTS = {
    pricing: {
        baseFee: 5.00,
        surgeCap: 2.0,
        tiers: [1.0, 1.2, 1.5, 2.0],
        earlyBirdWindow: 30 // days
    },
    fees: {
        servicePercent: 0.12,
        processingFlat: 2.50
    },
    venue: {
        maxCapacity: 10000
    }
};

function loadConfig(eventId) {
    const eventOverrides = JSON.parse(
        Buffer.from(EVENT_CONFIGS[eventId], 'base64').toString()
    );
    return Object.assign({}, DEFAULTS, eventOverrides);
}
```

The event-specific config (base64-encoded) contains:

```json
{
    "pricing": { "surgeCap": 3.0 },
    "eventName": "Summer Concert 2024"
}
```

`Object.assign` does a **shallow** merge. The event's `pricing: { surgeCap: 3.0 }` completely replaces the default `pricing` object. After merge, `config.pricing.baseFee` is `undefined`, `config.pricing.tiers` is `undefined`. When surge pricing reads `config.pricing.baseFee`, it gets `undefined`. `undefined + ticketPrice` = `NaN`.

**Why runtime-only**: The default config in source has all the right values. The event override config is in base64 — you can't see it has a nested `pricing` key without decoding. The `Object.assign` call looks standard and correct. You need to inspect the merged config at runtime to see that `pricing.baseFee` is `undefined`.

#### Bug 2: Ghost bug — lazy getter on SeatInventory (timing-dependent)

**Location**: `seats.js`

The `SeatInventory` class has a lazy initialization pattern:

```javascript
// seats.js
class SeatInventory {
    constructor(allSeats) {
        this._allSeats = allSeats;
        this._filtered = null;
    }

    get availableSeats() {
        if (this._filtered === null) {
            this._filtered = this._allSeats.filter(s => s.status === 'available');
        }
        return this._filtered;
    }

    getSeats(section) {
        // Returns seats for a section, but only works correctly
        // if availableSeats getter has been triggered first
        const seats = this._filtered || this._allSeats;
        return seats.filter(s => s.section === section);
    }
}
```

The `getSeats()` method uses `this._filtered` if it exists, or falls back to `this._allSeats`. If `availableSeats` has never been accessed, `this._filtered` is `null` (falsy), so `getSeats()` returns from `this._allSeats` — which includes ALL seats (sold, held, available). Downstream code doesn't re-check status, so it tries to assign already-sold seats.

**Ghost behavior**: When debugging, if the agent adds `console.log(inventory.availableSeats)` or inspects `inventory.availableSeats` in a watch expression, the getter triggers the filter, populating `this._filtered`. From that point on, `getSeats()` works correctly. The bug literally disappears when you observe it. This is the defining characteristic of a ghost bug.

**Why this is hard**: The symptom is "seats show as unavailable" (because sold seats are assigned, then the subsequent lock check fails). Adding any logging that accesses `availableSeats` fixes the behavior. The agent must identify that `getSeats()` depends on the lazy getter having been called, WITHOUT triggering it during inspection. They need to read the code carefully or inspect `this._filtered` directly (not via the getter).

#### Bug 3: Early-bird discount returns decimal, checkout expects percentage (cross-module)

**Location**: `discounts.js` → `checkout.js`

The discount engine has different discount sources with inconsistent return formats:

```javascript
// discounts.js
function calculateEarlyBird(daysUntilEvent) {
    if (daysUntilEvent >= 30) return 0.20; // 20% as decimal
    if (daysUntilEvent >= 14) return 0.10; // 10% as decimal
    return 0;
}

function calculateGroupDiscount(groupSize) {
    if (groupSize >= 10) return 15; // 15% as integer
    if (groupSize >= 5) return 10;  // 10% as integer
    return 0;
}
```

The checkout module applies discounts uniformly:

```javascript
// checkout.js
function applyDiscount(price, discountValue) {
    return price * (1 - discountValue / 100);
}
```

This works for group discounts: `price * (1 - 15/100)` = `price * 0.85`. But for early-bird: `price * (1 - 0.20/100)` = `price * 0.998` — a 0.2% discount instead of 20%. The early-bird discount is effectively neutralized.

**Why runtime-only**: Both functions return numbers and the `applyDiscount` function looks correct. You need to inspect the actual `discountValue` at runtime to see it's `0.20` (not `20`). The naming convention doesn't distinguish between decimal and percentage representations.

#### Bug 4: Service fee reads `item.price` not `item.adjustedPrice` (deep data flow)

**Location**: `pricing.js` → `surge.js` → `fees.js` → `checkout.js` (4 calls, 3+ files)

The pricing pipeline applies surge pricing, which sets `adjustedPrice` on ticket items:

```javascript
// pricing.js → calls surge.js
function applyDynamicPricing(items, eventConfig) {
    return items.map(item => ({
        ...item,
        adjustedPrice: item.price * getSurgeMultiplier(eventConfig),
        originalPrice: item.price
    }));
}
```

The fees module calculates percentage-based service fees:

```javascript
// fees.js
function calculateServiceFee(item, feeConfig) {
    const fee = item.price * feeConfig.servicePercent; // BUG: reads .price (original)
    // Should read item.adjustedPrice (surge-adjusted)
    return Math.round(fee * 100) / 100;
}
```

The service fee is based on `item.price` (original, $50) instead of `item.adjustedPrice` (surge-adjusted, $75). For a 1.5x surge event, the service fee is 33% too low. The data flows through 4 function calls across 3 files before the incorrect fee appears in the order total.

**Why runtime inspection**: The item object has both `price` and `adjustedPrice` after the pricing pipeline. The fees module reads `price` which looks natural — without knowing about the surge pipeline upstream, `item.price` seems like the correct property. You need to inspect the item object at the point where fees are calculated to see both properties exist with different values.

#### Bug 5: `Array.flat()` default depth on VIP nested sections (edge case)

**Location**: `venues.js` → `seats.js`

The venue module organizes seats in a hierarchy. Regular sections have: `section → rows → seats` (2 levels). VIP sections have an extra nesting: `section → zones → rows → seats` (3 levels).

```javascript
// venues.js
function getAllSeats(venue) {
    return venue.sections
        .map(section => section.rows
            ? section.rows.map(row => row.seats)
            : section.zones.map(zone => zone.rows.map(row => row.seats))
        )
        .flat();
}
```

For regular sections, `.map()` returns `[[seat1, seat2], [seat3, seat4]]` (2D). For VIP sections, `.map()` returns `[[[seat1, seat2], [seat3, seat4]]]` (3D). `.flat()` with no argument defaults to depth 1.

- Regular: `[[s1, s2], [s3, s4]]` → `.flat()` → `[s1, s2, s3, s4]` (correct)
- VIP: `[[[s1, s2], [s3, s4]]]` → `.flat()` → `[[s1, s2], [s3, s4]]` (still nested!)

The VIP seats remain as arrays. When `seats.js` filters: `.filter(s => s.status === 'available')`, an array's `.status` is `undefined` (falsy), so VIP seats are all filtered out. Result: 0 available VIP seats.

**Why this is hard**: Regular ticket flows work perfectly. The bug only triggers for VIP section queries. The `.flat()` call looks harmless. The symptom is "no VIP seats available" which could be misinterpreted as a data issue, an inventory issue, or a configuration issue. The agent must trace through the venue data structure to see the nesting difference.

#### Misdirection Techniques

1. **`// BUG? this might need timezone adjustment`** — comment near CORRECT UTC date comparison in `utils.js`. The date handling is fine.

2. **Complex seat assignment algorithm** — `seats.js` has a `findOptimalSeatGroup` function with a complex scoring algorithm (distance from stage, group contiguity). Looks like it could have off-by-one errors but is correct.

3. **Unused `refundCalculator`** — `payment.js` has a refund calculation function with suspicious rounding logic. It's correct but never called in the test path.

4. **`validators.js` with aggressive checks** — Input validation module with many edge cases (negative prices, zero quantities, invalid dates). All validation is correct. Agent might spend time reviewing it.

5. **`formatCurrency` edge cases** — `formatters.js` handles negative amounts, zero, large numbers, and different locales. Looks over-engineered but is correct.

6. **`analytics.js` with batch processing** — The analytics module aggregates sales data with a complex reduce operation. Looks like it could have accumulation issues but works correctly. Not in the critical test path.

7. **Comments that subtly mislead**:
   - `// surge multiplier applied to base price` in `pricing.js` (correct but might suggest the fee should use base price too — reinforcing Bug 4's incorrect pattern)
   - `// flat() handles nested venue structure` in `venues.js` (wrong — doesn't handle VIP depth)
   - `// discount values are percentages (0-100)` in `checkout.js` (wrong for early-bird which is decimal)

#### Visible Test

```javascript
// test-ticketing.js — 6 tests

// Test 1: Purchase 2 regular tickets for a surge event
// Expected: correct surge-adjusted price with fees
// Fails: wrong service fee (Bug 4), possibly NaN config (Bug 1)

// Test 2: VIP ticket availability
// Expected: VIP seats available
// Fails: 0 VIP seats returned (Bug 5)

// Test 3: Early-bird discount on advance purchase
// Expected: 20% discount applied
// Might show small unexpected discount (Bug 3: 0.2% instead of 20%)

// Test 4: Regular ticket simple purchase (partial control)
// May pass if config has a fallback for missing baseFee

// Test 5: Order total for group booking
// Expected: group discount applied correctly
// Passes (group discount format is percentage, works with applyDiscount)

// Test 6: Total ticket count in order
// Passes (counting logic is correct)
```

Only 2-3 tests fail visibly, exposing symptoms of Bug 1 (NaN), Bug 4 (wrong fee), and Bug 5 (no VIP seats). Bugs 2 (ghost) and 3 (near-zero early-bird discount) are harder to notice from visible test failures alone.

#### Hidden Validation

```javascript
// test_validation.js — 18+ assertions

// Bug 1 (config merge):
// - Assert config.pricing.baseFee is a number (not undefined)
// - Assert config.pricing.tiers is an array with 4 elements
// - Assert surge calculation doesn't produce NaN
// - Assert merged config retains both default and override values

// Bug 2 (ghost/lazy getter):
// - Assert SeatInventory.getSeats("A") returns only available seats
//   WITHOUT first accessing .availableSeats
// - Assert getSeats doesn't return sold/held seats
// - Assert seat count matches venue available count

// Bug 3 (early-bird format):
// - Assert early-bird discount of 0.20 applied as 20%, not 0.2%
// - Assert $100 ticket with early-bird = $80 (not $99.80)
// - Assert 14-day early-bird gives 10% ($90)

// Bug 4 (fee on adjusted price):
// - Assert service fee calculated on surge-adjusted price
// - Assert $50 ticket with 1.5x surge: fee on $75, not $50
// - Assert fee breakdown shows adjusted price as basis

// Bug 5 (VIP flat depth):
// - Assert VIP seats returned as individual seat objects (not arrays)
// - Assert VIP section has > 0 available seats
// - Assert VIP seats have valid .id and .status properties
// - Assert total available = regular available + VIP available

// Integration:
// - Full order with surge + early-bird + service fee = correct total
// - VIP ticket purchase end-to-end
// - Mixed regular + VIP order
```

---

## Implementation Order

1. **Unit 1: `node-hotel-reservations` (L4)** — Smallest scope, establishes patterns for multi-bug scenarios with encoded config and pipeline mutations. Builds on existing L3 `node-expense-tracker` patterns.

2. **Unit 2: `node-ecommerce-checkout` (L5)** — Adds async race conditions and prototype pollution bugs. More files and more misdirection.

3. **Unit 3: `node-event-ticketing` (L6)** — Largest scope, introduces ghost bug and deep data flow. Requires all prior patterns plus adversarial misdirection.

Each scenario is independent and can be implemented in parallel, but the conceptual progression helps ensure consistent difficulty scaling.

## Implementation Notes

### Encoded Config Pattern

All three scenarios use base64-encoded JSON for configuration. The implementer should:

1. Create realistic config objects with many correct fields and a few buggy ones
2. Encode with `Buffer.from(JSON.stringify(config)).toString('base64')`
3. Place the encoded string as a constant in `config.js`
4. Add a decoder function that `JSON.parse(Buffer.from(encoded, 'base64').toString())`
5. The buggy values must not be visible in any comments or constants in the source code

### Test Pattern (Node.js)

All tests use Node.js built-in test runner (`node:test` + `node:assert/strict`):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Scenario Name', () => {
    it('test description', () => {
        const result = functionUnderTest(args);
        assert.strictEqual(result.value, expected);
    });
});
```

Hidden validation tests should be structured with `describe` blocks per bug to make failure output clear for scoring.

### Misdirection Implementation

- `// FIXME:` and `// TODO:` comments should be placed 2-5 lines from correct code, never adjacent to actual bugs
- Red herring functions should have realistic complexity (10-20 lines) with non-trivial logic
- At least one red herring should be imported and available but not called in the test path
- Comments near bugs should be technically accurate but subtly misleading (e.g., "// discount values are percentages" when one source returns decimals)

### Module Pattern

All modules should use ES module syntax (`import`/`export`) for consistency with existing scenarios. Each file should `export` specific functions (not default exports) so the test files can import selectively.

## Testing Strategy

### Per-Scenario Verification

For each scenario, verify:

1. **Visible test fails before fix**: `node --test test-*.js` should exit non-zero
2. **All bugs are present**: Each bug should independently cause at least one hidden assertion to fail
3. **Fixing only N-1 bugs still fails hidden validation**: Ensures all bugs are independently tested
4. **Fixing all N bugs passes both visible and hidden tests**
5. **No false failures**: Correct code surrounding bugs should not be flagged by tests

### Cross-Level Verification

Run the harness with a baseline agent to verify:
- L4 might be solvable by reading alone (but slowly) — the encoded config bug is the hardest
- L5 should be very difficult without runtime (async race, prototype pollution are hard to find by reading)
- L6 should be near-impossible without runtime (ghost bug actively resists code-reading debugging)

### Manual Verification Checklist

```bash
# For each scenario:
cd tests/agent-harness/scenarios/<scenario-name>/src

# 1. Verify visible test fails
node --test test-*.js          # Should fail

# 2. Apply all fixes manually
# ... edit files ...

# 3. Verify visible test passes
node --test test-*.js          # Should pass

# 4. Copy hidden test and verify
cp ../hidden/test_validation.js .
node --test test_validation.js  # Should pass

# 5. Revert fixes one at a time, verify hidden test catches each bug independently
```

## Verification Checklist

- [ ] Each scenario has: `scenario.json`, `prompt.md`, `src/` directory, `hidden/` directory
- [ ] `scenario.json` validates against `ScenarioConfigSchema` (Zod)
- [ ] All source files use ES module syntax
- [ ] Visible test uses `node:test` and `node:assert/strict`
- [ ] Hidden test has per-bug assertion groups
- [ ] Base64 config is valid and decodable
- [ ] Each bug is independently testable
- [ ] Misdirection elements are present and realistic
- [ ] Line counts are within level guidelines
- [ ] File counts are within level guidelines
- [ ] Timeout values match level guidelines
