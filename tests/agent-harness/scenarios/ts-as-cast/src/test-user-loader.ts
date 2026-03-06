/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner: node --import tsx --test test-user-loader.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUserSummary, getUserTheme } from "./user-loader.ts";

// Simulates an API response for a legacy user account that predates the
// preferences system. The `data` object has all fields except `preferences`.
const legacyUserResponse = {
	status: 200,
	requestId: "req-001",
	data: {
		id: 42,
		name: "Alice Chen",
		email: "alice@example.com",
		role: "editor",
		// preferences field is absent — not all users have it
	},
};

test("getUserTheme returns the user's configured theme", () => {
	// Should return "dark" from preferences, but crashes with TypeError
	// because preferences is undefined on legacy accounts
	assert.doesNotThrow(() => {
		const theme = getUserTheme(legacyUserResponse);
		assert.equal(theme, "dark");
	});
});

test("formatUserSummary formats legacy user without crashing", () => {
	// Should fall back to defaults when preferences are absent
	const summary = formatUserSummary(legacyUserResponse);
	assert.ok(summary.includes("Alice Chen"), "summary should include user name");
	assert.ok(summary.includes("alice@example.com"), "summary should include email");
});
