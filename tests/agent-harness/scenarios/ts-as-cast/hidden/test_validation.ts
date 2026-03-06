/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner: node --import tsx --test test_validation.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUserSummary, getUserDisplayName, getUserTheme } from "./user-loader.ts";

const fullUserResponse = {
	status: 200,
	requestId: "req-full",
	data: {
		id: 1,
		name: "Bob Smith",
		email: "bob@example.com",
		role: "admin",
		preferences: {
			theme: "dark",
			notifications: true,
			language: "en",
		},
	},
};

const legacyUserResponse = {
	status: 200,
	requestId: "req-legacy",
	data: {
		id: 42,
		name: "Alice Chen",
		email: "alice@example.com",
		role: "editor",
		// no preferences field
	},
};

test("getUserTheme returns correct theme for user with preferences", () => {
	const theme = getUserTheme(fullUserResponse);
	assert.equal(theme, "dark");
});

test("getUserTheme does not throw for legacy user without preferences", () => {
	assert.doesNotThrow(() => getUserTheme(legacyUserResponse));
});

test("formatUserSummary includes user name and email", () => {
	const summary = formatUserSummary(fullUserResponse);
	assert.ok(summary.includes("Bob Smith"), "summary should include name");
	assert.ok(summary.includes("bob@example.com"), "summary should include email");
});

test("formatUserSummary includes preference values for full user", () => {
	const summary = formatUserSummary(fullUserResponse);
	assert.ok(summary.includes("dark"), "summary should include theme");
	assert.ok(summary.includes("on"), "summary should indicate notifications on");
});

test("formatUserSummary does not crash for legacy user", () => {
	assert.doesNotThrow(() => formatUserSummary(legacyUserResponse));
});

test("formatUserSummary falls back to defaults for legacy user", () => {
	const summary = formatUserSummary(legacyUserResponse);
	assert.ok(summary.includes("Alice Chen"), "summary should include name");
	assert.ok(summary.includes("alice@example.com"), "summary should include email");
});

test("getUserDisplayName returns name with role", () => {
	const name = getUserDisplayName(fullUserResponse);
	assert.ok(name.includes("Bob Smith"), "display name should include name");
	assert.ok(name.includes("admin"), "display name should include role");
});

test("getUserDisplayName does not crash for legacy user", () => {
	assert.doesNotThrow(() => getUserDisplayName(legacyUserResponse));
});
