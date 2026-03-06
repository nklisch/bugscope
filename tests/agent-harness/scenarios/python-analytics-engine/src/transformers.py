"""Data transformation and enrichment functions for the analytics engine.

Transformers mutate or enrich Event objects in place. They are applied
in sequence by the engine before aggregation. Each transformer returns
the modified event for pipeline chaining.
"""

from models import Event
from config import get_conversion_rate
from typing import Optional

# Module-level conversion rate used as default for normalize_revenue().
_RATE = get_conversion_rate()


def normalize_revenue(event: Event, rate: float = _RATE) -> Event:
    """Convert the event's revenue field from USD to the target currency.

    The conversion rate is applied once per event. Downstream aggregations
    will work in the target currency (e.g. EUR).

    Args:
        event: The event to normalize.
        rate: The USD-to-target-currency conversion rate.

    Returns:
        The modified event (mutated in place and returned for chaining).
    """
    if event.revenue is not None:
        event.revenue = round(event.revenue * rate, 2)
    return event


def enrich_revenue_per_unit(event: Event) -> Event:
    """Compute the derived revenue_per_unit field.

    Divides revenue by units to get a per-unit price. If units is zero,
    this event represents a free-tier transaction and the field is set
    to indicate no meaningful per-unit revenue.

    Args:
        event: The event to enrich.

    Returns:
        The modified event.
    """
    if event.revenue is None or event.units is None:
        return event

    try:
        event.revenue_per_unit = event.revenue / event.units
    except ZeroDivisionError:
        event.revenue_per_unit = 0

    return event


def extract_fields_from_metrics(event: Event) -> Event:
    """Promote raw metric dict values to typed Event fields.

    Reads 'revenue' and 'units' from event.metrics dict and assigns
    them to the dedicated Event fields used by downstream transformers.

    Args:
        event: The event to process.

    Returns:
        The modified event.
    """
    if "revenue" in event.metrics and event.revenue is None:
        event.revenue = float(event.metrics["revenue"])
    if "units" in event.metrics and event.units is None:
        raw_units = event.metrics.get("units")
        event.units = int(raw_units) if raw_units is not None else None
    return event


def apply_event_type_multiplier(event: Event, multipliers: dict[str, float]) -> Event:
    """Apply a revenue multiplier based on event type.

    Allows different event types to carry different revenue weighting.
    For example, enterprise events might be weighted at 1.2x for
    reporting purposes.

    Args:
        event: The event to transform.
        multipliers: A dict mapping event_type strings to float multipliers.

    Returns:
        The modified event.
    """
    multiplier = multipliers.get(event.event_type, 1.0)
    if event.revenue is not None and multiplier != 1.0:
        event.revenue = round(event.revenue * multiplier, 2)
    return event


def clip_revenue(event: Event, max_value: float = 1_000_000.0) -> Event:
    """Cap the event's revenue at a maximum value.

    Used to prevent outlier events from dominating aggregations.
    Events with revenue above the cap are clipped, not excluded.

    Args:
        event: The event to clip.
        max_value: The maximum allowed revenue value.

    Returns:
        The modified event.
    """
    if event.revenue is not None and event.revenue > max_value:
        event.revenue = max_value
    return event
