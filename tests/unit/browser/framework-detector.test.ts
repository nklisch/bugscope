import { describe, expect, it } from "vitest";
import { getDetectionScript } from "../../../src/browser/recorder/framework/detector.js";

describe("getDetectionScript", () => {
	it("returns empty string for empty frameworks array", () => {
		expect(getDetectionScript([])).toBe("");
	});

	it("includes React hook shim when react is in list", () => {
		const script = getDetectionScript(["react"]);
		expect(script).toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
	});

	it("does not include React hook when react is not in list", () => {
		const script = getDetectionScript(["vue"]);
		expect(script).not.toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
	});

	it("includes Vue hook shim when vue is in list", () => {
		const script = getDetectionScript(["vue"]);
		expect(script).toContain("__VUE_DEVTOOLS_GLOBAL_HOOK__");
	});

	it("does not include Vue hook when vue is not in list", () => {
		const script = getDetectionScript(["react"]);
		expect(script).not.toContain("__VUE_DEVTOOLS_GLOBAL_HOOK__");
	});

	it("includes Solid detection when solid is in list", () => {
		const script = getDetectionScript(["solid"]);
		expect(script).toContain("_$SOLID");
		expect(script).toContain("data-hk");
	});

	it("includes Svelte detection when svelte is in list", () => {
		const script = getDetectionScript(["svelte"]);
		expect(script).toContain("__svelte_meta");
	});

	it("uses only var declarations (no let/const)", () => {
		const script = getDetectionScript(["react", "vue", "solid", "svelte"]);
		// Remove string literals to avoid false positives
		const withoutStrings = script.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
		expect(withoutStrings).not.toMatch(/\blet\b/);
		expect(withoutStrings).not.toMatch(/\bconst\b/);
	});

	it("is a self-contained IIFE", () => {
		const script = getDetectionScript(["react"]);
		expect(script.trim()).toMatch(/^\(function\(\)/);
		expect(script.trim()).toMatch(/\}\)\(\);$/);
	});

	it("contains __BL__ reporting", () => {
		const script = getDetectionScript(["react"]);
		expect(script).toContain("__BL__");
	});

	it("includes framework_detect type in reports", () => {
		const script = getDetectionScript(["react"]);
		expect(script).toContain("framework_detect");
	});

	it("includes both hooks when react and vue are in list", () => {
		const script = getDetectionScript(["react", "vue"]);
		expect(script).toContain("__REACT_DEVTOOLS_GLOBAL_HOOK__");
		expect(script).toContain("__VUE_DEVTOOLS_GLOBAL_HOOK__");
	});

	describe("React shim", () => {
		it("sets supportsFiber: true", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("supportsFiber: true");
		});

		it("implements inject() that returns numeric id", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("inject: function(renderer)");
		});

		it("implements onCommitFiberRoot", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("onCommitFiberRoot");
		});

		it("implements onCommitFiberUnmount", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("onCommitFiberUnmount");
		});

		it("implements getFiberRoots", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("getFiberRoots");
		});

		it("handles pre-existing hook by patching inject", () => {
			const script = getDetectionScript(["react"]);
			expect(script).toContain("origInject");
		});
	});

	describe("Vue shim", () => {
		it("implements on/emit/off/once event emitter", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("on: function");
			expect(script).toContain("emit: function");
			expect(script).toContain("off: function");
			expect(script).toContain("once: function");
		});

		it("initializes apps Set and appRecords array", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("apps: new Set()");
			expect(script).toContain("appRecords: []");
		});

		it("sets enabled: true", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("enabled: true");
		});

		it("initializes _buffer array", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("_buffer: []");
		});

		it("installs Vue 2 setter trap on hook.Vue", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("'Vue'");
		});

		it("handles pre-existing hook by patching emit", () => {
			const script = getDetectionScript(["vue"]);
			expect(script).toContain("origEmit");
		});
	});
});
