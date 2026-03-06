# Order Pipeline

Multi-service order processing system. Three backend services handle product data,
pricing computation, and order management.

## Architecture

    Customer → Order Gateway (Go :5003) → Pricing Engine (Node :5002) → Product Catalog (Python :5001)

### Services

| Service | Language | Port | Directory |
|---------|----------|------|-----------|
| Product Catalog | Python (Flask) | 5001 | `catalog-service/` |
| Pricing Engine | Node.js (Express) | 5002 | `pricing-service/` |
| Order Gateway | Go (net/http) | 5003 | `order-service/` |

### Product Catalog (Python :5001)

Product database, stock levels, categories, and supplier info.

- `app.py` — Flask application, route handlers, pagination
- `models.py` — Product and Category data models
- `data.py` — In-memory product database with seed data
- `inventory.py` — Stock level management

### Pricing Engine (Node.js :5002)

Dynamic pricing, volume tiers, promotions, and tax calculation.

- `server.js` — Express server and route handlers
- `pricing.js` — Core pricing logic, catalog data fetching
- `promotions.js` — Promotion rules, coupon validation
- `cache.js` — Product price cache layer
- `tax.js` — Tax computation by jurisdiction

### Order Gateway (Go :5003)

Customer-facing API for cart management and order creation.

- `main.go` — HTTP server and route registration
- `handlers.go` — Request handlers for cart and order endpoints
- `client.go` — HTTP clients for calling Pricing and Catalog services
- `models.go` — Order, Cart, and LineItem data structures
- `shipping.go` — Shipping cost calculation by weight and zone

## Running

    # Start all services (background)
    ./start-services.sh

    # Stop all services
    ./stop-services.sh

    # Start individually
    cd catalog-service && python app.py
    cd pricing-service && node server.js
    cd order-service && ./order-service

    # Run tests (starts and stops services automatically)
    node --test test-pipeline.js

## API

### Product Catalog (:5001)

- `GET /products` — List products (`?category=`, `?page=`, paginated 10/page)
- `GET /products/<id>` — Single product with quantity-based pricing (`?quantity=`)
- `GET /health`

### Pricing Engine (:5002)

- `POST /price` — Batch pricing for cart items `{ "items": [...] }`
- `POST /price/single` — Price a single item `{ "productId": "...", "quantity": N }`
- `GET /promotions` — Active promotions list
- `GET /health`

### Order Gateway (:5003)

- `POST /orders` — Create order from cart `{ "items": [...] }`
- `GET /orders/:id` — Order status
- `POST /orders/:id/reprice` — Re-price a single item `{ "productId": "...", "quantity": N }`
- `GET /health`
