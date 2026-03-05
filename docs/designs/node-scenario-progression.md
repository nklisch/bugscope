# Node.js Scenario Progression Design

Escalating debugging scenarios for the Node.js runtime. Follows the cross-language strategy from [scenario-guidelines.md](scenario-guidelines.md): 5 shared-concept scenarios (one per level, parallel to Python) + 5 language-specific scenarios exploiting Node/JS footguns.

The existing `node-async-race` (Level 3) is reclassified as a language-specific scenario. That gives us 9 new scenarios to implement.

All scenarios use **plain `.js`** with ES modules (`import`/`export`). No TypeScript, no build step. Tests use Node's built-in test runner (`node --test`).

---

## Shared-Concept Scenarios

These have the same bug pattern as their Python counterpart, written idiomatically in JS.

### 1. `node-wrong-constant` (Level 1) — Shared

**Python parallel:** `python-discount-bug`

**Bug:** A pricing config object maps tier names to discount multipliers. The `"gold"` tier has `1.0` instead of `0.1` — a 100% discount instead of 10%.

```javascript
// pricing.js
const TIER_DISCOUNTS = {
  bronze: 0.05,
  silver: 0.07,
  gold: 1.0,      // BUG: should be 0.1
  platinum: 0.15,
};

export function calculatePrice(basePrice, tier) {
  const discount = TIER_DISCOUNTS[tier] ?? 0;
  return basePrice * (1 - discount);
}

export function generateInvoice(items, customerTier) {
  const lines = items.map(item => ({
    name: item.name,
    basePrice: item.price,
    finalPrice: calculatePrice(item.price, customerTier),
    qty: item.qty,
  }));
  const subtotal = lines.reduce((sum, l) => sum + l.finalPrice * l.qty, 0);
  return { lines, subtotal, tier: customerTier };
}
```

**What it tests:** Can the agent find a wrong constant in a config object and apply a 1-character fix.

---

### 2. `node-shadow-variable` (Level 2) — Shared

**Python parallel:** `python-shadow-variable`

**Bug:** A variable is reused across two loops. The second loop accumulates onto the stale value instead of starting from zero.

```javascript
// orders.js
export function processOrders(orders) {
  // First pass: validate all orders
  let total = 0;
  for (const order of orders) {
    total = order.quantity * order.price;
    if (total < 0) {
      throw new Error(`Negative total for order ${order.id}`);
    }
  }

  // Second pass: accumulate grand total
  // BUG: total still holds last order's individual value, not 0
  for (const order of orders) {
    total += order.quantity * order.price;
  }

  return { grandTotal: total, orderCount: orders.length };
}
```

**What it tests:** Agent must trace variable state across loop boundaries. The variable isn't reset before the accumulation loop.

---

### 3. `node-mutation-before-read` (Level 4) — Shared

**Python parallel:** `python-dict-iteration-mutation`

**Bug:** An object is mutated (prices overwritten with promotional prices) before a summary computation reads from it. The "average original price" is computed after mutation, so it sees the already-discounted values.

```javascript
// promotions.js
export function applyPromotions(catalog, promotions) {
  let updated = 0;
  let totalSavings = 0;

  for (const [sku, promoPrice] of Object.entries(promotions)) {
    if (catalog[sku]) {
      const oldPrice = catalog[sku].price;
      catalog[sku].price = promoPrice;
      catalog[sku].savings = oldPrice - promoPrice;
      totalSavings += oldPrice - promoPrice;
      updated++;
    }
  }

  // BUG: catalog prices already overwritten above — reads mutated values
  const prices = Object.values(catalog).map(item => item.price);
  const avgOriginal = prices.reduce((a, b) => a + b, 0) / prices.length;

  return {
    updated,
    avgOriginalPrice: Math.round(avgOriginal * 100) / 100,
    totalSavings: Math.round(totalSavings * 100) / 100,
  };
}
```

**What it tests:** Same conceptual bug as Python: mutation happens before the read that needs pre-mutation values. Agent must trace the data flow within a single function.

---

