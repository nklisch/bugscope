"""Visible tests for the analytics engine."""

from config import load_config
from engine import AnalyticsEngine
from data import SAMPLE_EVENTS, METRIC_QUERY


def test_engine_initializes():
    """AnalyticsEngine can be constructed after config is loaded."""
    load_config()
    engine = AnalyticsEngine()
    assert engine is not None


def test_compute_metric_returns_result():
    """compute_metric returns a result object with value and event_count attributes."""
    load_config()
    engine = AnalyticsEngine()
    result = engine.compute_metric(METRIC_QUERY, SAMPLE_EVENTS)
    assert result is not None
    assert hasattr(result, "value"), "Result should have a 'value' attribute"
    assert hasattr(result, "event_count"), "Result should have an 'event_count' attribute"
    assert isinstance(result.value, (int, float)), f"value should be numeric, got {type(result.value)}"
