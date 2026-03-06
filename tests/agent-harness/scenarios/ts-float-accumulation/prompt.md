The `splitBill` function in `bill.ts` is producing rounded share totals that don't match the total bill amount. For certain inputs, the sum of all individual shares is off by a cent from the expected total.

The test in `test-bill.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-bill.ts` passes.
