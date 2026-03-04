import { beforeAll, describe, expect, it } from "vitest";
import { detectFramework, registerAllDetectors } from "../../../src/frameworks/index.js";

describe("detectFramework", () => {
	beforeAll(() => {
		registerAllDetectors();
	});

	it("auto-detects pytest for python adapter", () => {
		const result = detectFramework("pytest tests/", "python", "/project");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("pytest");
	});

	it("auto-detects jest for node adapter", () => {
		const result = detectFramework("jest tests/", "node", "/project");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("jest");
	});

	it("auto-detects go test for go adapter", () => {
		const result = detectFramework("go test ./...", "go", "/project");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("gotest");
	});

	it("returns null for unknown commands", () => {
		const result = detectFramework("python app.py", "python", "/project");
		expect(result).toBeNull();
	});

	it("returns null when framework='none'", () => {
		const result = detectFramework("pytest tests/", "python", "/project", "none");
		expect(result).toBeNull();
	});

	it("forces specific framework by name", () => {
		const result = detectFramework("pytest tests/", "python", "/project", "pytest");
		expect(result).not.toBeNull();
		expect(result!.framework).toBe("pytest");
	});

	it("returns null when explicit framework doesn't match command", () => {
		// django detector won't match "python app.py"
		const result = detectFramework("python app.py", "python", "/project", "django");
		expect(result).toBeNull();
	});

	it("only tries detectors for the resolved adapter", () => {
		// jest command but python adapter → should not detect jest
		const result = detectFramework("jest tests/", "python", "/project");
		expect(result).toBeNull();
	});
});
