/**
 * Visible tests for the transaction processing pipeline.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { runPipeline } from "./pipeline.js";

test("pipeline returns result with expected shape", () => {
	const result = runPipeline();
	assert.ok(result, "runPipeline() should return a result");
	assert.ok(typeof result.total === "number", `result.total should be a number, got ${typeof result.total}`);
	assert.ok(typeof result.recordCount === "number", `result.recordCount should be a number, got ${typeof result.recordCount}`);
	assert.ok(result.monthly !== null && typeof result.monthly === "object", "result.monthly should be an object");
});

test("pipeline produces some monthly data", () => {
	const result = runPipeline();
	const monthCount = Object.keys(result.monthly).length;
	assert.ok(monthCount > 0, `Expected at least one month of data, got ${monthCount} months`);
});
