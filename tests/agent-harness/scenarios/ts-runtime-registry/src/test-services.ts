/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-services.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "./container.ts";
import { cacheKey, rateLimiterKey } from "./services.ts";

test("CacheService resolves without error", () => {
	assert.doesNotThrow(() => {
		resolve(cacheKey);
	}, "CacheService should resolve successfully");
});

test("RateLimiter resolves without error", () => {
	// This throws: "Service not found: CacheService:<hash-of-primary>"
	// The error message contains a hash-computed key — you need to evaluate
	// computeKey("CacheService", "primary") at runtime to see the mismatch
	assert.doesNotThrow(() => {
		resolve(rateLimiterKey);
	}, "RateLimiter should resolve (including its CacheService dependency)");
});