### 4. `node-float-accumulation` (Level 5) — Shared

**Python parallel:** `python-float-accumulation`

**Bug:** Floating point accumulation error causes an exact equality check to trigger a "correction" that makes the result wrong after rounding. Identical to Python since JS `Number` is also IEEE 754 double.

```javascript
// bill.js
export function splitBill(total, numPeople, tipPct = 0.18) {
  const tip = total * tipPct;
  const billWithTip = total + tip;
  const perPerson = billWithTip / numPeople;

  // Verify the split adds up
  const shares = Array(numPeople).fill(perPerson);
  const totalShares = shares.reduce((a, b) => a + b, 0);

  if (totalShares !== billWithTip) {  // BUG: exact float comparison
    // "Correction" that adds float residual to last share
    shares[numPeople - 1] += billWithTip - totalShares;
  }

  const round2 = n => Math.round(n * 100) / 100;
  const roundedShares = shares.map(round2);

  return {
    perPerson: round2(perPerson),
    shares: roundedShares,
    totalWithTip: round2(billWithTip),
    totalShares: round2(roundedShares.reduce((a, b) => a + b, 0)),
  };
}
```

**What it tests:** Same float-precision footgun as Python. The correction adds a tiny epsilon before rounding; after rounding, `totalShares !== totalWithTip`.

---

### 5. `node-stale-accumulator` (Level 3) — Shared

**Python parallel:** `python-default-mutable`

**Bug:** A module-level array accumulates state across calls. This is Node's closest equivalent to Python's mutable default argument — module-scoped state that persists between function invocations.

```javascript
// ledger.js

// Module-level state — persists across calls (like Python's mutable default)
const _ledger = [];

export function registerSale(item, price) {
  _ledger.push({ item, price });
  return _ledger;
}

export function dailyReport(salesByDay) {
  const reports = [];
  for (const daySales of salesByDay) {
    // BUG: _ledger is never cleared between days — accumulates across all days
    for (const [item, price] of daySales) {
      registerSale(item, price);
    }
    reports.push({
      count: _ledger.length,
      total: _ledger.reduce((sum, s) => sum + s.price, 0),
    });
  }
  return reports;
}

export function clearLedger() {
  _ledger.length = 0;
}
```

**What it tests:** Module-level mutable state leaks between logical units of work. Day 2's report includes Day 1's sales. Agent must recognize the module-scoped accumulation pattern.

---

## Language-Specific Scenarios

Bugs that exploit JS/Node-specific footguns. These cannot exist in Python.

### 6. `node-splice-vs-slice` (Level 1) — JS-Specific

**Bug:** Code uses `Array.splice()` (mutating) instead of `Array.slice()` (non-mutating) to extract a subarray. The original array is destroyed.

```javascript
// pagination.js
export function paginate(items, page, pageSize) {
  const totalPages = Math.ceil(items.length / pageSize);
  const start = (page - 1) * pageSize;

  // BUG: splice mutates the array, removing elements
  // Should be slice(start, start + pageSize)
  const pageItems = items.splice(start, pageSize);

  return {
    items: pageItems,
    page,
    totalPages,
    totalItems: items.length,  // now wrong — items has been mutated
  };
}

export function paginateAll(items, pageSize) {
  const pages = [];
  const totalPages = Math.ceil(items.length / pageSize);
  for (let i = 1; i <= totalPages; i++) {
    pages.push(paginate(items, i, pageSize));
  }
  return pages;
}
```

**What it tests:** Classic JS footgun — `splice` vs `slice`. The first call works, but subsequent calls on the same array see mutated data. `totalItems` is also wrong because it reads `items.length` after mutation. Agent sees the symptom (wrong totalItems, missing pages) and must trace to the splice call.

---

### 7. `node-this-binding` (Level 2) — JS-Specific

**Bug:** A method is extracted from an object and passed as a callback, losing its `this` binding. The method references `this.multiplier` which becomes `undefined`, causing `NaN` results.

