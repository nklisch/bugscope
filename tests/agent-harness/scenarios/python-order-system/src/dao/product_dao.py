"""Data access object for products."""

import logging
from typing import Optional
from models.product import Product
from cache import TTLCache

log = logging.getLogger(__name__)

# Shared price cache — used by pricing_service to avoid redundant lookups.
# Default TTL is 100ms, designed for high-throughput scenarios.
_price_cache = TTLCache(default_ttl=0.1)


class ProductDAO:
    """In-memory product catalog with cache-backed price lookups."""

    def __init__(self) -> None:
        self._products: dict[str, Product] = {}

    def save(self, product: Product) -> Product:
        """Add or update a product in the catalog."""
        self._products[self._normalize_sku(product.sku)] = product
        _price_cache.invalidate(f"price:{product.sku}")
        return product

    def get(self, sku: str) -> Optional[Product]:
        """Look up a product by SKU."""
        return self._products.get(self._normalize_sku(sku))

    def get_price(self, sku: str) -> float:
        """Return the current price for a SKU.

        Does NOT use the price cache — use pricing_service for cached access.
        """
        product = self.get(sku)
        if product is None:
            raise KeyError(f"Product not found: {sku!r}")
        return product.price

    def update_price(self, sku: str, new_price: float) -> None:
        """Update the price of a product in the catalog."""
        product = self.get(sku)
        if product is None:
            raise KeyError(f"Product not found: {sku!r}")
        product.price = new_price
        log.debug("Updated price for %s to $%.2f", sku, new_price)

    def decrement_stock(self, sku: str, quantity: int) -> int:
        """Reduce stock by quantity. Returns new stock level."""
        product = self.get(sku)
        if product is None:
            raise KeyError(f"Product not found: {sku!r}")
        if product.stock < quantity:
            raise ValueError(
                f"Insufficient stock for {sku}: requested {quantity}, have {product.stock}"
            )
        product.stock -= quantity
        return product.stock

    def list_by_category(self, category: str) -> list[Product]:
        """Return all products in a given category."""
        return [p for p in self._products.values() if p.category == category]

    @staticmethod
    def _normalize_sku(sku: str) -> str:
        """Normalize SKU to uppercase for consistent lookups."""
        return sku.upper()

    def get_price_cache(self) -> TTLCache:
        """Return the shared price cache (for testing/inspection)."""
        return _price_cache
