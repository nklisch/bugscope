/**
 * Visible tests for the service container.
 * Uses Node.js built-in test runner: node --import tsx --test test-services.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "./container.ts";
import { cacheKey, loggerKey, metricsKey } from "./services.ts";

test("Logger resolves without error", () => {
	assert.doesNotThrow(() => {
		resolve(loggerKey);
	}, "Logger should resolve successfully");
});

test("MetricsCollector resolves without error", () => {
	assert.doesNotThrow(() => {
		resolve(metricsKey);
	}, "MetricsCollector should resolve successfully");
});

test("CacheService resolves without error", () => {
	assert.doesNotThrow(() => {
		resolve(cacheKey);
	}, "CacheService should resolve successfully");
});
