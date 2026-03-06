"""Visible tests for the billing system.

These tests exercise invoice generation for usage patterns that are
not affected by tier boundary or sub-feature aggregation bugs.
"""

from datetime import datetime
from models import UsageRecord, Account
from billing import generate_invoice


ACCOUNT = Account(
    account_id="acct-001",
    name="Acme Corp",
    plan="starter",
    created_at=datetime(2024, 1, 15),
    billing_email="billing@acme.example.com",
)

PERIOD_START = datetime(2024, 3, 1)
PERIOD_END = datetime(2024, 3, 31)


def test_compute_hours_charge():
    """50 compute hours well within tier — $0.50/hr = $25.00."""
    usage = [UsageRecord("acct-001", "compute_hours", 50, datetime(2024, 3, 20))]
    invoice = generate_invoice(ACCOUNT, usage, PERIOD_START, PERIOD_END)
    items = [li for li in invoice.line_items if li.feature == "compute_hours"]
    assert len(items) == 1, f"Expected 1 compute_hours line item, got {len(items)}"
    assert items[0].amount == 25.00, f"Expected $25.00 for compute_hours, got ${items[0].amount}"


def test_bandwidth_charge():
    """110 units bandwidth (100 billable at $0.08) = $8.00."""
    usage = [UsageRecord("acct-001", "bandwidth", 110, datetime(2024, 3, 8))]
    invoice = generate_invoice(ACCOUNT, usage, PERIOD_START, PERIOD_END)
    items = [li for li in invoice.line_items if li.feature == "bandwidth"]
    assert len(items) == 1, f"Expected 1 bandwidth line item, got {len(items)}"
    assert items[0].amount == 8.00, f"Expected $8.00 for bandwidth, got ${items[0].amount}"


def test_invoice_has_expected_structure():
    """generate_invoice returns an Invoice with line_items and subtotal."""
    usage = [UsageRecord("acct-001", "compute_hours", 10, datetime(2024, 3, 1))]
    invoice = generate_invoice(ACCOUNT, usage, PERIOD_START, PERIOD_END)
    assert hasattr(invoice, "line_items")
    assert hasattr(invoice, "subtotal")
    assert len(invoice.line_items) > 0
