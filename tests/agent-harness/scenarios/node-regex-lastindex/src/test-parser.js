/**
 * Visible tests for email validation utilities.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validationReport } from "./parser.js";

test("single valid email is reported as valid", () => {
	const report = validationReport([{ name: "Alice", email: "alice@example.com" }]);
	assert.equal(report.total, 1);
	assert.equal(report.valid, 1);
	assert.equal(report.invalid, 0);
});

test("single invalid email is reported as invalid", () => {
	const report = validationReport([{ name: "Broken", email: "notanemail" }]);
	assert.equal(report.total, 1);
	assert.equal(report.valid, 0);
	assert.equal(report.invalid, 1);
});

test("report has expected shape", () => {
	const report = validationReport([]);
	assert.ok("total" in report);
	assert.ok("valid" in report);
	assert.ok("invalid" in report);
	assert.ok("invalidEmails" in report);
	assert.equal(report.total, 0);
});
