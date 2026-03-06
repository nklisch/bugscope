"""Pricing service — computes order totals with discounts and tax.

Discount strategies are resolved from the config-provided strategy names.
The strategy registry maps names to discount calculator functions.

Pipeline: fetch prices → apply category discounts → subtotal → loyalty discount → tax.
"""

import logging
from dao.product_dao import ProductDAO, _price_cache
from dao.customer_dao import CustomerDAO
from config import get_config, get_discount_rules, get_pricing_strategies, get_tax_rate
from models.order import Order, OrderItem
from models.customer import LoyaltyTier

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Discount strategy implementations
# ---------------------------------------------------------------------------

def percentage_discount(price: float, rate: float) -> float:
    """Apply a percentage discount. rate=0.1 means 10% off."""
    return round(price * (1.0 - rate), 2)


def fixed_amount_discount(price: float, amount: float) -> float:
    """Subtract a fixed dollar amount from the price."""
    return max(0.0, round(price - amount, 2))


def tiered_discount(price: float, rate: float) -> float:
    """Apply a tiered percentage discount with escalating rates."""
    if price >= 500:
        return round(price * 0.80, 2)
    elif price >= 200:
        return round(price * 0.90, 2)
    return round(price * 0.95, 2)


def no_discount(price: float, rate: float) -> float:
    """Identity function — no discount applied."""
    return price


# ---------------------------------------------------------------------------
# Strategy registry
# ---------------------------------------------------------------------------

DISCOUNT_STRATEGIES: dict[str, callable] = {
    "percentage": percentage_discount,     # registered key is "percentage"
    "fixed_amount": fixed_amount_discount,
    "tiered": tiered_discount,
    "none": no_discount,
}


class PricingService:
    """Computes item prices, discounts, taxes, and order totals."""

    def __init__(self, product_dao: ProductDAO, customer_dao: CustomerDAO) -> None:
        self.product_dao = product_dao
        self.customer_dao = customer_dao

    def get_product_price(self, sku: str) -> float:
        """Return the current price for a product SKU, using the price cache.

        On cache miss, fetches from the product DAO and caches the result.
        The cache has a 100ms TTL — prices updated after caching may serve
        stale values within the TTL window until expiry.
        """
        cached = _price_cache.get(f"price:{sku}")
        if cached is not None:
            return cached

        price = self.product_dao.get_price(sku)
        _price_cache.set(f"price:{sku}", price)
        return price

    def get_discount_strategy(self, category: str) -> callable:
        """Look up the discount strategy function for a product category.

        Strategy names come from the encoded config (get_pricing_strategies()).
        If the name doesn't match a registered strategy, returns no_discount.
        """
        strategy_name = get_pricing_strategies().get(category, "none")
        fn = DISCOUNT_STRATEGIES.get(strategy_name, no_discount)
        if fn is no_discount and strategy_name != "none":
            log.warning(
                "Unknown discount strategy %r for category %r — no discount applied",
                strategy_name, category,
            )
        return fn

    def calculate_shipping(self, order: Order) -> float:
        """Calculate shipping cost based on total order weight.

        Orders over the free_threshold get free shipping.
        Otherwise: base_rate + per_kg_rate * total_weight.
        """
        config = get_config()
        shipping_cfg = config.get("shipping", {})
        free_threshold = shipping_cfg.get("free_threshold", 100.0)

        if order.subtotal >= free_threshold:
            return 0.0

        base = shipping_cfg.get("base_rate", 5.99)
        per_kg = shipping_cfg.get("per_kg_rate", 0.50)
        total_weight = sum(
            (self.product_dao.get(i.sku).weight_kg if self.product_dao.get(i.sku) else 0) * i.quantity
            for i in order.items
        )
        return round(base + per_kg * total_weight, 2)

    def apply_loyalty_discount(self, subtotal: float, customer_id: str) -> float:
        """Apply loyalty discount rules from config to the subtotal.

        Iterates all discount_rules from config and applies matching ones.
        """
        customer = self.customer_dao.get(customer_id)
        if customer is None:
            return subtotal

        discount_rules = get_discount_rules()
        result = subtotal
        for rule in discount_rules:
            if rule.get("type") == "loyalty":
                required_tier = rule.get("tier", "")
                if customer.loyalty_tier.value == required_tier:
                    rate = rule.get("rate", 0.0)
                    result = round(result * (1.0 - rate), 2)
                    log.debug(
                        "Applied loyalty discount %.0f%% for %s tier: $%.2f → $%.2f",
                        rate * 100, required_tier, subtotal, result,
                    )
        return result

    def calculate_total(self, order: Order) -> float:
        """Compute the final order total.

        Pipeline:
          1. Compute item line totals (using current prices)
          2. Apply category-specific discount strategy per item
          3. Sum subtotal
          4. Apply loyalty discount
          5. Add tax
        """
        # Recompute line totals with current prices and per-category discounts
        for item in order.items:
            item.unit_price = self.get_product_price(item.sku)
            product = self.product_dao.get(item.sku)
            if product:
                strategy_fn = self.get_discount_strategy(product.category)
                item.unit_price = strategy_fn(item.unit_price, 0.10)
            item.line_total = round(item.unit_price * item.quantity, 2)

        order.recalculate_subtotal()

        # Apply loyalty discount
        discounted = self.apply_loyalty_discount(order.subtotal, order.customer_id)
        order.discount_amount = round(order.subtotal - discounted, 2)

        # Tax
        tax_rate = get_tax_rate()
        order.tax = round(discounted * tax_rate, 2)
        order.total = round(discounted + order.tax, 2)

        return order.total
