"""Visible tests for the order processing system."""

from app import create_app


def test_place_order_returns_order():
    """place_order returns an order object with status and total attributes."""
    app = create_app()
    order = app.place_order("CUST-001", [
        {"sku": "WIDGET-1", "quantity": 1},
    ])
    assert order is not None
    assert hasattr(order, "status"), "Order should have a 'status' attribute"
    assert hasattr(order, "total"), "Order should have a 'total' attribute"


def test_order_total_is_numeric():
    """Order total should be a finite positive number."""
    app = create_app()
    order = app.place_order("CUST-001", [
        {"sku": "WIDGET-1", "quantity": 1},
    ])
    assert isinstance(order.total, (int, float)), f"total should be numeric, got {type(order.total)}"
    assert order.total > 0, f"total should be positive, got {order.total}"
