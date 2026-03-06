The `processBatch` function in `transaction-processor.ts` is returning an incorrect total amount when processing records from a mix of API sources. The total is either wrong or the report generation is failing entirely.

The test in `test-processor.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-processor.ts` passes.
