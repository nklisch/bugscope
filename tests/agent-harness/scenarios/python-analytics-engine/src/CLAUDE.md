# Analytics Engine

Computes business metrics from raw event streams — filtering, aggregating, transforming units, and formatting results.

## Files

- `models.py` — `Event`, `MetricQuery`, `MetricResult` data structures
- `config.py` — `load_config()` and global configuration
- `data.py` — `SAMPLE_EVENTS` and `METRIC_QUERY` for testing
- `registry.py` — metric definition registry
- `extractors.py` — field extraction from events
- `filters.py` — event filtering logic
- `transformers.py` — unit conversion and field transformation
- `aggregators.py` — aggregation functions (mean, sum, count)
- `engine.py` — `AnalyticsEngine` with `compute_metric(query, events)`
- `formatters.py` — result formatting and currency conversion
- `cache.py` — result caching
- `validators.py` — event and query validation
- `utils.py` — shared utilities
- `test_analytics.py` — test suite

## Running

```bash
python3 -m pytest test_analytics.py -v
```
