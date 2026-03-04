import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/** Matches "go test" commands */
const GO_TEST_PATTERN = /^go\s+test\b/;

export const goTestDetector: FrameworkDetector = {
	id: "gotest",
	displayName: "go test",
	adapterId: "go",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!GO_TEST_PATTERN.test(command.trim())) return null;

		// The Go adapter's parseGoCommand already handles "go test" → mode: "test".
		// Detection here surfaces the framework name and adds useful hints.
		const warnings: string[] = [];

		// Check for -count flag — without it, Go caches test results
		if (!command.includes("-count=") && !command.includes("-count ")) {
			warnings.push("Tip: use -count=1 to disable test result caching during debugging.");
		}

		return {
			framework: "gotest",
			displayName: "go test",
			warnings,
		};
	},
};

export const detectors: FrameworkDetector[] = [goTestDetector];
