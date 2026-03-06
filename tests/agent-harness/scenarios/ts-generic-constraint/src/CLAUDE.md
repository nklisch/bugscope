# Service Config Management

Merges layered configuration objects and initializes service metadata including version tags and feature flags.

## Files

- `merge-configs.ts` — `mergeConfigs(base, overrides)` and `initService(base, overrides)` with `BaseConfig`, `CacheConfig`, `RetryConfig` types
- `test-service.ts` — test suite

## Running

```bash
npx tsx --test test-service.ts
```
