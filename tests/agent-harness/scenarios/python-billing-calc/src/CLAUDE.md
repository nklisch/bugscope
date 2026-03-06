# SaaS Billing System

Generates invoices for SaaS customers based on usage records, plan tier pricing, and free allowances.

## Files

- `models.py` — `Account`, `UsageRecord`, `LineItem`, `Invoice` data structures
- `usage.py` — usage aggregation (groups sub-features like `api_calls.read` into `api_calls`)
- `pricing.py` — tier lookup and per-unit charge calculation
- `billing.py` — `generate_invoice(account, usage, period_start, period_end)`
- `test_billing.py` — test suite

## Running

```bash
python3 -m pytest test_billing.py -v
```
