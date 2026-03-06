"""Room availability and date range utilities for the Downtown Grand.

Manages date validation, night counting, and availability queries.
All date arithmetic is relative to the hotel's local timezone.
"""

from datetime import date, timedelta
from models import Room


# ---------------------------------------------------------------------------
# Date validation
# ---------------------------------------------------------------------------

def validate_date_range(check_in: date, check_out: date, max_advance_days: int = 365) -> list[str]:
    """Validate that a date range represents a legal booking window.

    Checks performed:
      - check_out must be after check_in (not same day or earlier)
      - check_in must not be in the past
      - check_in must not exceed the advance booking limit
      - stay must not exceed 30 consecutive nights

    Args:
        check_in: Proposed arrival date.
        check_out: Proposed departure date.
        max_advance_days: How far in advance bookings are accepted.

    Returns:
        A (possibly empty) list of human-readable validation error messages.
        An empty list means the range is valid.
    """
    errors: list[str] = []
    today = date.today()

    if check_out <= check_in:
        errors.append(
            f"Check-out ({check_out}) must be after check-in ({check_in})."
        )

    if check_in < today:
        errors.append(
            f"Check-in date ({check_in}) cannot be in the past."
        )

    days_ahead = (check_in - today).days
    if days_ahead > max_advance_days:
        errors.append(
            f"Check-in ({check_in}) is {days_ahead} days ahead; "
            f"maximum advance booking is {max_advance_days} days."
        )

    if (check_out - check_in).days > 30:
        errors.append(
            "Stays longer than 30 consecutive nights require a special long-stay agreement."
        )

    return errors


def count_nights(check_in: date, check_out: date) -> int:
    """Calculate the number of nights for a stay.

    The stay spans from check-in day to the day before check-out.
    A guest who checks in on the 15th and checks out on the 18th
    occupies the room for 3 nights.

    Args:
        check_in: Arrival date.
        check_out: Departure date (room vacated by 11am).

    Returns:
        Integer number of nights.
    """
    return (check_out - check_in).days + 1


def get_stay_dates(check_in: date, check_out: date) -> list[date]:
    """Return the list of calendar dates a guest occupies a room.

    The guest occupies the room on check_in and each subsequent night,
    but not on check_out (they leave that morning).

    Args:
        check_in: First night in the room.
        check_out: Departure date (not included).

    Returns:
        List of dates from check_in up to (but not including) check_out.
    """
    nights = (check_out - check_in).days
    return [check_in + timedelta(days=i) for i in range(nights)]


def check_room_available(
    room: Room,
    check_in: date,
    check_out: date,
    existing_reservations: list[tuple[date, date]] | None = None,
) -> bool:
    """Check whether a room is available for the requested dates.

    In production this would query a reservations database. Here we
    accept an optional list of (check_in, check_out) tuples representing
    existing bookings for the room and check for overlap.

    Args:
        room: The room to check.
        check_in: Requested arrival date.
        check_out: Requested departure date.
        existing_reservations: List of (in, out) tuples already booked.

    Returns:
        True if the room is free for the entire requested period.
    """
    if existing_reservations is None:
        return True

    for booked_in, booked_out in existing_reservations:
        # Overlap exists when the new stay starts before the existing one ends
        # AND the new stay ends after the existing one starts.
        if check_in < booked_out and check_out > booked_in:
            return False

    return True


def nights_until(target_date: date) -> int:
    """Return the number of nights from today until the target date."""
    return max(0, (target_date - date.today()).days)


def format_date_range(check_in: date, check_out: date) -> str:
    """Return a formatted string like 'Jan 15 – Jan 18, 2025 (3 nights)'."""
    nights = (check_out - check_in).days
    night_word = "night" if nights == 1 else "nights"
    if check_in.year == check_out.year:
        span = f"{check_in.strftime('%b %d')} \u2013 {check_out.strftime('%b %d, %Y')}"
    else:
        span = f"{check_in.strftime('%b %d, %Y')} \u2013 {check_out.strftime('%b %d, %Y')}"
    return f"{span} ({nights} {night_word})"
