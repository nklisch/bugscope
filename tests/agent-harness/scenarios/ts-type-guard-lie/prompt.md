The `routeNotification` function in `notification-router.ts` is routing push notifications to the wrong recipient. Notifications that should be delivered to a device token are instead using a phone number as the recipient address.

The test in `test-router.ts` demonstrates the failure. Debug this issue and fix the bug so that `test-router.ts` passes.
