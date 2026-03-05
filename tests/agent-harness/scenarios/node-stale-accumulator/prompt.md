The `dailyReport` function in `ledger.js` is producing wrong totals. Day 1 looks correct, but Day 2's count and total include Day 1's sales — as if the sales are accumulating across days instead of being tracked separately.

The test in `test-ledger.js` demonstrates the failure. Debug this issue and fix the bug so that `test-ledger.js` passes.