```javascript
// calculator.js
class TaxCalculator {
  constructor(region) {
    this.region = region;
    this.rates = {
      US: { sales: 0.08, luxury: 0.12 },
      EU: { sales: 0.20, luxury: 0.25 },
    };
    this.multiplier = 1.0;
  }

  setMultiplier(m) {
    this.multiplier = m;
  }

  calculateTax(price, category) {
    const regionRates = this.rates[this.region];
    if (!regionRates) return 0;
    const rate = regionRates[category] ?? regionRates.sales;
    return Math.round(price * rate * this.multiplier * 100) / 100;
  }
}

export function computeInvoiceTax(items, region) {
  const calc = new TaxCalculator(region);
  // BUG: extracting method loses `this` binding
  const getTax = calc.calculateTax;

  return items.map(item => ({
    name: item.name,
    price: item.price,
    tax: getTax(item.price, item.category),
    total: item.price + getTax(item.price, item.category),
  }));
}
```

**What it tests:** JS `this` binding is lost when a method is extracted. `this.rates` and `this.multiplier` become `undefined`, producing `NaN`. Agent must understand that `getTax` is unbound. Fix: `calc.calculateTax.bind(calc)` or use arrow function or call directly.

---

### 8. `node-var-closure` (Level 3) — JS-Specific

**Bug:** Closures created in a `for` loop with `var` all capture the same variable, which holds the final iteration's value.

```javascript
// validators.js
export function makeRangeValidators(ranges) {
  const validators = [];
  for (var i = 0; i < ranges.length; i++) {
    var name = ranges[i].name;
    var low = ranges[i].low;
    var high = ranges[i].high;

    validators.push({
      name: name,
      validate: function(value) {
        return value >= low && value <= high;
      }
    });
  }
  return validators;
}

export function validateAll(ranges, values) {
  const validators = makeRangeValidators(ranges);
  const results = {};
  for (const v of validators) {
    results[v.name] = values.filter(val => v.validate(val));
  }
  return results;
}
```

**What it tests:** All closures reference the same `var low` and `var high`, which hold the last range's values. Every validator checks the same range. Fix: use `let`/`const` instead of `var`, or use an IIFE/`.map()`. Agent needs to inspect the closure variables at runtime to see they're all the same.

---

### 9. `node-event-loop-order` (Level 4) — JS-Specific

**Bug:** A function initializes state via a microtask (Promise resolution) but reads it synchronously before the microtask executes. The event loop ordering means the state is still `null` when read.

```javascript
// config-loader.js
let _config = null;

async function fetchConfig() {
  // Simulates loading config (in real code this would be a file read or HTTP call)
  return {
    maxRetries: 3,
    timeout: 5000,
    features: ["caching", "compression"],
  };
}

export function initConfig() {
  // BUG: the .then callback runs as a microtask — after the current synchronous
  // execution completes, not inline. So _config is still null when used below.
  fetchConfig().then(cfg => {
    _config = cfg;
  });
}

export function getConfig() {
  return _config;
}

export function processRequest(requestData) {
  initConfig();

  // BUG: _config is still null here — the .then hasn't executed yet
  const config = getConfig();
  const timeout = config?.timeout ?? 1000;
  const maxRetries = config?.maxRetries ?? 1;

  return {
    ...requestData,
    timeout,
    maxRetries,
    configLoaded: config !== null,
  };
}
```

**What it tests:** Event loop ordering — `.then()` callbacks are microtasks that run after the current synchronous call stack completes. `_config` is still `null` when `processRequest` reads it. Fix: make `initConfig` async and `await` it, or restructure to `await fetchConfig()` directly. Agent must understand the Node.js event loop to diagnose why `config` is always `null`.

---

### 10. `node-regex-lastindex` (Level 5) — JS-Specific

**Bug:** A RegExp with the `g` (global) flag has stateful `.lastIndex`. When reused across calls, it alternately matches and fails because `.lastIndex` advances, then resets on failure.

