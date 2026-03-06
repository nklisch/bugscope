"""Test data for the Downtown Grand hotel booking system.

Defines guests, booking requests, and hotel configuration
for the reservation test suite.
"""

from datetime import date

from models import BookingRequest, Guest, HotelConfig, RateCard
from rates import SEASONAL_RATES


# ---------------------------------------------------------------------------
# Hotel configuration
# ---------------------------------------------------------------------------

hotel_config = HotelConfig(
    hotel_name="Downtown Grand",
    rate_card=RateCard(
        seasonal_multipliers=SEASONAL_RATES,
        tax_rate=0.12,
        deposit_rate=0.20,
        min_deposit=50.0,
    ),
    loyalty_discounts={
        "gold": 0.15,      # 15% off for Gold members (10+ total nights)
        "silver": 0.10,    # 10% off for Silver members (5+ total nights)
        "bronze": 0.05,    # 5% off for Bronze members (2+ total nights)
        "standard": 0.0,   # No discount for standard guests
    },
    cancellation_window_days=3,
    max_advance_booking_days=500,
)


# ---------------------------------------------------------------------------
# Guest: Alice Chen
# Loyal returning guest — has stayed 15 total nights across 3 reservations.
# ---------------------------------------------------------------------------

alice = Guest(
    guest_id="G-1001",
    name="Alice Chen",
    email="alice.chen@example.com",
    phone="555-0101",
    reservation_count=3,     # only 3 bookings, but 15 nights total
    total_nights=15,         # Gold-qualifying cumulative nights
    member_since=date(2022, 6, 1),
    preferred_room_type="deluxe",
)

# Alice: Deluxe room, Jan 15-18 (3 nights at $150/night base)
alice_booking_request = BookingRequest(
    check_in=date(2027, 1, 15),
    check_out=date(2027, 1, 18),
    room_type="deluxe",
    num_guests=2,
    special_requests="High floor preferred",
)


# ---------------------------------------------------------------------------
# Guest: Bob Martinez
# New guest — no loyalty tier, books in April.
# ---------------------------------------------------------------------------

bob = Guest(
    guest_id="G-1002",
    name="Bob Martinez",
    email="bob.martinez@example.com",
    phone="555-0102",
    reservation_count=0,
    total_nights=0,
    member_since=None,
    preferred_room_type=None,
)

# Bob: Standard room, April 10-12
bob_booking_request = BookingRequest(
    check_in=date(2027, 4, 10),
    check_out=date(2027, 4, 12),
    room_type="standard",
    num_guests=1,
    special_requests="",
)
