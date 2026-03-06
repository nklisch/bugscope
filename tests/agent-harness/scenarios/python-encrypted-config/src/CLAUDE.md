# Service Config Loader

Loads and merges configuration from three sources (defaults, config file, environment variables) with a defined priority order, then initializes a service descriptor.

## Files

- `config.py` — `load_config`, `init_service`, transform registry for rate limits, TTLs, feature flags, etc.
- `test_config.py` — test suite

## Running

```bash
python3 -m pytest test_config.py -v
```
