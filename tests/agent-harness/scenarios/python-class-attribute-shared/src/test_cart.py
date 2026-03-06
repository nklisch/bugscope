"""Visible tests for the shopping cart system."""
from cart import process_customers


def test_single_customer_total():
    """A single customer's cart correctly totals their items."""
    result = process_customers({
        "alice": [("apple", 3), ("bread", 2)],
    })
    assert result["alice"] == 5, (
        f"Expected 5 items for alice, got {result['alice']}"
    )


def test_process_customers_returns_dict():
    """process_customers returns a dict keyed by customer id with integer values."""
    result = process_customers({"carol": [("pen", 2)]})
    assert "carol" in result
    assert isinstance(result["carol"], int)
