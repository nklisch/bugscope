"""Visible tests for the bill-splitting utility."""
from bill import split_bill


def test_even_split_no_tip():
    """$30 split 3 ways with no tip divides exactly — no rounding issues."""
    result = split_bill(30.00, 3, tip_pct=0.0)
    assert result["total_shares"] == 30.00
    assert result["total_with_tip"] == 30.00
    assert result["shares"] == [10.00, 10.00, 10.00]


def test_even_split_two_people_no_tip():
    """$60 split 2 ways with no tip — exact arithmetic."""
    result = split_bill(60.00, 2, tip_pct=0.0)
    assert result["total_shares"] == 60.00
    assert result["per_person"] == 30.00


def test_returns_expected_keys():
    """Result dict has the expected structure."""
    result = split_bill(40.00, 4)
    assert "per_person" in result
    assert "shares" in result
    assert "total_with_tip" in result
    assert "total_shares" in result
    assert len(result["shares"]) == 4
