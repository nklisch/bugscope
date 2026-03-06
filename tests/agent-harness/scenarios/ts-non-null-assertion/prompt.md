The `checkReorderNeeds` function in `inventory.ts` is crashing with a TypeError when called with a list of SKUs to check. Some SKUs in the check list may not exist in the inventory, but the function doesn't handle that case.

The test in `test-inventory.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-inventory.ts` passes.
