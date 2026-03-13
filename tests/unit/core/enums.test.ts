import { describe, expect, it } from "vitest";
import {
	DIFF_INCLUDES,
	EVENT_TYPES,
	FRAMEWORKS,
	INSPECT_INCLUDES,
	OVERVIEW_INCLUDES,
	SEARCHABLE_EVENT_TYPES,
	SESSION_STATES,
	SESSION_STATUSES,
	STEP_DIRECTIONS,
} from "../../../src/core/enums.js";

describe("enums — single source of truth", () => {
	it("SESSION_STATES is a superset of SESSION_STATUSES", () => {
		for (const status of SESSION_STATUSES) {
			expect(SESSION_STATES).toContain(status);
		}
		expect(SESSION_STATES).toContain("launching");
	});

	it("SEARCHABLE_EVENT_TYPES is a subset of EVENT_TYPES", () => {
		for (const type of SEARCHABLE_EVENT_TYPES) {
			expect(EVENT_TYPES).toContain(type);
		}
	});

	it("all include enums have non-empty tuples", () => {
		expect(OVERVIEW_INCLUDES.length).toBeGreaterThan(0);
		expect(INSPECT_INCLUDES.length).toBeGreaterThan(0);
		expect(DIFF_INCLUDES.length).toBeGreaterThan(0);
	});

	it("FRAMEWORKS contains the four supported frameworks", () => {
		expect(FRAMEWORKS).toEqual(["react", "vue", "solid", "svelte"]);
	});

	it("STEP_DIRECTIONS contains over, into, out", () => {
		expect(STEP_DIRECTIONS).toEqual(["over", "into", "out"]);
	});

	it("OVERVIEW_INCLUDES contains 'framework'", () => {
		expect(OVERVIEW_INCLUDES).toContain("framework");
	});

	it("DIFF_INCLUDES contains 'framework_state'", () => {
		expect(DIFF_INCLUDES).toContain("framework_state");
	});
});
