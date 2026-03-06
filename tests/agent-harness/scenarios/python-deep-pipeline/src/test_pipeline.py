"""Visible tests for the order fulfillment pipeline."""
from pipeline import process_order


SINGLE_ITEM_ORDER = {
    "order_id": "ORD-SINGLE",
    "customer_id": "CUST-001",
    "ship_to_state": "OR",
    "shipping_zone": "domestic",
    "carrier": "standard",
    "lines": [{"sku": "widget-a", "qty": 1}],
}


def test_single_item_no_bundle_discount():
    """A single-item order has no qualifying bundle — discount total should be zero."""
    result = process_order(SINGLE_ITEM_ORDER)
    assert result["discounts"]["total"] == 0.0, (
        f"Expected no discount for single-item order, got {result['discounts']['total']}"
    )


def test_single_item_grand_total():
    """widget-a ($29.99) + standard domestic shipping ($4.99), no tax in OR = $34.98."""
    result = process_order(SINGLE_ITEM_ORDER)
    assert result["invoice"]["grand_total"] == 34.98, (
        f"Expected $34.98 grand total, got ${result['invoice']['grand_total']}"
    )


def test_pipeline_returns_invoice():
    """process_order returns a dict with the expected invoice structure."""
    result = process_order(SINGLE_ITEM_ORDER)
    assert "invoice" in result
    assert "discounts" in result
    assert "lines_subtotal" in result["invoice"]
    assert "grand_total" in result["invoice"]
