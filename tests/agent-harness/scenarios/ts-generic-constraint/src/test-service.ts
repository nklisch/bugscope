/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-service.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { initService } from "./merge-configs.ts";

const defaultConfig = {
	version: 2,
	enabled: true,
	ttlSeconds: 3600,
	maxEntries: 1000,
	strategy: "lru" as const,
};

test("configVersion is v0 when version override is 0 (legacy mode)", () => {
	// Version 0 means "use legacy compatibility mode" — it's explicitly set, not absent.
	// The service should produce configVersion "v0", not "unknown".
	const result = initService(defaultConfig, [{ version: 0 }]);
	assert.equal(
		result.configVersion,
		"v0",
		`Expected configVersion "v0" for version 0 override, got "${result.configVersion}"`,
	);
});

test("version 0 config evaluates feature flags against version 0", () => {
	const result = initService(defaultConfig, [{ version: 0 }]);
	// version 0 is not >= 2, so "advanced" should not be included
	assert.ok(!result.features.includes("advanced"), `"advanced" should not be enabled for v0`);
});
