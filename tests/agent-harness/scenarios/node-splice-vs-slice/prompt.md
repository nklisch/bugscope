The `paginate` function in `pagination.js` is behaving incorrectly. The first page returns the right items, but `totalItems` is wrong, and calling `paginateAll` returns fewer pages than expected with items missing.

The test in `test-pagination.js` demonstrates the failure. Debug this issue and fix the bug so that `test-pagination.js` passes.
