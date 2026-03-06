# Analytics Event Pipeline

Processes raw analytics events through validation, enrichment, aggregation, and reporting stages.

## Files

- `event-schemas.ts` — schema registry with field definitions and transforms (e.g. cents→dollars for purchase revenue)
- `pipeline.ts` — `runPipeline(events)` with four stages: validate → enrich → aggregate → report
- `test-pipeline.ts` — test suite

## Running

```bash
npx tsx --test test-pipeline.ts
```
