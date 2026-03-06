/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeKey, isRegistered, resolve } from "./container.ts";
import { cacheKey, loggerKey, metricsKey, rateLimiterKey } from "./services.ts";

test("Logger resolves without error", () => {
	assert.doesNotThrow(() => resolve(loggerKey));
});

test("MetricsCollector resolves without error", () => {
	assert.doesNotThrow(() => resolve(metricsKey));
});

test("CacheService resolves without error", () => {
	assert.doesNotThrow(() => resolve(cacheKey));
});

test("RateLimiter resolves without error", () => {
	assert.doesNotThrow(() => resolve(rateLimiterKey));
});

test("CacheService dependency key matches what RateLimiter depends on", () => {
	// After fix: the key declared in RateLimiter's dependency list should
	// match what CacheService was registered with
	assert.ok(
		isRegistered(cacheKey),
		`CacheService should be registered at key: ${cacheKey}`,
	);
});

test("RateLimiter instance has check method", () => {
	const limiter = resolve<{ check: (id: string) => boolean; reset: (id: string) => void }>(rateLimiterKey);
	assert.equal(typeof limiter.check, "function");
	assert.equal(typeof limiter.reset, "function");
});

test("RateLimiter check returns boolean", () => {
	const limiter = resolve<{ check: (id: string) => boolean }>(rateLimiterKey);
	const result = limiter.check("client-001");
	assert.equal(typeof result, "boolean");
});

test("CacheService is a singleton — same instance returned each time", () => {
	const a = resolve(cacheKey);
	const b = resolve(cacheKey);
	assert.strictEqual(a, b, "singleton services should return the same instance");
});

test("computeKey is deterministic", () => {
	const k1 = computeKey("CacheService", "shared");
	const k2 = computeKey("CacheService", "shared");
	assert.equal(k1, k2);
});

test("computeKey differs for different variants", () => {
	const sharedKey = computeKey("CacheService", "shared");
	const primaryKey = computeKey("CacheService", "primary");
	assert.notEqual(sharedKey, primaryKey, "different variants should produce different keys");
});
