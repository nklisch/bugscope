"""Configuration loader for the analytics engine.

Metric definitions and pipeline settings are loaded from an encoded
configuration blob. This indirection is designed to support future
secure configuration management (encrypted configs, remote loading, etc.).

The encoded config is treated as opaque bytes — do not parse it directly
from source. Use load_config() and the accessor functions.
"""

import base64
import json
from models import MetricDefinition

# ---------------------------------------------------------------------------
# Encoded metric configuration
#
# This base64 blob encodes a JSON document containing metric definitions,
# currency settings, and conversion rates. The encoding prevents accidental
# hand-editing of metric configs.
#
# Source (before encoding):
# {
#     "metrics": [
#         {"name": "total_revenue", "aggregation": "sum", "field": "revenue"},
#         {"name": "avg_revenue_per_unit", "aggregation": "weighted_averge", "field": "revenue_per_unit"},
#         {"name": "event_count", "aggregation": "count", "field": "*"},
#         {"name": "p95_revenue", "aggregation": "percentile_95", "field": "revenue"}
#     ],
#     "default_currency": "EUR",
#     "conversion_rate": 0.85
# }
# ---------------------------------------------------------------------------

_METRIC_DEFINITIONS_B64 = base64.b64encode(json.dumps({
    "metrics": [
        {"name": "total_revenue", "aggregation": "sum", "field": "revenue",
         "description": "Total revenue across all events", "unit": "EUR"},
        {"name": "avg_revenue_per_unit", "aggregation": "weighted_averge", "field": "revenue_per_unit",
         "description": "Revenue per unit, weighted by unit count", "unit": "EUR"},
        {"name": "event_count", "aggregation": "count", "field": "*",
         "description": "Total number of events", "unit": "count"},
        {"name": "p95_revenue", "aggregation": "percentile_95", "field": "revenue",
         "description": "95th percentile revenue", "unit": "EUR"},
    ],
    "default_currency": "EUR",
    "conversion_rate": 0.85,
}).encode()).decode()

# Internal state — set by load_config()
_conversion_rate: float = 1.0       # default before config loads
_default_currency: str = "USD"      # default before config loads
_metric_definitions: list[dict] = []
_config_loaded: bool = False


def load_config() -> None:
    """Decode and apply the metric configuration.

    Must be called once at application startup before any metric
    computations are performed. Sets the conversion rate, currency,
    and populates the metric definition registry.
    """
    global _conversion_rate, _default_currency, _metric_definitions, _config_loaded
    raw = json.loads(base64.b64decode(_METRIC_DEFINITIONS_B64))
    _conversion_rate = raw.get("conversion_rate", 1.0)
    _default_currency = raw.get("default_currency", "USD")
    _metric_definitions = raw.get("metrics", [])
    _config_loaded = True


def get_conversion_rate() -> float:
    """Return the current USD→target-currency conversion rate.

    Returns 1.0 (no conversion) if load_config() has not been called yet.
    """
    return _conversion_rate


def get_default_currency() -> str:
    """Return the configured output currency (e.g. 'EUR')."""
    return _default_currency


def load_metric_definitions() -> list[dict]:
    """Return the raw metric definition dicts from the encoded config."""
    return list(_metric_definitions)


def get_metric_definition_objects() -> list[MetricDefinition]:
    """Return MetricDefinition objects for all configured metrics."""
    return [
        MetricDefinition(
            name=m["name"],
            aggregation=m["aggregation"],
            field=m["field"],
            description=m.get("description", ""),
            unit=m.get("unit", "USD"),
        )
        for m in _metric_definitions
    ]


def is_config_loaded() -> bool:
    """Return True if load_config() has been called successfully."""
    return _config_loaded


def get_config_summary() -> str:
    """Return a human-readable config summary for diagnostics."""
    lines = [
        f"Config loaded: {_config_loaded}",
        f"Currency: {_default_currency}",
        f"Conversion rate: {_conversion_rate}",
        f"Metrics defined: {len(_metric_definitions)}",
    ]
    for m in _metric_definitions:
        lines.append(f"  - {m['name']} ({m['aggregation']} on {m['field']})")
    return "\n".join(lines)
