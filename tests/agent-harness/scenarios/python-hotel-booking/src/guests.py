"""Guest management and loyalty tier logic for the Downtown Grand hotel.

Handles guest profile lookups and the loyalty programme tier assignment.
The tier determines the discount a guest receives on their room rate.

Loyalty tiers (based on cumulative nights stayed):
  Gold:     10+ nights
  Silver:    5+ nights
  Bronze:    2+ nights
  Standard:  fewer than 2 nights
"""

from models import Guest


# ---------------------------------------------------------------------------
# In-memory guest registry (production would use a database)
# ---------------------------------------------------------------------------

_GUEST_REGISTRY: dict[str, Guest] = {}


def register_guest(guest: Guest) -> None:
    """Add a guest to the registry."""
    _GUEST_REGISTRY[guest.guest_id] = guest


def get_guest(guest_id: str) -> Guest | None:
    """Look up a guest by their ID."""
    return _GUEST_REGISTRY.get(guest_id)


def find_guest_by_email(email: str) -> Guest | None:
    """Find a guest by their email address. Returns None if not found."""
    email_lower = email.lower()
    for guest in _GUEST_REGISTRY.values():
        if guest.email.lower() == email_lower:
            return guest
    return None


# ---------------------------------------------------------------------------
# Loyalty tier determination
# ---------------------------------------------------------------------------

def get_loyalty_tier(guest: Guest) -> str:
    """Determine the guest's loyalty tier from their stay history.

    Tiers are based on cumulative engagement with the hotel:
      Gold:     10+ stays
      Silver:    5+ stays
      Bronze:    2+ stays
      Standard:  fewer than 2 stays
    """
    engagement = guest.reservation_count
    if engagement >= 10:
        return "gold"
    elif engagement >= 5:
        return "silver"
    elif engagement >= 2:
        return "bronze"
    return "standard"


def get_tier_label(tier: str) -> str:
    """Return a display-friendly label for a loyalty tier."""
    labels = {
        "gold": "Gold Member",
        "silver": "Silver Member",
        "bronze": "Bronze Member",
        "standard": "Standard Guest",
    }
    return labels.get(tier, "Unknown")


def get_tier_benefits(tier: str) -> list[str]:
    """Return a list of benefits for the given tier."""
    base_benefits = ["Free Wi-Fi", "Late check-out (subject to availability)"]
    tier_benefits: dict[str, list[str]] = {
        "standard": [],
        "bronze": ["Early check-in (subject to availability)"],
        "silver": ["Early check-in", "Complimentary breakfast on Sundays"],
        "gold": ["Early check-in", "Complimentary breakfast daily", "Room upgrade (subject to availability)", "Welcome amenity"],
    }
    return base_benefits + tier_benefits.get(tier, [])


def update_guest_stay(guest: Guest, nights_stayed: int) -> Guest:
    """Record a completed stay, updating the guest's loyalty counters.

    Increments both the reservation count and total nights stayed.
    """
    guest.reservation_count += 1
    guest.total_nights += nights_stayed
    return guest


def format_guest_profile(guest: Guest) -> str:
    """Return a formatted guest profile summary."""
    tier = get_loyalty_tier(guest)
    lines = [
        f"Guest: {guest.name} ({guest.guest_id})",
        f"Email: {guest.email}",
        f"Phone: {guest.phone}",
        f"Loyalty tier: {get_tier_label(tier)}",
        f"Reservations: {guest.reservation_count}",
        f"Total nights: {guest.total_nights}",
    ]
    if guest.member_since:
        lines.append(f"Member since: {guest.member_since}")
    if guest.preferred_room_type:
        lines.append(f"Preferred room: {guest.preferred_room_type.title()}")
    return "\n".join(lines)
