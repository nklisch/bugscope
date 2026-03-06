"""Visible tests for the hotel booking system."""

import pytest
from reservations import create_reservation
from data import alice, alice_booking_request, hotel_config


def test_reservation_has_expected_attributes():
    """create_reservation returns an object with required pricing attributes."""
    reservation = create_reservation(alice, alice_booking_request, hotel_config)
    assert hasattr(reservation, "total")
    assert hasattr(reservation, "nightly_rate")
    assert hasattr(reservation, "subtotal")
    assert hasattr(reservation, "tax")
    assert isinstance(reservation.total, (int, float))
