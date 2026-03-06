The analytics pipeline in `pipeline.ts` is reporting incorrect revenue totals for purchase events. The total revenue figure is wildly off from the expected sum of all purchase amounts.

The pipeline processes events from multiple sources through a schema validation and enrichment stage before aggregating metrics. The visible test in `test-pipeline.ts` demonstrates the discrepancy. Debug this issue and fix the bug so that `test-pipeline.ts` passes.
