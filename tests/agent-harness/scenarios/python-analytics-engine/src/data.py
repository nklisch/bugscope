"""Sample event data for the analytics engine test suite.

10 events representing business transactions across two regions.

Event structure:
  - dimensions: {"region": str, "priority": int}
  - metrics: {"revenue": float (USD), "units": int}
"""

from datetime import datetime
from extractors import extract_from_dict


# ---------------------------------------------------------------------------
# Sample events
# 8 in "east" region (4 with priority=1, 4 with priority=2)
# 2 in "west" region
# 1 east event has units=0 (free-tier transaction)
# ---------------------------------------------------------------------------

_RAW_EVENTS = [
    # East region, priority=1 (int)
    {
        "event_id": "E001",
        "timestamp": "2026-06-01T10:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 1},
        "metrics": {"revenue": 20.0, "units": 2},
    },
    {
        "event_id": "E002",
        "timestamp": "2026-06-01T11:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 1},
        "metrics": {"revenue": 30.0, "units": 3},
    },
    {
        "event_id": "E003",
        "timestamp": "2026-06-01T12:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 1},
        "metrics": {"revenue": 12.0, "units": 1},
    },
    {
        "event_id": "E004",
        "timestamp": "2026-06-01T13:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 1},
        "metrics": {"revenue": 24.0, "units": 2},
    },
    # East region, priority=2 (int)
    {
        "event_id": "E005",
        "timestamp": "2026-06-01T14:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 2},
        "metrics": {"revenue": 18.0, "units": 2},
    },
    {
        "event_id": "E006",
        "timestamp": "2026-06-01T15:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 2},
        "metrics": {"revenue": 40.0, "units": 4},
    },
    {
        "event_id": "E007",
        "timestamp": "2026-06-01T16:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "east", "priority": 2},
        "metrics": {"revenue": 25.0, "units": 5},
    },
    # East region, priority=1, units=0 (free-tier event)
    {
        "event_id": "E008",
        "timestamp": "2026-06-01T17:00:00",
        "event_type": "trial",
        "dimensions": {"region": "east", "priority": 1},
        "metrics": {"revenue": 0.0, "units": 0},
    },
    # West region
    {
        "event_id": "E009",
        "timestamp": "2026-06-01T18:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "west", "priority": 1},
        "metrics": {"revenue": 50.0, "units": 5},
    },
    {
        "event_id": "E010",
        "timestamp": "2026-06-01T19:00:00",
        "event_type": "purchase",
        "dimensions": {"region": "west", "priority": 2},
        "metrics": {"revenue": 35.0, "units": 3},
    },
]

SAMPLE_EVENTS = [extract_from_dict(r) for r in _RAW_EVENTS]

# ---------------------------------------------------------------------------
# Query: avg_revenue_per_unit for east region, priority=1
# ---------------------------------------------------------------------------

from models import Query

METRIC_QUERY = Query(
    metric_name="avg_revenue_per_unit",
    filters={"region": "east", "priority": "1"},
)

# Priority-filtered query for event counting.
PRIORITY_QUERY = Query(
    metric_name="event_count",
    filters={"region": "east", "priority": "1"},
)
