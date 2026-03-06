# Order Processing System

Layered order processing system that handles inventory checks, pricing, discounts, and order confirmation.

## Structure

```
app.py              — application entry point, exposes place_order()
config.py           — configuration and constants
cache.py            — in-memory caching layer
events.py           — order event types
worker.py           — background processing
models/
  order.py          — Order model and status enum
  product.py        — Product model
  customer.py       — Customer and loyalty tier model
dao/
  order_dao.py      — order persistence
  customer_dao.py   — customer lookup
  inventory_dao.py  — stock level management
  product_dao.py    — product catalog
services/
  order_service.py  — order orchestration
  inventory_service.py — inventory reservation and release
  pricing_service.py   — discounts and total calculation
  notification_service.py — order notifications
```

## Running

```bash
python3 -m pytest test_orders.py -v
```
