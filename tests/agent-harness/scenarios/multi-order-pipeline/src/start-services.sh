#!/usr/bin/env bash
# Start all three services in the background.
# Useful for manual testing outside the test runner.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Product Catalog (Python :5001)..."
cd "$SCRIPT_DIR/catalog-service"
python app.py &
CATALOG_PID=$!

echo "Starting Pricing Engine (Node :5002)..."
cd "$SCRIPT_DIR/pricing-service"
node server.js &
PRICING_PID=$!

echo "Starting Order Gateway (Go :5003)..."
cd "$SCRIPT_DIR/order-service"
./order-service &
ORDER_PID=$!

echo "PIDs: catalog=$CATALOG_PID pricing=$PRICING_PID order=$ORDER_PID"
echo "Run ./stop-services.sh to stop all services"

# Wait for health endpoints
sleep 2
curl -sf http://localhost:5001/health > /dev/null && echo "catalog-service: ready"
curl -sf http://localhost:5002/health > /dev/null && echo "pricing-service: ready"
curl -sf http://localhost:5003/health > /dev/null && echo "order-service: ready"
