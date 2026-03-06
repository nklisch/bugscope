# Design: Python Scenarios L4–L6

## Overview

One Python scenario per level for L4, L5, and L6. Each escalates in file count, codebase size, bug count, and the degree to which runtime debugging is required.

| Level | Scenario | Domain | Files | Lines | Bugs | Timeout |
|-------|----------|--------|-------|-------|------|---------|
| 4 | `python-hotel-booking` | Hotel reservation system | 10 | ~1200 | 3 | 480s |
| 5 | `python-analytics-engine` | Metrics analytics pipeline | 13 | ~1800 | 4 | 600s |
| 6 | `python-order-system` | Order processing microservice | 20 | ~2800 | 4 | 900s |

---

## L4: python-hotel-booking

### Domain

A hotel reservation system that calculates booking totals based on room type, seasonal rates, guest loyalty tier, and tax. The system has clear module separation: room catalog, rate lookup, availability, guest management, discounts, deposits, and reservation orchestration.

### scenario.json

```json
{
  "scenario": {
    "name": "python-hotel-booking",
    "language": "python",
    "description": "Hotel booking system overcharges a guest due to three bugs: seasonal rate off-by-one month, night count includes checkout day, loyalty tier uses reservation count instead of total nights",
    "timeout_seconds": 480,
    "level": 4
  },
  "setup": { "commands": [] },
  "visible_test": {
    "command": "python3 -m pytest test_booking.py -x -q 2>&1"
  },
  "validation": {
    "command": "python3 -m pytest test_validation.py -x -q 2>&1"
  }
}
```

### prompt.md

```
A reservation for Alice Chen (a loyal returning guest) at the Downtown Grand shows a total of $766.08 for a 3-night Deluxe room stay from January 15-18. The expected total should be around $430. The billing seems significantly wrong — possibly in more than one way.

The system files are `models.py`, `rooms.py`, `rates.py`, `guests.py`, `availability.py`, `discounts.py`, `deposits.py`, `reservations.py`, `reports.py`, and `test_booking.py`. Run `python3 -m pytest test_booking.py -x -q` to see the failing test.
```

### File Structure

```
scenarios/python-hotel-booking/
  scenario.json
  prompt.md
  src/
    models.py          # Dataclasses: Room, Guest, Reservation, RateCard (~120 lines)
    rooms.py           # Room catalog, types, amenities (~100 lines)
    rates.py           # Seasonal rate lookup (BUG 1) (~120 lines)
    guests.py          # Guest profiles, loyalty tier (BUG 3) (~110 lines)
    availability.py    # Date range availability, night counting (BUG 2) (~120 lines)
    discounts.py       # Loyalty discount application (~100 lines)
    deposits.py        # Deposit policy calculation (~80 lines)
    reservations.py    # Reservation orchestration (~150 lines)
    reports.py         # Booking reports and analytics (~100 lines)
    test_booking.py    # Visible failing test (~40 lines)
  hidden/
    test_validation.py # Oracle validation (~100 lines)
```

**Target**: ~1140 lines across 10 source files + tests

### Bug Specifications

#### Bug 1: Seasonal rate month off-by-one (`rates.py`)

**Location**: `rates.py`, function `get_seasonal_rate()`

```python
# The rate card is 0-indexed (a JavaScript port), but date.month is 1-indexed
SEASONAL_RATES = {
    0: 1.0,   # intended for January
    1: 1.2,   # intended for February (Valentine's premium)
    2: 0.9,   # intended for March (off-peak)
    3: 1.0,   # intended for April
    4: 1.0,   # intended for May
    5: 1.1,   # intended for June
    6: 1.3,   # intended for July (peak)
    7: 1.3,   # intended for August (peak)
    8: 1.0,   # intended for September
    9: 1.1,   # intended for October
    10: 1.0,  # intended for November
    11: 1.2,  # intended for December (holiday)
}

def get_seasonal_rate(booking_date: date) -> float:
    """Look up the seasonal rate multiplier for a given date."""
    return SEASONAL_RATES.get(booking_date.month, 1.0)
    # BUG: booking_date.month returns 1 for January
    # SEASONAL_RATES[1] = 1.2 (February's rate)
    # January bookings get charged February's premium rate
```

**Fix**: `SEASONAL_RATES.get(booking_date.month - 1, 1.0)` or re-key the dict to use 1-indexed months.

**Why runtime inspection helps**: The rate card looks perfectly fine (it has 12 entries, reasonable values). The off-by-one only becomes apparent when you see the runtime value of `booking_date.month` vs the dict key being looked up.

#### Bug 2: Night count includes checkout day (`availability.py`)

**Location**: `availability.py`, function `count_nights()`

```python
def count_nights(check_in: date, check_out: date) -> int:
    """Calculate the number of nights for a stay.

    The stay spans from check-in day to the day before check-out.
    """
    # BUG: +1 makes it inclusive of checkout day
    return (check_out - check_in).days + 1
```

