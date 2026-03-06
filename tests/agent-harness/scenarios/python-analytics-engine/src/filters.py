"""Event filtering functions for the analytics engine.

Filters reduce the event set before aggregation. All filters are
pure functions that return a new list without mutating events.
"""

from datetime import datetime
from typing import Any

from models import Event


def filter_by_dimensions(events: list[Event], predicates: dict[str, Any]) -> list[Event]:
    """Filter events matching all dimension predicates.

    Each entry in predicates must match the corresponding value in
    event.dimensions for the event to be included. All predicates
    must match (logical AND).

    Args:
        events: The full event list to filter.
        predicates: A dict of {dimension_name: expected_value} pairs.

    Returns:
        Events where all predicates match.
    """
    if not predicates:
        return list(events)

    result = []
    for event in events:
        match = True
        for dim_name, expected_value in predicates.items():
            actual_value = event.dimensions.get(dim_name)
            if actual_value != expected_value:
                match = False
                break
        if match:
            result.append(event)
    return result


def filter_by_time_range(
    events: list[Event],
    start: datetime | None,
    end: datetime | None,
) -> list[Event]:
    """Filter events to those within a time range (inclusive on both ends).

    Args:
        events: Events to filter.
        start: Earliest allowed timestamp (None = no lower bound).
        end: Latest allowed timestamp (None = no upper bound).

    Returns:
        Events whose timestamp falls within [start, end].
    """
    result = []
    for event in events:
        if start is not None and event.timestamp < start:
            continue
        if end is not None and event.timestamp > end:
            continue
        result.append(event)
    return result


def filter_by_event_type(events: list[Event], event_types: list[str]) -> list[Event]:
    """Return only events whose event_type is in the given list.

    Args:
        events: Events to filter.
        event_types: Allowed event type strings.

    Returns:
        Events with matching event_type.
    """
    type_set = set(event_types)
    return [e for e in events if e.event_type in type_set]


def filter_out_incomplete(events: list[Event]) -> list[Event]:
    """Remove events that are missing required numeric fields.

    Events without a revenue value are excluded from revenue metrics.
    Events without a units value are excluded from unit-based metrics.

    Args:
        events: Events to filter.

    Returns:
        Events with both revenue and units fields populated.
    """
    return [e for e in events if e.revenue is not None and e.units is not None]


def apply_query_filters(
    events: list[Event],
    dimension_predicates: dict[str, Any],
    time_range: tuple[datetime, datetime] | None = None,
) -> list[Event]:
    """Apply all applicable query filters to the event list.

    Convenience function that chains time range and dimension filters.

    Args:
        events: The full event set.
        dimension_predicates: Dimension equality predicates.
        time_range: Optional (start, end) datetime tuple.

    Returns:
        Filtered event list.
    """
    filtered = list(events)

    if time_range is not None:
        start, end = time_range
        filtered = filter_by_time_range(filtered, start, end)

    if dimension_predicates:
        filtered = filter_by_dimensions(filtered, dimension_predicates)

    return filtered
