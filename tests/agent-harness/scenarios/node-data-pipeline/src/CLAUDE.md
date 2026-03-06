# Transaction Processing Pipeline

Parses, transforms, and aggregates financial transaction records into monthly revenue summaries.

## Files

- `parser.js` — raw transaction data and parsing
- `transform.js` — business transforms (date normalization, amount conversion)
- `aggregate.js` — monthly grouping and revenue summation
- `pipeline.js` — `runPipeline()` orchestration
- `test-pipeline.js` — test suite

## Running

```bash
node --test test-pipeline.js
```
