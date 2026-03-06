"""Aggregation function registry for the analytics engine.

Maps aggregation function names (as used in metric definitions) to
their callable implementations. If a metric definition references an
unknown aggregation name, the registry falls back to agg_sum.
"""

from aggregators import agg_sum, agg_count, agg_mean, agg_weighted_average, agg_p95
from typing import Callable


# ---------------------------------------------------------------------------
# Registry of available aggregation functions
# ---------------------------------------------------------------------------

AGGREGATION_FUNCTIONS: dict[str, Callable] = {
    "sum": agg_sum,
    "count": agg_count,
    "mean": agg_mean,
    "weighted_average": agg_weighted_average,   # correct spelling
    "percentile_95": agg_p95,
}


def get_aggregation_fn(name: str) -> Callable:
    """Look up an aggregation function by name.

    Falls back to agg_sum for unrecognized aggregation names.

    Args:
        name: The aggregation function name from the metric definition.

    Returns:
        The callable aggregation function.
    """
    return AGGREGATION_FUNCTIONS.get(name, agg_sum)


def is_valid_aggregation(name: str) -> bool:
    """Return True if the aggregation name is registered."""
    return name in AGGREGATION_FUNCTIONS


def list_aggregations() -> list[str]:
    """Return the names of all registered aggregation functions."""
    return sorted(AGGREGATION_FUNCTIONS.keys())


def register_aggregation(name: str, fn: Callable) -> None:
    """Register a custom aggregation function.

    Allows downstream consumers to extend the registry with
    domain-specific aggregation logic.

    Args:
        name: The key to register (must not conflict with built-ins).
        fn: A callable that accepts (values: list[float], weights: list[float]) -> float.
    """
    if name in AGGREGATION_FUNCTIONS:
        raise ValueError(f"Aggregation {name!r} is already registered. Use a unique name.")
    AGGREGATION_FUNCTIONS[name] = fn
