import { describe, expect, it } from "vitest";
import { BrowserStartParamsSchema } from "../../../src/daemon/protocol.js";

describe("BrowserStartParamsSchema frameworkState", () => {
	it("accepts undefined (disabled)", () => {
		const result = BrowserStartParamsSchema.safeParse({ port: 9222, attach: false, allTabs: false });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toBeUndefined();
	});

	it("accepts true (auto-detect all)", () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: true });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toBe(true);
	});

	it("accepts false (disabled)", () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: false });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toBe(false);
	});

	it('accepts ["react"]', () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: ["react"] });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toEqual(["react"]);
	});

	it('accepts ["react", "vue"]', () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: ["react", "vue"] });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toEqual(["react", "vue"]);
	});

	it('accepts ["react", "vue", "solid", "svelte"]', () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: ["react", "vue", "solid", "svelte"] });
		expect(result.success).toBe(true);
		expect(result.data?.frameworkState).toEqual(["react", "vue", "solid", "svelte"]);
	});

	it('rejects ["angular"] — not in enum', () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: ["angular"] });
		expect(result.success).toBe(false);
	});

	it('rejects ["react", "angular"] — invalid entry in array', () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: ["react", "angular"] });
		expect(result.success).toBe(false);
	});

	it("rejects non-boolean, non-array value", () => {
		const result = BrowserStartParamsSchema.safeParse({ frameworkState: "react" });
		expect(result.success).toBe(false);
	});
});
