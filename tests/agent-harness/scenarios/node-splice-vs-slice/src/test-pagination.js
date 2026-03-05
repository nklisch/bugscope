/**
 * Visible failing test — agent can see and run this.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate, paginateAll } from "./pagination.js";

test("paginate does not mutate source array", () => {
	const items = [1, 2, 3, 4, 5];
	const original = [...items];
	paginate(items, 1, 3);
	assert.deepEqual(items, original, `Source array was mutated: ${JSON.stringify(items)}`);
});

test("totalItems reflects full array length", () => {
	const items = [1, 2, 3, 4, 5];
	const result = paginate(items, 1, 3);
	assert.equal(result.totalItems, 5, `Expected totalItems=5, got ${result.totalItems}`);
});

test("paginateAll returns all items across pages", () => {
	const items = [1, 2, 3, 4, 5, 6, 7];
	const pages = paginateAll(items, 3);
	const allItems = pages.flatMap(p => p.items);
	assert.deepEqual(allItems, [1, 2, 3, 4, 5, 6, 7], `Got: ${JSON.stringify(allItems)}`);
});
