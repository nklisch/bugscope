import { describe, expect, it } from "vitest";
import { jestDetector, mochaDetector } from "../../../src/frameworks/node.js";

describe("jestDetector", () => {
	it("detects 'jest tests/'", () => {
		const result = jestDetector.detect("jest tests/", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("jest");
	});

	it("detects 'npx jest tests/'", () => {
		const result = jestDetector.detect("npx jest tests/", "/p");
		expect(result).not.toBeNull();
	});

	it("detects 'bunx jest tests/'", () => {
		const result = jestDetector.detect("bunx jest tests/", "/p");
		expect(result).not.toBeNull();
	});

	it("detects 'node_modules/.bin/jest tests/'", () => {
		const result = jestDetector.detect("node_modules/.bin/jest tests/", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'node app.js'", () => {
		expect(jestDetector.detect("node app.js", "/p")).toBeNull();
	});

	it("injects --runInBand into command", () => {
		const result = jestDetector.detect("jest tests/", "/p");
		expect(result!.command).toContain("--runInBand");
	});

	it("does not double-add --runInBand", () => {
		const result = jestDetector.detect("jest --runInBand tests/", "/p");
		const cmd = result!.command ?? "jest --runInBand tests/";
		const count = cmd.split("--runInBand").length - 1;
		expect(count).toBe(1);
	});

	it("does not add --runInBand when -i present", () => {
		const result = jestDetector.detect("jest -i tests/", "/p");
		expect(result!.command).toBeUndefined();
	});

	it("preserves flags after jest when injecting --runInBand", () => {
		const result = jestDetector.detect("npx jest --coverage tests/", "/p");
		expect(result!.command).toContain("--runInBand");
		expect(result!.command).toContain("--coverage");
	});
});

describe("mochaDetector", () => {
	it("detects 'mocha tests/'", () => {
		const result = mochaDetector.detect("mocha tests/", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("mocha");
	});

	it("detects 'npx mocha tests/'", () => {
		const result = mochaDetector.detect("npx mocha tests/", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'node mocha-helper.js'", () => {
		expect(mochaDetector.detect("node mocha-helper.js", "/p")).toBeNull();
	});

	it("returns no command modification", () => {
		const result = mochaDetector.detect("mocha tests/", "/p");
		expect(result!.command).toBeUndefined();
	});

	it("detects 'npx mocha --reporter dot'", () => {
		const result = mochaDetector.detect("npx mocha --reporter dot", "/p");
		expect(result).not.toBeNull();
	});
});
