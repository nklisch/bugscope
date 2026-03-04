import { describe, expect, it } from "vitest";
import { goTestDetector } from "../../../src/frameworks/go.js";

describe("goTestDetector", () => {
	it("detects 'go test ./...'", () => {
		const result = goTestDetector.detect("go test ./...", "/p");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("gotest");
	});

	it("detects 'go test -v ./pkg/...'", () => {
		const result = goTestDetector.detect("go test -v ./pkg/...", "/p");
		expect(result).not.toBeNull();
	});

	it("does not detect 'go run main.go'", () => {
		expect(goTestDetector.detect("go run main.go", "/p")).toBeNull();
	});

	it("does not detect './mybinary'", () => {
		expect(goTestDetector.detect("./mybinary", "/p")).toBeNull();
	});

	it("warns about test caching when -count not present", () => {
		const result = goTestDetector.detect("go test ./...", "/p");
		expect(result!.warnings.length).toBeGreaterThan(0);
		expect(result!.warnings[0]).toContain("-count=1");
	});

	it("no caching warning when -count=1 present", () => {
		const result = goTestDetector.detect("go test -count=1 ./...", "/p");
		expect(result!.warnings).toHaveLength(0);
	});

	it("no caching warning when -count with space present", () => {
		const result = goTestDetector.detect("go test -count 1 ./...", "/p");
		expect(result!.warnings).toHaveLength(0);
	});
});
