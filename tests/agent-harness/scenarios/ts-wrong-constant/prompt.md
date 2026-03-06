The `generateInvoice` function in `pricing.ts` is producing a subtotal of $0.00 for gold-tier customers. They should receive a 10% discount, but instead they're getting everything for free.

The test in `test-pricing.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-pricing.ts` passes.
