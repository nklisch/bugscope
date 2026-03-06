The `initService` function in `merge-configs.ts` is reporting `configVersion: "unknown"` and missing feature flags when initialized with a version 0 configuration. Version 0 is a valid legacy mode setting, but the function treats it as if no version was provided.

The test in `test-service.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-service.ts` passes.
