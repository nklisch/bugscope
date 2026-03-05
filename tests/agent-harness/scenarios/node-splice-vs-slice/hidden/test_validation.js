/**
 * Hidden oracle tests — copied into workspace after agent finishes.
 * Uses Node.js built-in test runner (node --test).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { paginate, paginateAll, pageCount } from "./pagination.js";

test("paginate does not mutate source array", () => {
	const items = [1, 2, 3, 4, 5];
	const copy = [...items];
	paginate(items, 1, 3);
	assert.deepEqual(items, copy, "source array was mutated");
});

test("first page returns correct items", () => {
	const items = [1, 2, 3, 4, 5];
	const result = paginate(items, 1, 3);
	assert.deepEqual(result.items, [1, 2, 3]);
});

test("second page returns correct items", () => {
	const items = [1, 2, 3, 4, 5];
	const result = paginate(items, 2, 3);
	assert.deepEqual(result.items, [4, 5]);
});

test("totalItems equals original array length", () => {
	const items = [1, 2, 3, 4, 5];
	const result = paginate(items, 1, 3);
	assert.equal(result.totalItems, 5);
});

test("totalPages is correct", () => {
	const items = [1, 2, 3, 4, 5, 6, 7];
	const result = paginate(items, 1, 3);
	assert.equal(result.totalPages, 3);
});

test("paginateAll returns all pages", () => {
	const items = [1, 2, 3, 4, 5, 6, 7];
	const pages = paginateAll(items, 3);
	assert.equal(pages.length, 3);
});

test("paginateAll contains every item exactly once", () => {
	const items = [10, 20, 30, 40, 50];
	const pages = paginateAll(items, 2);
	const allItems = pages.flatMap(p => p.items);
	assert.deepEqual(allItems, [10, 20, 30, 40, 50]);
});

test("pageCount utility is correct", () => {
	assert.equal(pageCount([1, 2, 3, 4, 5], 2), 3);
	assert.equal(pageCount([1, 2, 3, 4], 2), 2);
	assert.equal(pageCount([], 3), 0);
});

test("regression: splice not slice — multiple paginate calls on same array work", () => {
	const items = [1, 2, 3, 4, 5];
	const p1 = paginate(items, 1, 3);
	const p2 = paginate(items, 2, 3);
	assert.deepEqual(p1.items, [1, 2, 3], `page 1: ${JSON.stringify(p1.items)}`);
	assert.deepEqual(p2.items, [4, 5], `page 2: ${JSON.stringify(p2.items)}`);
});
