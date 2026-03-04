import { detectors as goDetectors } from "./go.js";
import { detectors as nodeDetectors } from "./node.js";
import { detectors as pythonDetectors } from "./python.js";

/**
 * Result of framework detection. Contains modifications to apply
 * to the launch config before passing to the adapter.
 */
export interface FrameworkOverrides {
	/** Detected framework identifier (e.g., "pytest", "jest", "django") */
	framework: string;
	/** Human-readable name for logs/viewport */
	displayName: string;
	/** Modified command string (replaces the original if set) */
	command?: string;
	/** Extra environment variables to merge */
	env?: Record<string, string>;
	/** Extra DAP launch args to merge into the adapter's launchArgs */
	launchArgs?: Record<string, unknown>;
	/** Warnings to include in the launch response (explain what was changed) */
	warnings: string[];
}

/**
 * A framework detector checks if a command matches a known framework
 * and returns config overrides for debugging.
 */
export interface FrameworkDetector {
	/** Unique identifier, e.g., "pytest" */
	id: string;
	/** Human-readable name, e.g., "pytest" */
	displayName: string;
	/** Which adapter this framework uses, e.g., "python" */
	adapterId: string;
	/**
	 * Check if the command matches this framework.
	 * Returns overrides if detected, or null if not a match.
	 */
	detect(command: string, cwd: string): FrameworkOverrides | null;
}

/** Registry of all framework detectors. */
const detectors: FrameworkDetector[] = [];

/** Register a framework detector. */
export function registerDetector(detector: FrameworkDetector): void {
	detectors.push(detector);
}

/** Return all registered detectors (for doctor command and diagnostics). */
export function listDetectors(): ReadonlyArray<FrameworkDetector> {
	return detectors;
}

/**
 * Detect the framework from the command string.
 *
 * @param command - The launch command
 * @param adapterId - The resolved adapter id (e.g., "python", "node", "go")
 * @param cwd - Working directory
 * @param explicitFramework - If set, force this framework (or "none" to skip)
 * @returns FrameworkOverrides or null if no framework detected
 */
export function detectFramework(command: string, adapterId: string, cwd: string, explicitFramework?: string): FrameworkOverrides | null {
	// Explicit "none" skips detection
	if (explicitFramework === "none") return null;

	// Explicit framework name — find it regardless of adapterId
	if (explicitFramework) {
		const detector = detectors.find((d) => d.id === explicitFramework);
		if (!detector) return null;
		return detector.detect(command, cwd);
	}

	// Auto-detect: try each detector for this adapter (first match wins)
	for (const detector of detectors) {
		if (detector.adapterId !== adapterId) continue;
		const result = detector.detect(command, cwd);
		if (result) return result;
	}

	return null;
}

/**
 * Register all built-in framework detectors.
 * Called once at startup alongside registerAllAdapters().
 */
export function registerAllDetectors(): void {
	for (const detector of pythonDetectors) registerDetector(detector);
	for (const detector of nodeDetectors) registerDetector(detector);
	for (const detector of goDetectors) registerDetector(detector);
}
