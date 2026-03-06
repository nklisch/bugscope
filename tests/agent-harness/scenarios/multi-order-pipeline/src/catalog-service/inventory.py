"""
Stock level management and reservation system.
"""

import threading
from data import PRODUCTS

_lock = threading.Lock()

# In-memory reservation store: product_id -> reserved_count
_reservations: dict = {}


def get_available_stock(product_id: str) -> int:
    """Return stock minus any active reservations."""
    product = PRODUCTS.get(product_id)
    if not product:
        return 0
    reserved = _reservations.get(product_id, 0)
    return max(0, product.stock - reserved)


def reserve_stock(product_id: str, quantity: int) -> bool:
    """
    Attempt to reserve stock for an order.
    Returns True if reservation succeeded, False if insufficient stock.
    """
    with _lock:
        available = get_available_stock(product_id)
        if available < quantity:
            return False
        _reservations[product_id] = _reservations.get(product_id, 0) + quantity
        return True


def release_reservation(product_id: str, quantity: int) -> None:
    """Release a previously made reservation (e.g., on order cancellation)."""
    with _lock:
        current = _reservations.get(product_id, 0)
        _reservations[product_id] = max(0, current - quantity)


def commit_reservation(product_id: str, quantity: int) -> bool:
    """
    Commit a reservation by actually decrementing stock.
    Returns True if the product existed and stock was decremented.
    """
    with _lock:
        product = PRODUCTS.get(product_id)
        if not product:
            return False
        reserved = _reservations.get(product_id, 0)
        _reservations[product_id] = max(0, reserved - quantity)
        product.stock = max(0, product.stock - quantity)
        return True


def stock_summary() -> list:
    """Return a summary of current stock levels for all products."""
    result = []
    for product_id, product in PRODUCTS.items():
        result.append({
            "product_id": product_id,
            "name": product.name,
            "stock": product.stock,
            "reserved": _reservations.get(product_id, 0),
            "available": get_available_stock(product_id),
        })
    return result
