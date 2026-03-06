/**
 * Visible tests for the expense tracker.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_EXPENSES, BUDGETS } from "./data.js";
import { generateMonthlyReport } from "./reports.js";
import { generateBudgetReport } from "./budgets.js";

test("generateMonthlyReport returns an object with total and categories", () => {
	const report = generateMonthlyReport(ALL_EXPENSES, 2024, 0);
	assert.ok(report, "report should be defined");
	assert.ok(typeof report.total === "number", "report.total should be a number");
	assert.ok(report.categories !== null && typeof report.categories === "object", "report.categories should be an object");
	assert.ok(typeof report.count === "number", "report.count should be a number");
});

test("generateBudgetReport returns items array", () => {
	const report = generateMonthlyReport(ALL_EXPENSES, 2024, 0);
	const budgetReport = generateBudgetReport(report.categories, BUDGETS);
	assert.ok(Array.isArray(budgetReport.items), "budgetReport.items should be an array");
});
