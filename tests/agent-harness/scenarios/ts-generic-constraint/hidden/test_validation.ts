/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { initService, mergeConfigs } from "./merge-configs.ts";

const base = {
	version: 1,
	enabled: true,
	ttlSeconds: 3600,
	maxEntries: 1000,
	strategy: "lru" as const,
};

test("version 1 gives configVersion v1", () => {
	const result = initService(base, []);
	assert.equal(result.configVersion, "v1");
});

test("version 2 gives configVersion v2", () => {
	const result = initService(base, [{ version: 2 }]);
	assert.equal(result.configVersion, "v2");
});

test("version 0 gives configVersion v0, not unknown", () => {
	const result = initService(base, [{ version: 0 }]);
	assert.equal(result.configVersion, "v0");
});

test("version 0 does not have advanced feature", () => {
	const result = initService(base, [{ version: 0 }]);
	assert.ok(!result.features.includes("advanced"));
});

test("version 0 does not have experimental feature", () => {
	const result = initService(base, [{ version: 0 }]);
	assert.ok(!result.features.includes("experimental"));
});

test("version 2 has advanced feature", () => {
	const result = initService(base, [{ version: 2 }]);
	assert.ok(result.features.includes("advanced"));
	assert.ok(!result.features.includes("experimental"));
});

test("version 3 has advanced and experimental features", () => {
	const result = initService(base, [{ version: 3 }]);
	assert.ok(result.features.includes("advanced"));
	assert.ok(result.features.includes("experimental"));
});

test("enabled: true includes core feature", () => {
	const result = initService(base, []);
	assert.ok(result.features.includes("core"));
});

test("enabled: false excludes core feature", () => {
	const result = initService(base, [{ enabled: false }]);
	assert.ok(!result.features.includes("core"));
});

test("mergeConfigs applies overrides in order", () => {
	const merged = mergeConfigs(base, [{ version: 5 }, { version: 0 }]);
	assert.equal(merged.version, 0);
});

test("mergeConfigs ignores undefined override values", () => {
	const merged = mergeConfigs(base, [{ version: undefined }]);
	assert.equal(merged.version, 1);
});
