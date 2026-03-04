import type { FrameworkDetector, FrameworkOverrides } from "./index.js";

/**
 * Matches jest commands:
 * - "jest tests/"
 * - "npx jest tests/"
 * - "node_modules/.bin/jest tests/"
 * - "bunx jest tests/"
 */
const JEST_PATTERN = /(?:^|\s)(?:npx\s+|bunx\s+|node_modules\/\.bin\/)?jest\b/;

export const jestDetector: FrameworkDetector = {
	id: "jest",
	displayName: "Jest",
	adapterId: "node",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!JEST_PATTERN.test(command)) return null;

		const warnings: string[] = [];
		let modifiedCommand: string | undefined;

		// Add --runInBand if not already present — Jest spawns workers by default,
		// which can't be individually debugged via a single DAP session.
		if (!command.includes("--runInBand") && !command.includes(" -i")) {
			// Insert --runInBand after the jest command word
			modifiedCommand = command.replace(/\bjest\b/, "jest --runInBand");
			warnings.push("Added --runInBand for debugging. Jest workers run in separate " + "processes that can't be debugged individually.");
		}

		return {
			framework: "jest",
			displayName: "Jest",
			command: modifiedCommand,
			warnings,
		};
	},
};

/**
 * Matches mocha commands:
 * - "mocha tests/"
 * - "npx mocha tests/"
 * - "node_modules/.bin/mocha tests/"
 */
const MOCHA_PATTERN = /(?:^|\s)(?:npx\s+|bunx\s+|node_modules\/\.bin\/)?mocha(?:\s|$)/;

export const mochaDetector: FrameworkDetector = {
	id: "mocha",
	displayName: "Mocha",
	adapterId: "node",
	detect(command: string, _cwd: string): FrameworkOverrides | null {
		if (!MOCHA_PATTERN.test(command)) return null;

		// Mocha runs in the same process — no special config needed.
		// Detection is useful for future enhancements and for surfacing
		// the framework name in the viewport/logs.
		return {
			framework: "mocha",
			displayName: "Mocha",
			warnings: [],
		};
	},
};

export const detectors: FrameworkDetector[] = [jestDetector, mochaDetector];
