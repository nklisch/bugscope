# Service Container

Hash-based dependency injection container with singleton support.

## Files

- `container.ts` — `computeKey(name, variant)`, `register(name, variant, factory, options)`, `resolve(key)`, `isRegistered(key)`, `listRegistered()`
- `services.ts` — service registrations: Logger, MetricsCollector, CacheService, RateLimiter
- `test-services.ts` — test suite

## Running

```bash
npx tsx --test test-services.ts
```