```javascript
// parser.js

// Global regex — BUG: the `g` flag makes .test() stateful via .lastIndex
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/g;

export function isValidEmail(email) {
  return EMAIL_PATTERN.test(email.trim());
}

export function validateUsers(users) {
  return users.map(user => ({
    ...user,
    emailValid: isValidEmail(user.email),
  }));
}

export function filterValidUsers(users) {
  return users.filter(u => isValidEmail(u.email));
}

export function validationReport(users) {
  const validated = validateUsers(users);
  const valid = validated.filter(u => u.emailValid);
  const invalid = validated.filter(u => !u.emailValid);
  return {
    total: users.length,
    valid: valid.length,
    invalid: invalid.length,
    invalidEmails: invalid.map(u => u.email),
  };
}
```

**What it tests:** `RegExp.prototype.test()` with the `g` flag advances `.lastIndex`. On the first call, it matches and sets `.lastIndex` past the string. On the second call with a new string, it starts from the non-zero `.lastIndex`, fails, and resets to 0. Result: `.test()` alternates between `true` and `false` for the same valid email. Agent must inspect `.lastIndex` at runtime to understand the oscillation. Fix: remove the `g` flag, or reset `.lastIndex = 0` before each test, or use `String.match()`.

---

## Existing Scenario Reclassification

`node-async-race` (Level 3) is reclassified as **language-specific**. It tests a missing `await` on `fs.writeFile` — an async/promise footgun specific to Node.js. This is not a shared-concept scenario since Python's `asyncio` works fundamentally differently.

---

## Summary Matrix

| # | Name | Level | Category | Bug Pattern |
|---|------|-------|----------|-------------|
| 1 | `node-wrong-constant` | 1 | Shared | Wrong value in config object |
| 2 | `node-splice-vs-slice` | 1 | JS-specific | `splice` mutates, `slice` doesn't |
| 3 | `node-shadow-variable` | 2 | Shared | Variable not reset between loops |
| 4 | `node-this-binding` | 2 | JS-specific | `this` lost when method extracted |
| 5 | `node-stale-accumulator` | 3 | Shared | Module-level mutable state leaks |
| 6 | `node-async-race` | 3 | JS-specific | Missing `await` (existing) |
| 7 | `node-var-closure` | 3 | JS-specific | `var` closure capture in loop |
| 8 | `node-mutation-before-read` | 4 | Shared | Object mutated before summary read |
| 9 | `node-event-loop-order` | 4 | JS-specific | Microtask ordering — `.then` after sync code |
| 10 | `node-float-accumulation` | 5 | Shared | Float precision triggers bad correction |
| 11 | `node-regex-lastindex` | 5 | JS-specific | RegExp `g` flag makes `.test()` stateful |

---

## Implementation Plan

For each scenario, create:
```
scenarios/<name>/
  scenario.json       # name, language: "node", timeout, budget, test commands
  prompt.md           # natural language bug report (no tool hints)
  src/                # buggy source + visible test
  hidden/             # oracle validation test
```

### Test runner
All tests use Node's built-in test runner: `node --test <file>.js`. No npm dependencies needed.

### Timeout / Budget scaling
Per [scenario-guidelines.md](scenario-guidelines.md):
- Level 1-2: 120s, $0.50
- Level 3: 180s, $0.75
- Level 4: 240s, $1.00
- Level 5: 300s, $1.50

### Priority order (implement first to last):
1. `node-wrong-constant` (Level 1 shared) — simplest, establishes the Node pattern
2. `node-splice-vs-slice` (Level 1 JS-specific) — another simple one
3. `node-shadow-variable` (Level 2 shared)
4. `node-this-binding` (Level 2 JS-specific)
5. `node-stale-accumulator` (Level 3 shared)
6. `node-var-closure` (Level 3 JS-specific)
7. `node-mutation-before-read` (Level 4 shared)
8. `node-event-loop-order` (Level 4 JS-specific)
9. `node-float-accumulation` (Level 5 shared)
10. `node-regex-lastindex` (Level 5 JS-specific)

`node-async-race` already exists — no implementation needed.

See [scenario-guidelines.md](scenario-guidelines.md) for cross-language design principles, level definitions, and the scenario anatomy checklist.
