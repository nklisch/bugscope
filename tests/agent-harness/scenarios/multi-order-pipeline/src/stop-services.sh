#!/usr/bin/env bash
# Stop all three services started by start-services.sh
pkill -f "python app.py" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
pkill -f "./order-service" 2>/dev/null || true
echo "Services stopped"
