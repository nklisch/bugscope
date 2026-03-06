# Order Fulfillment Pipeline

Five-stage pipeline that processes customer orders: enrichment → shipping → tax → discounts → finalization.

## Files

- `pipeline.py` — all five processing stages (`enrich_order`, `calculate_shipping`, `calculate_tax`, `apply_discounts`, `finalize_order`, `process_order`)
- `catalog.py` — product catalog, shipping rates, tax rules, and bundle promotions
- `test_pipeline.py` — test suite

## Running

```bash
python3 -m pytest test_pipeline.py -v
```