**Fix**: Remove `+ 1`. A stay from Jan 15 to Jan 18 is 3 nights, not 4.

**Why runtime inspection helps**: The docstring says "day before check-out" (correct intent), but the code adds 1. The comment and function name look reasonable. You need to inspect the return value at runtime to see 4 when expecting 3.

#### Bug 3: Loyalty tier uses reservation count instead of total nights (`guests.py`)

**Location**: `guests.py`, function `get_loyalty_tier()`

```python
def get_loyalty_tier(guest: Guest) -> str:
    """Determine guest's loyalty tier from their stay history.

    Tiers are based on cumulative engagement with the hotel:
      Gold:     10+ stays
      Silver:    5+ stays
      Bronze:    2+ stays
      Standard:  fewer than 2 stays
    """
    # BUG: uses reservation_count (number of bookings) instead of total_nights
    # Guest model has both fields; the business rule is based on nights stayed
    engagement = guest.reservation_count
    if engagement >= 10:
        return "gold"
    elif engagement >= 5:
        return "silver"
    elif engagement >= 2:
        return "bronze"
    return "standard"
```

**Fix**: Use `guest.total_nights` instead of `guest.reservation_count`. The Guest model has both fields; the business rule intends to use cumulative nights.

**Why runtime inspection helps**: The docstring says "stays" (ambiguous — could mean reservations or nights). You need to inspect `guest.reservation_count` (3) vs `guest.total_nights` (15) at runtime to realize the wrong field is being used.

### Test Data

**Alice Chen (affected by all 3 bugs):**
- `reservation_count`: 3, `total_nights`: 15
- Booking: Deluxe room, Jan 15–18 (3 nights)
- Deluxe base rate: $150/night
- Gold discount (correct tier): 15% off

**Correct calculation:**
- Seasonal rate: Jan → SEASONAL_RATES[0] = 1.0
- Night count: (Jan 18 - Jan 15).days = 3
- Loyalty tier: 15 total_nights >= 10 → Gold (15% off)
- Nightly: $150 × 1.0 × 0.85 = $127.50
- Subtotal: $127.50 × 3 = $382.50
- Tax (12%): $45.90
- **Total: $428.40**

