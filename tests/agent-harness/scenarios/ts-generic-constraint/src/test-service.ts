/**
 * Visible tests for the service config management utilities.
 * Uses Node.js built-in test runner: node --import tsx --test test-service.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CacheConfig } from "./merge-configs.ts";
import { initService } from "./merge-configs.ts";

const defaultConfig: CacheConfig = {
	version: 2,
	enabled: true,
	ttlSeconds: 3600,
	maxEntries: 1000,
	strategy: "lru",
};

test("configVersion is v2 for version 2 config", () => {
	const result = initService(defaultConfig, []);
	assert.equal(result.configVersion, "v2", `Expected "v2", got "${result.configVersion}"`);
});

test("version 2 config enables advanced features", () => {
	const result = initService(defaultConfig, []);
	assert.ok(result.features.includes("advanced"), `Expected "advanced" in features for v2, got ${JSON.stringify(result.features)}`);
});

test("version 3 config enables experimental features", () => {
	const result = initService(defaultConfig, [{ version: 3 }]);
	assert.ok(result.features.includes("experimental"), `Expected "experimental" in features for v3, got ${JSON.stringify(result.features)}`);
});
