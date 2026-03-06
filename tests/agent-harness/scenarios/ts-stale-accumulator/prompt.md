The `dailyReport` function in `ledger.ts` is producing inflated counts and totals. Each day's report appears to include sales from all previous days rather than just that day's sales.

The test in `test-ledger.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-ledger.ts` passes.
