"""Seasonal rate calculation for the Downtown Grand hotel.

Seasonal multipliers adjust the base room rate up or down depending
on demand periods. January through March are shoulder season, summer
is peak, and December carries a holiday premium.
"""

from datetime import date
from models import RateCard


# ---------------------------------------------------------------------------
# Seasonal rate multiplier table
#
# This table was originally ported from a JavaScript system that used
# 0-indexed months (0 = January, 11 = December).
# Each entry maps a month index to a rate multiplier.
# ---------------------------------------------------------------------------

# TODO: verify seasonal rate cards are updated for this year

SEASONAL_RATES: dict[int, float] = {
    0: 1.0,    # intended for January     (shoulder season)
    1: 1.2,    # intended for February    (Valentine's premium)
    2: 0.9,    # intended for March       (off-peak)
    3: 1.0,    # intended for April       (spring shoulder)
    4: 1.0,    # intended for May         (spring shoulder)
    5: 1.1,    # intended for June        (early summer)
    6: 1.3,    # intended for July        (peak summer)
    7: 1.3,    # intended for August      (peak summer)
    8: 1.0,    # intended for September   (fall shoulder)
    9: 1.1,    # intended for October     (fall foliage)
    10: 1.0,   # intended for November    (quiet season)
    11: 1.2,   # intended for December    (holiday premium)
}


def get_seasonal_rate(booking_date: date) -> float:
    """Look up the seasonal rate multiplier for a given date.

    Uses the month of the booking date to determine which seasonal
    pricing tier applies.

    Args:
        booking_date: The check-in date of the reservation.

    Returns:
        A float multiplier (e.g. 1.3 means 30% premium over base rate).
    """
    return SEASONAL_RATES.get(booking_date.month, 1.0)


def get_rate_card(hotel_name: str) -> RateCard:
    """Return the current rate card for a given hotel property.

    In a multi-property system each hotel would have its own rate card
    stored in a database. For now we return the Downtown Grand defaults.
    """
    return RateCard(
        seasonal_multipliers=SEASONAL_RATES,
        tax_rate=0.12,
        deposit_rate=0.20,
        min_deposit=50.0,
    )


def describe_seasonal_calendar() -> str:
    """Return a human-readable description of all seasonal pricing tiers."""
    month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    lines = ["Seasonal Rate Calendar:", "-" * 30]
    for idx, name in enumerate(month_names):
        rate = SEASONAL_RATES.get(idx, 1.0)
        indicator = "▲" if rate > 1.0 else ("▼" if rate < 1.0 else " ")
        lines.append(f"  {name:>10}: {rate:.2f}x {indicator}")
    return "\n".join(lines)


def get_peak_months() -> list[str]:
    """Return the names of months with a rate multiplier above 1.1."""
    month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    return [
        month_names[idx]
        for idx, rate in sorted(SEASONAL_RATES.items())
        if rate > 1.1
    ]


def is_peak_season(booking_date: date) -> bool:
    """Return True if the booking date falls in a peak season month."""
    return get_seasonal_rate(booking_date) > 1.1
