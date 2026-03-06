"""
Data models for the product catalog.
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone


@dataclass
class Supplier:
    id: str
    name: str
    contact_email: str
    lead_time_days: int


@dataclass
class Category:
    id: str
    name: str
    description: str
    parent_id: Optional[str] = None


@dataclass
class PriceTier:
    min_qty: int
    max_qty: Optional[int]
    unit_price: float


@dataclass
class Product:
    id: str
    name: str
    category: str
    weight_kg: float
    base_price: float
    stock: int
    supplier_id: str
    description: str = ""
    price_tiers: list = field(default_factory=list)
    last_restocked: Optional[datetime] = None

    def price_for_quantity(self, quantity: int) -> float:
        """Return the unit price for the given quantity, respecting price tiers."""
        for tier in reversed(self.price_tiers):
            if quantity >= tier.min_qty:
                return tier.unit_price
        return self.base_price

    def to_dict(self, quantity: int = 1) -> dict:
        # Timezone-aware last_restocked for consistency across regions
        restocked = None
        if self.last_restocked:
            if self.last_restocked.tzinfo is None:
                restocked = self.last_restocked.replace(tzinfo=timezone.utc).isoformat()
            else:
                restocked = self.last_restocked.astimezone(timezone.utc).isoformat()

        return {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "weight_kg": self.weight_kg,
            "base_price": self.price_for_quantity(quantity),
            "stock": self.stock,
            "supplier_id": self.supplier_id,
            "description": self.description,
            "last_restocked": restocked,
        }