**Buggy calculation (all 3 bugs):**
- Seasonal rate: Jan → SEASONAL_RATES[1] = 1.2 (February's rate)
- Night count: 3 + 1 = 4
- Loyalty tier: 3 reservation_count → Bronze (5% off)
- Nightly: $150 × 1.2 × 0.95 = $171.00
- Subtotal: $171.00 × 4 = $684.00
- Tax (12%): $82.08
- **Total: $766.08**

**Partial fix verification (all 7 combos fail):**
- Fix 1 only: $150 × 1.0 × 0.95 × 4 × 1.12 = $638.40 ≠ $428.40
- Fix 2 only: $150 × 1.2 × 0.95 × 3 × 1.12 = $574.56 ≠ $428.40
- Fix 3 only: $150 × 1.2 × 0.85 × 4 × 1.12 = $685.44 ≠ $428.40
- Fix 1+2: $150 × 1.0 × 0.95 × 3 × 1.12 = $478.80 ≠ $428.40
- Fix 1+3: $150 × 1.0 × 0.85 × 4 × 1.12 = $571.20 ≠ $428.40
- Fix 2+3: $150 × 1.2 × 0.85 × 3 × 1.12 = $514.08 ≠ $428.40
- Fix all 3: $150 × 1.0 × 0.85 × 3 × 1.12 = **$428.40** ✓

### Misdirection Elements

1. `# TODO: verify seasonal rate cards are updated for this year` — comment near correct rate loading code in `rates.py`
2. `apply_group_discount()` — defined in `discounts.py` but never called (suspicious dead code)
3. `import decimal` — imported in `deposits.py` but only used for deposit rounding (correct usage that looks suspicious)
4. `validate_date_range()` — complex function in `availability.py` with careful edge-case handling (works perfectly, near the buggy `count_nights()`)
5. `calculate_cancellation_fee()` — elaborate function in `reservations.py` (completely correct, looks complex)
6. A second guest "Bob Martinez" in test data who books in April with no loyalty — unaffected by any bug (his April rate is 1.0 whether using key 3 or 4 since both map to 1.0 in the rate card; he has no loyalty discount; and his night count error would exist but the test doesn't check Bob's total)

### Visible Test (`src/test_booking.py`)

```python
import pytest
from reservations import create_reservation
from data import alice, alice_booking_request, hotel_config

def test_alice_reservation_total():
    reservation = create_reservation(alice, alice_booking_request, hotel_config)
    assert reservation.total == pytest.approx(428.40, abs=0.01), (
        f"Expected $428.40 total, got ${reservation.total:.2f}"
    )

def test_alice_night_count():
    reservation = create_reservation(alice, alice_booking_request, hotel_config)
    assert reservation.nights == 3, (
        f"Expected 3 nights (Jan 15-18), got {reservation.nights}"
    )
```

### Hidden Test (`hidden/test_validation.py`)

~12 assertions across ~10 test functions:

1. `test_seasonal_rate_january()` — Jan rate is 1.0 (not 1.2)
2. `test_seasonal_rate_february()` — Feb rate is 1.2
3. `test_seasonal_rate_july()` — Jul rate is 1.3 (peak)
4. `test_night_count_3_nights()` — Jan 15-18 = 3 nights
5. `test_night_count_1_night()` — Jan 15-16 = 1 night
6. `test_loyalty_tier_gold()` — 15 total nights → Gold
7. `test_loyalty_tier_silver()` — 7 total nights → Silver
8. `test_loyalty_tier_by_nights_not_stays()` — 3 stays / 15 nights → Gold (not Bronze)
9. `test_alice_total()` — $428.40
10. `test_alice_nightly_rate()` — $127.50 ($150 × 1.0 × 0.85)
11. `test_alice_loyalty_discount()` — 15% (Gold tier)
12. `test_bob_unaffected()` — Bob's booking calculates correctly regardless

### Acceptance Criteria

- [ ] 10 source files in `src/` totaling ~1000-1300 lines
- [ ] All 3 bugs present — visible test fails with $766.08
- [ ] Fixing all 3 bugs → visible test passes ($428.40)
- [ ] All 7 partial-fix combinations still fail the visible test
- [ ] Hidden validation (12 tests) passes with all 3 bugs fixed
- [ ] Misdirection elements present (≥4 false leads)
- [ ] No `BUG`, `FIXME`, or `TODO` comments near actual bugs
- [ ] Realistic hotel booking code with proper docstrings and helpers

---

## L5: python-analytics-engine

### Domain

A data analytics engine that processes event streams, computes configurable metrics, and generates reports. Metric definitions are loaded from encoded configuration. Transform and aggregation functions are registered dynamically. The pipeline: extract events → filter → transform/enrich → aggregate → format.

### scenario.json

```json
{
  "scenario": {
    "name": "python-analytics-engine",
    "language": "python",
    "description": "Analytics engine produces wrong metric values due to four bugs: encoded config has aggregation function typo, default argument captures stale conversion rate, dimension filter type mismatch silently excludes events, zero-unit fallback pollutes weighted average",
    "timeout_seconds": 600,
    "level": 5
  },
  "setup": { "commands": [] },
  "visible_test": {
    "command": "python3 -m pytest test_analytics.py -x -q 2>&1"
  },
  "validation": {
    "command": "python3 -m pytest test_validation.py -x -q 2>&1"
  }
}
```

### prompt.md

```
The analytics dashboard shows `avg_revenue_per_unit` for the East region as $4.82 when it should be closer to $10. The metric also doesn't seem to be in the right currency — values should be in EUR but look like USD amounts. The engineering team suspects the new metric pipeline has issues, possibly in how metrics are configured, how events are filtered, or how derived fields are computed. Multiple things seem off.

The source files are `models.py`, `config.py`, `registry.py`, `extractors.py`, `transformers.py`, `filters.py`, `aggregators.py`, `engine.py`, `formatters.py`, `cache.py`, `validators.py`, `utils.py`, and `test_analytics.py`. Run `python3 -m pytest test_analytics.py -x -q` to see the failing test.
```

### File Structure

```
scenarios/python-analytics-engine/
  scenario.json
  prompt.md
  src/
    models.py        # Event, MetricDefinition, MetricResult, Query (~130 lines)
    config.py        # Config loading with base64-encoded metrics (BUG 1 data) (~150 lines)
    registry.py      # Aggregation function registry (~120 lines)
    extractors.py    # Event parsing from multiple formats (~150 lines)
    transformers.py  # Data transforms, enrichment (BUG 2 + BUG 4) (~180 lines)
    filters.py       # Dimension and time range filtering (BUG 3) (~130 lines)
    aggregators.py   # sum, mean, weighted_average, percentile (~160 lines)
    engine.py        # Analytics engine orchestration (~200 lines)
    formatters.py    # Output formatting and rounding (~120 lines)
    cache.py         # Computation result cache with TTL (~100 lines)
    validators.py    # Event schema validation (~100 lines)
    utils.py         # Date helpers, hashing, serialization (~80 lines)
    test_analytics.py # Visible failing test (~40 lines)
  hidden/
    test_validation.py # Oracle validation (~120 lines)
```

**Target**: ~1660 lines across 12 source files + tests

### Bug Specifications

#### Bug 1: Encoded config has aggregation function typo (`config.py` → `registry.py`) — Runtime-only

**Location**: `config.py`, the base64-encoded metric definitions string

```python
# config.py
import base64
import json

# Metric definitions loaded from secure configuration source
_METRIC_DEFINITIONS_B64 = base64.b64encode(json.dumps({
    "metrics": [
        {"name": "total_revenue", "aggregation": "sum", "field": "revenue"},
        {"name": "avg_revenue_per_unit", "aggregation": "weighted_averge", "field": "revenue_per_unit"},
        #                                                ^^^^^^^^^^^^^^^^ TYPO: "weighted_averge" missing 'a'
        {"name": "event_count", "aggregation": "count", "field": "*"},
        {"name": "p95_revenue", "aggregation": "percentile_95", "field": "revenue"},
    ],
    "default_currency": "EUR",
    "conversion_rate": 0.85,
}).encode()).decode()

def load_metric_definitions() -> list[dict]:
    raw = json.loads(base64.b64decode(_METRIC_DEFINITIONS_B64))
    return raw["metrics"]
```

```python
# registry.py
AGGREGATION_FUNCTIONS = {
    "sum": agg_sum,
    "count": agg_count,
    "mean": agg_mean,
    "weighted_average": agg_weighted_average,  # correct spelling
    "percentile_95": agg_p95,
}

def get_aggregation_fn(name: str):
    """Look up an aggregation function by name. Falls back to sum for unknown names."""
    return AGGREGATION_FUNCTIONS.get(name, agg_sum)
```

The encoded config has `"weighted_averge"` (typo) but the registry key is `"weighted_average"`. The lookup returns `agg_sum` as fallback. The metric silently computes a sum instead of a weighted average.

**Fix**: Correct the typo in the base64 string's source data to `"weighted_average"`.

**Why runtime-only**: The base64 string is opaque. You must decode it at runtime (or manually) to see the typo. The code structure looks correct — a config loads, a registry resolves.

#### Bug 2: Default argument captures stale conversion rate (`transformers.py`) — Python-specific, runtime-only

**Location**: `transformers.py`, function `normalize_revenue()`

```python
# transformers.py (module level)
from config import get_conversion_rate

# This runs at import time — BEFORE config.load() sets the real rate
_RATE = get_conversion_rate()  # Returns 1.0 (default, config not loaded yet)

def normalize_revenue(event, rate=_RATE):
    """Convert revenue from USD to the configured target currency."""
    event.revenue = round(event.revenue * rate, 2)
    return event
```

```python
# config.py
_conversion_rate = 1.0  # default before config loads

def get_conversion_rate() -> float:
    return _conversion_rate

def load_config():
    global _conversion_rate
    raw = json.loads(base64.b64decode(_METRIC_DEFINITIONS_B64))
    _conversion_rate = raw.get("conversion_rate", 1.0)  # Sets to 0.85
```

Python evaluates default arguments at function definition time. `rate=_RATE` binds `1.0` at import time. Even after `load_config()` sets the rate to `0.85`, `normalize_revenue()` still uses `1.0`. Revenue values are never converted.

**Fix**: Remove the default argument and read the rate dynamically:
```python
def normalize_revenue(event, rate=None):
    if rate is None:
        rate = get_conversion_rate()
    event.revenue = round(event.revenue * rate, 2)
    return event
```

**Why runtime-only**: The code looks correct — it calls `get_conversion_rate()` and uses the result. The stale binding is invisible in source. You need to inspect `rate` at runtime to see it's `1.0` instead of `0.85`.

#### Bug 3: Dimension filter type mismatch (`filters.py`) — Silent wrong

**Location**: `filters.py`, function `filter_by_dimensions()`

```python
def filter_by_dimensions(events: list[Event], predicates: dict[str, Any]) -> list[Event]:
    """Filter events matching all dimension predicates."""
    result = []
    for event in events:
        match = True
        for dim_name, expected_value in predicates.items():
            actual_value = event.dimensions.get(dim_name)
            if actual_value != expected_value:  # BUG: int 1 != str "1"
                match = False
                break
        if match:
            result.append(event)
    return result
```

Event dimensions contain `{"priority": 1}` (int) but the query config specifies `{"priority": "1"}` (string, from JSON/config parsing). The comparison `1 != "1"` is `True` in Python, so high-priority events are silently excluded. No error, just a smaller result set.

**Fix**: Coerce values before comparison:
```python
if str(actual_value) != str(expected_value):
```

**Why runtime-only**: The filter function looks correct. The type mismatch is only visible by inspecting the actual values at runtime.

#### Bug 4: Zero-division fallback pollutes weighted average (`transformers.py` → `aggregators.py`)

**Location**: `transformers.py`, function `enrich_revenue_per_unit()`

```python
# transformers.py
def enrich_revenue_per_unit(event):
    """Compute derived revenue-per-unit field."""
    try:
        event.revenue_per_unit = event.revenue / event.units
    except ZeroDivisionError:
        # BUG: Should set to None to exclude from average, not 0
        event.revenue_per_unit = 0
    return event
```

```python
# aggregators.py
def agg_weighted_average(values: list[float], weights: list[float]) -> float:
    """Compute weighted average. Ignores None values."""
    pairs = [(v, w) for v, w in zip(values, weights) if v is not None]
    if not pairs:
        return 0.0
    total = sum(v * w for v, w in pairs)
    weight_sum = sum(w for _, w in pairs)
    return total / weight_sum if weight_sum > 0 else 0.0
```

Events with `units=0` get `revenue_per_unit=0` instead of `None`. The aggregator has logic to skip `None` values, but `0` passes through. The zero values pull the weighted average down.

**Fix**: Set `event.revenue_per_unit = None` in the except clause.

**Why runtime-only**: The code pattern (catch ZeroDivisionError, set fallback) looks like reasonable defensive programming. You need to trace the data flow to see that `0` values propagate into the aggregation and that the aggregator specifically filters `None` but not `0`.

### Test Data

10 events with various revenue, units, and dimension values. Key properties:
- 8 events in region "east" (4 with priority 1, 4 with priority 2)
- 2 events in region "west"
- 1 event has `units=0` (free-tier event)
- Revenue values designed so that sum ≠ weighted_average by a clear margin

The implementer should design events such that:
- Correct metric (all bugs fixed): `avg_revenue_per_unit` ≈ $10 (in EUR)
- Buggy metric (all bugs): ≈ $4.82 (wrong aggregation, wrong currency, missing events, polluted avg)
- All partial fixes produce different wrong values

### Misdirection Elements

1. `cache.py` — Full TTL cache implementation with `get()`, `set()`, `invalidate()`, LRU eviction. Works perfectly. Looks like a plausible source of stale data.
2. `validators.py` — Complex JSON schema validation with type checking and required field verification. Works perfectly.
3. `# FIXME: percentile calculation may be off for small datasets` — comment near the correct `agg_p95()` in `aggregators.py`
4. `MedianAbsoluteDeviation` — unused aggregator class in `aggregators.py`. Looks like dead code.
5. `format_report()` in `formatters.py` — complex locale-specific number formatting. Works correctly but looks error-prone.
6. Extractors with multiple format parsers (CSV, JSON, dict) — all correct, adds noise.

### Visible Test (`src/test_analytics.py`)

```python
import pytest
from engine import AnalyticsEngine
from config import load_config
from data import SAMPLE_EVENTS, METRIC_QUERY

def test_avg_revenue_per_unit():
    load_config()
    engine = AnalyticsEngine()
    result = engine.compute_metric(METRIC_QUERY, SAMPLE_EVENTS)
    assert result.value == pytest.approx(EXPECTED_VALUE, abs=0.01), (
        f"Expected avg_revenue_per_unit ~${EXPECTED_VALUE}, got ${result.value:.2f}"
    )

def test_revenue_currency_is_eur():
    load_config()
    engine = AnalyticsEngine()
    result = engine.compute_metric(METRIC_QUERY, SAMPLE_EVENTS)
    assert result.currency == "EUR", f"Expected EUR, got {result.currency}"
```

### Hidden Test (`hidden/test_validation.py`)

~15 assertions across ~12 test functions:

1. `test_config_aggregation_name()` — decoded config has `"weighted_average"` (not typo)
2. `test_registry_resolves_weighted_average()` — returns `agg_weighted_average`, not `agg_sum`
3. `test_conversion_rate_applied()` — revenue values are multiplied by 0.85
4. `test_conversion_rate_not_stale()` — rate is 0.85 after config load (not 1.0)
5. `test_dimension_filter_int_match()` — priority=1 (int) matches filter
6. `test_dimension_filter_mixed_types()` — int and string values both match correctly
7. `test_zero_units_excluded_from_average()` — events with units=0 don't contribute to avg
8. `test_zero_units_revenue_per_unit_is_none()` — `revenue_per_unit` is None, not 0
9. `test_east_region_event_count()` — correct number of events after filtering
10. `test_metric_value_correct()` — final metric value matches expected
11. `test_total_revenue_metric()` — sum aggregation works correctly
12. `test_event_count_metric()` — count aggregation works correctly

### Acceptance Criteria

- [ ] 12 source files in `src/` totaling ~1500-2000 lines
- [ ] All 4 bugs present — visible test fails
- [ ] Fixing all 4 bugs → visible test passes
- [ ] All partial-fix combinations fail
- [ ] Hidden validation (12+ tests) passes with all 4 bugs fixed
- [ ] Base64 config is genuinely opaque (not readable in source)
- [ ] Default argument bug is a genuine Python footgun (not artificially constructed)
- [ ] Misdirection elements present (≥5 false leads)
- [ ] No `BUG`, `FIXME`, or `TODO` comments near actual bugs

---

## L6: python-order-system

### Domain

A production-like order processing system with layered architecture: API handlers, service layer, data access objects, event publishing, caching, and background workers. The system processes customer orders through validation, pricing, inventory reservation, fulfillment, and notification.

### scenario.json

```json
{
  "scenario": {
    "name": "python-order-system",
    "language": "python",
    "description": "Order system fails to process orders correctly due to four bugs: event published before reservation stored causes worker to see empty inventory, config deep-merge concatenates lists causing double discount, cache returns stale price that clears when debugging slows execution, encoded config has wrong discount strategy name causing silent fallback",
    "timeout_seconds": 900,
    "level": 6
  },
  "setup": { "commands": [] },
  "visible_test": {
    "command": "python3 -m pytest test_orders.py -x -q 2>&1"
  },
  "validation": {
    "command": "python3 -m pytest test_validation.py -x -q 2>&1"
  }
}
```

### prompt.md

```
The order processing system is producing wrong results. A test order for customer "Acme Corp" (a Gold loyalty customer) ends up with status "failed_inventory" even though there's plenty of stock. The order total also looks wrong — the loyalty discount seems either missing or doubled depending on which part of the system you check. Something changed recently and the team suspects multiple issues.

The system has a layered architecture with models, data access, services, and handlers in their respective subdirectories. The entry point is `app.py`. Run `python3 -m pytest test_orders.py -x -q` to see the failing tests.
```

### File Structure

```
scenarios/python-order-system/
  scenario.json
  prompt.md
  src/
    # Models layer
    models/__init__.py         # Re-exports (~10 lines)
    models/order.py            # Order, OrderItem, OrderStatus (~100 lines)
    models/product.py          # Product, PriceEntry (~80 lines)
    models/customer.py         # Customer, LoyaltyTier (~70 lines)

    # Data access layer
    dao/__init__.py            # Re-exports (~10 lines)
    dao/order_dao.py           # Order CRUD, in-memory store (~100 lines)
    dao/product_dao.py         # Product catalog queries (~90 lines)
    dao/customer_dao.py        # Customer lookup (~80 lines)
    dao/inventory_dao.py       # Stock tracking, reservations (~100 lines)

    # Service layer
    services/__init__.py       # Re-exports (~10 lines)
    services/order_service.py  # Order orchestration (BUG 1 location) (~150 lines)
    services/pricing_service.py # Pricing, discounts (BUG 4 effects) (~130 lines)
    services/inventory_service.py # Stock management (~100 lines)
    services/notification_service.py # Event publishing (~70 lines)

    # Infrastructure
    config.py                  # Multi-source config, deep_merge (BUG 2) (~130 lines)
    cache.py                   # TTL cache (BUG 3) (~100 lines)
    events.py                  # Synchronous event bus (~80 lines)
    worker.py                  # Background order processor (BUG 1 trigger) (~100 lines)

    # Application
    app.py                     # Wiring and initialization (~100 lines)
    test_orders.py             # Visible test (~50 lines)
  hidden/
    test_validation.py         # Oracle validation (~150 lines)
```

**Target**: ~1890 lines across 20 source files + tests.

To reach the ~2800 line target, each file should include:
- Comprehensive docstrings
- Logging setup (using `logging` module)
- Error handling patterns
- Helper methods that work correctly (noise)
- Additional utility functions in `dao/` and `services/`

### Bug Specifications

#### Bug 1: Event published before reservation stored (`services/order_service.py` + `worker.py`) — Ordering/timing

**Call chain**: `order_service.create_order()` → `events.publish("order_created", order)` → `worker.on_order_created(order)` → `inventory_service.confirm_reservation(order.id)` → `inventory_dao.get_reservation(order.id)` → **None** (not stored yet)

```python
# services/order_service.py
def create_order(self, customer_id: str, items: list[dict]) -> Order:
    order = self._build_order(customer_id, items)
    order.total = self.pricing_service.calculate_total(order)

    # BUG: publish event BEFORE storing reservation
    self.events.publish("order_created", order)

    # Reservation is stored AFTER the event is dispatched
    self.inventory_service.reserve_stock(order)

    self.order_dao.save(order)
    return order
```

```python
# worker.py
class OrderWorker:
    def on_order_created(self, order: Order):
        """Handle new order — confirm inventory reservation."""
        reservation = self.inventory_service.get_reservation(order.id)
        if reservation is None:
            # BUG EFFECT: reservation doesn't exist yet
            order.status = OrderStatus.FAILED_INVENTORY
            self.order_dao.save(order)
            return
        order.status = OrderStatus.CONFIRMED
        self.order_dao.save(order)
```

The synchronous event bus calls `worker.on_order_created()` during `events.publish()`, before `reserve_stock()` has run. The worker finds no reservation and marks the order as failed.

**Fix**: Move `self.inventory_service.reserve_stock(order)` BEFORE `self.events.publish("order_created", order)`.

**Why this is an ordering bug**: The event dispatch is synchronous — the callback executes inline during `publish()`. This is a classic callback sequencing issue. The data flow crosses 6 function calls and 5 files.

#### Bug 2: Config deep_merge concatenates lists instead of replacing (`config.py`) — Runtime inspection

```python
# config.py
def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base."""
    result = base.copy()
    for key, value in override.items():
        if key in result:
            if isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = deep_merge(result[key], value)
            elif isinstance(result[key], list) and isinstance(value, list):
                # BUG: concatenates lists instead of replacing
                result[key] = result[key] + value
            else:
                result[key] = value
        else:
            result[key] = value
    return result
```

Default config has `"discount_rules": [{"type": "loyalty", "rate": 0.05}]`. The override (JSON file) has `"discount_rules": [{"type": "loyalty", "rate": 0.10}]`. After merge: `[{"type": "loyalty", "rate": 0.05}, {"type": "loyalty", "rate": 0.10}]` — both entries. The pricing service iterates all rules and applies BOTH discounts, giving a 15% discount instead of 10%.

**Fix**: Replace the list concatenation branch — lists should be overwritten, not appended:
```python
elif isinstance(result[key], list) and isinstance(value, list):
    result[key] = value  # Replace, don't concatenate
```

**Why runtime inspection**: The `deep_merge` function looks like a reasonable recursive merge. The list concatenation might even look intentional. You need to inspect the merged config at runtime to see the duplicated discount rules.

#### Bug 3: Cache returns stale price — Ghost bug (`cache.py` + `services/pricing_service.py`)

```python
# cache.py
import time

class TTLCache:
    def __init__(self, default_ttl: float = 0.1):  # 100ms TTL
        self._store: dict[str, tuple[float, Any]] = {}
        self._default_ttl = default_ttl

    def get(self, key: str) -> Any | None:
        if key in self._store:
            expiry, value = self._store[key]
            if time.time() < expiry:
                return value
            del self._store[key]
        return None

    def set(self, key: str, value: Any, ttl: float | None = None):
        t = ttl if ttl is not None else self._default_ttl
        self._store[key] = (time.time() + t, value)
```

```python
# services/pricing_service.py
def get_product_price(self, sku: str) -> float:
    cached = self.cache.get(f"price:{sku}")
    if cached is not None:
        return cached

    price = self.product_dao.get_price(sku)
    self.cache.set(f"price:{sku}", price)
    return price
```

The sequence in `app.py` / test setup:
1. `pricing_service.get_product_price("WIDGET-1")` → fetches $25.00, caches it
2. `product_dao.update_price("WIDGET-1", 20.00)` → a sale starts, price drops to $20.00
3. `pricing_service.get_product_price("WIDGET-1")` → cache HIT → returns stale $25.00

The 100ms TTL is short enough that normal test execution finishes within the window. But if you add print/debug statements or step through with a debugger, execution slows past 100ms, the cache expires, and the correct price is returned.

**Fix**: Invalidate cache when prices are updated:
```python
# product_dao.py
def update_price(self, sku: str, new_price: float):
    self._products[sku].price = new_price
    self.cache.invalidate(f"price:{sku}")  # Add cache invalidation
```

Or increase TTL awareness in the test by calling `cache.invalidate()` explicitly.

**Why this is a ghost bug**: Adding any logging, debugging, or breakpoints slows execution past the 100ms TTL, making the cache miss and returning the correct price. The bug literally disappears when you try to observe it with print statements.

#### Bug 4: Encoded config has wrong discount strategy name (`config.py` → `services/pricing_service.py`) — Runtime-only

```python
# In the base64-encoded config section of config.py
# The encoded JSON contains:
{
    "pricing": {
        "strategies": {
            "electronics": "percent",        # BUG: should be "percentage"
            "accessories": "fixed_amount",
            "services": "tiered"
        }
    }
}
```

```python
# services/pricing_service.py
DISCOUNT_STRATEGIES = {
    "percentage": percentage_discount,    # correct key name
    "fixed_amount": fixed_amount_discount,
    "tiered": tiered_discount,
}

def get_discount_strategy(self, category: str):
    strategy_name = self.config["pricing"]["strategies"].get(category, "none")
    return DISCOUNT_STRATEGIES.get(strategy_name, no_discount)
    # "percent" not in DISCOUNT_STRATEGIES → falls back to no_discount
```

The encoded config specifies `"percent"` for electronics, but the strategy registry key is `"percentage"`. The lookup silently falls back to `no_discount` (returns 0). Electronics products get no category discount.

**Fix**: Correct the strategy name in the encoded config to `"percentage"`.

**Why runtime-only**: Like Bug 1 in L5, the config is base64-encoded. You must decode it at runtime to see the name mismatch. The strategy pattern code looks correct.

### Misdirection Elements

1. `# BUG: this validation seems too lenient` — comment near correct input validation in `handlers/order_handler.py`
2. `retry_with_backoff()` — decorator defined in `utils.py`, used on `notification_service.send()` (works correctly)
3. Complex error handling in `events.py` — try/except around subscriber callbacks with logging (correct, looks suspicious)
4. `validate_inventory()` in `inventory_service.py` — careful `is not None` checks that look like they might be wrong (they're correct)
5. `calculate_shipping()` — elaborate weight-based shipping calculation in `pricing_service.py` (completely correct)
6. Architecture docstrings in each `__init__.py` explaining the layer's responsibilities (realistic but add noise)
7. An `audit_log` table in `order_dao.py` that logs all mutations (works correctly, adds complexity)
8. A `_normalize_sku()` function in `product_dao.py` that uppercases SKUs (correct, looks like it could be a case-sensitivity bug)

### Visible Test (`src/test_orders.py`)

```python
import pytest
from app import create_app

def test_order_status_confirmed():
    app = create_app()
    order = app.place_order("CUST-001", [
        {"sku": "WIDGET-1", "quantity": 2},
        {"sku": "GADGET-1", "quantity": 1},
    ])
    assert order.status.value == "confirmed", (
        f"Expected 'confirmed', got '{order.status.value}'"
    )

def test_order_total():
    app = create_app()
    order = app.place_order("CUST-001", [
        {"sku": "WIDGET-1", "quantity": 2},
        {"sku": "GADGET-1", "quantity": 1},
    ])
    assert order.total == pytest.approx(EXPECTED_TOTAL, abs=0.01), (
        f"Expected ${EXPECTED_TOTAL}, got ${order.total:.2f}"
    )
```

The visible test catches Bug 1 (status=failed_inventory) and the combined pricing bugs (wrong total). Only 2 symptoms for 4 bugs.

### Hidden Test (`hidden/test_validation.py`)

~15 assertions across ~12 test functions:

1. `test_order_status_confirmed()` — order is confirmed, not failed
2. `test_reservation_exists_before_event()` — reservation is stored before worker runs
3. `test_config_discount_rules_not_duplicated()` — merged config has 1 loyalty rule (not 2)
4. `test_config_deep_merge_replaces_lists()` — list override replaces, not concatenates
5. `test_price_reflects_sale()` — updated price is used (not cached stale price)
6. `test_cache_invalidation()` — price cache cleared on update
7. `test_discount_strategy_resolved()` — electronics category gets `percentage_discount` function
8. `test_encoded_strategy_name()` — config has `"percentage"` (not `"percent"`)
9. `test_loyalty_discount_applied()` — Gold customer gets correct loyalty discount
10. `test_loyalty_discount_not_doubled()` — discount applied once (not twice from merged config)
11. `test_order_total_correct()` — final total matches expected value
12. `test_order_item_prices()` — individual line items have correct prices
13. `test_inventory_decremented()` — stock correctly reduced after order
14. `test_worker_processes_successfully()` — worker callback completes without marking failed

### Acceptance Criteria

- [ ] 20 source files in `src/` with subdirectory structure totaling ~2500-3200 lines
- [ ] All 4 bugs present — visible test fails (wrong status + wrong total)
- [ ] Fixing all 4 bugs → visible test passes
- [ ] All partial-fix combinations fail
- [ ] Hidden validation (14+ tests) passes with all 4 bugs fixed
- [ ] Ghost bug (Bug 3) disappears when execution is slowed by ≥100ms (e.g., adding print statements)
- [ ] Event ordering bug crosses 5+ function calls across 4+ files
- [ ] Encoded config requires base64 decoding to inspect
- [ ] Misdirection elements present (≥6 false leads)
- [ ] No `BUG`, `FIXME`, or `TODO` comments near actual bugs (misdirection comments only near correct code)
- [ ] Realistic production-like project structure with logging, error handling, docstrings

---

## Implementation Order

1. **L4: python-hotel-booking** — Simplest of the three. 10 flat files, 3 straightforward bugs with clean numeric verification. Build this first to validate the pattern.

2. **L5: python-analytics-engine** — 12 flat files, 4 bugs including Python-specific footguns. The base64 encoding and default argument binding are new patterns not seen in L1-L3. Build after L4 is verified.

3. **L6: python-order-system** — 20 files with subdirectories, 4 bugs including a ghost bug and ordering bug. Most complex to implement and verify. Build last.

## Testing / Verification Checklist

For each scenario, the implementer MUST verify:

```bash
# 1. Buggy test fails
cd /tmp && rm -rf test-scenario && mkdir test-scenario
cp -r scenarios/<name>/src/* test-scenario/
cd test-scenario && python3 -m pytest <test_file> -x -q
# → MUST FAIL

# 2. Fix all bugs → visible test passes
# Apply all fixes
python3 -m pytest <test_file> -x -q
# → MUST PASS

# 3. Hidden validation passes
cp scenarios/<name>/hidden/* test-scenario/
python3 -m pytest test_validation.py -x -q
# → MUST PASS

# 4. All partial fix combinations fail
# For each subset of bugs (2^N - 2 combinations), fix only that subset
# → MUST ALL FAIL the visible test
```

For L6 additionally:
```bash
# 5. Ghost bug verification
# Add a time.sleep(0.2) or print() before the cache read
# → Bug 3's symptom should disappear
```
