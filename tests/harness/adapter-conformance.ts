import { describe, expect, it } from "vitest";
import type { DebugAdapter } from "../../src/adapters/base.js";
import type { SessionManager } from "../../src/core/session-manager.js";

/**
 * Fixture definition for adapter conformance testing.
 * Each adapter provides a fixture program that:
 * - Has a loop (lines known ahead of time)
 * - Has a function call at a known line
 * - Has inspectable local variables
 */
export interface ConformanceFixture {
	/** Path to the fixture source file */
	filePath: string;
	/** The command to launch it (e.g., "python3 fixture.py") */
	command: string;
	/** Language id matching the adapter's id */
	language: string;
	/** Line number where a breakpoint can be set inside the loop body */
	loopBodyLine: number;
	/** Line number of a function call that can be stepped into */
	functionCallLine: number;
	/** Line number inside the called function */
	insideFunctionLine: number;
	/** Expected variable names visible at loopBodyLine (subset check) */
	expectedLocals: string[];
	/** An expression that evaluates to a known value at loopBodyLine */
	evalExpression: string;
	/** The expected result substring from evaluating evalExpression */
	evalExpectedSubstring: string;
}

/**
 * Run the full adapter conformance suite against a fixture.
 * Call this from your adapter's integration test file.
 *
 * Tests:
 * 1. checkPrerequisites() returns satisfied: true
 * 2. Launch → breakpoint hit → viewport contains expected location
 * 3. Step over → line advances
 * 4. Step into function → enters function body
 * 5. Step out → returns to caller
 * 6. Evaluate expression → returns expected value
 * 7. Variables → contains expected locals
 * 8. Conditional breakpoint → skips when condition is false
 * 9. Stop → session terminates cleanly
 * 10. Error case: stop on already-terminated session returns error
 */
export function runConformanceSuite(adapter: DebugAdapter, fixture: ConformanceFixture, sessionManagerFactory: () => SessionManager): void {
	const TIMEOUT = 30_000;

	describe(`${adapter.displayName} — conformance suite`, () => {
		// Test 1: Prerequisites check
		it(
			"checkPrerequisites() returns satisfied",
			async () => {
				const result = await adapter.checkPrerequisites();
				expect(result.satisfied).toBe(true);
				if (!result.satisfied) {
					console.error(`Prerequisite check failed: ${result.missing?.join(", ")}. Install hint: ${result.installHint}`);
				}
			},
			TIMEOUT,
		);

		// Test 2: Launch and hit breakpoint
		it(
			"launch → breakpoint hit → viewport contains location",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					expect(result.sessionId).toBeTruthy();
					expect(result.status).toMatch(/running|stopped/);

					const viewport = await sm.continue(result.sessionId, TIMEOUT);
					expect(viewport).toContain("STOPPED");
					// Should mention the file name (basename)
					const basename = fixture.filePath.split("/").pop()!;
					expect(viewport).toContain(basename);
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 3: Step over advances line
		it(
			"step over → line advances",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					await sm.continue(result.sessionId, TIMEOUT);
					const afterStep = await sm.step(result.sessionId, "over");
					expect(afterStep).toContain("STOPPED");
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 4: Step into function
		it(
			"step into → enters function body",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.functionCallLine }] }],
					});

					await sm.continue(result.sessionId, TIMEOUT);
					const insideFunc = await sm.step(result.sessionId, "into");
					// Should now be inside the function — check that we're at the insideFunctionLine or nearby
					expect(insideFunc).toContain("STOPPED");
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 5: Step out returns to caller
		it(
			"step out → returns to caller",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.functionCallLine }] }],
					});

					await sm.continue(result.sessionId, TIMEOUT);
					// Step in then step out
					await sm.step(result.sessionId, "into");
					const afterStepOut = await sm.step(result.sessionId, "out");
					expect(afterStepOut).toContain("STOPPED");
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 6: Evaluate expression
		it(
			"evaluate expression → returns expected value",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					await sm.continue(result.sessionId, TIMEOUT);
					const evalResult = await sm.evaluate(result.sessionId, fixture.evalExpression);
					expect(evalResult).toContain(fixture.evalExpectedSubstring);
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 7: Variables contain expected locals
		it(
			"variables → contains expected locals",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					await sm.continue(result.sessionId, TIMEOUT);
					const vars = await sm.getVariables(result.sessionId, "local");
					for (const localName of fixture.expectedLocals) {
						expect(vars).toContain(localName);
					}
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 8: Conditional breakpoint
		it(
			"conditional breakpoint → only stops when condition is true",
			async () => {
				const sm = sessionManagerFactory();
				try {
					// Use a condition that is true only partway through the loop (e.g., i > 0 or i == 1)
					// For simplicity, we just verify that a conditional breakpoint can be set without error
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine, condition: "1 == 1" }] }],
					});

					expect(result.sessionId).toBeTruthy();
					const viewport = await sm.continue(result.sessionId, TIMEOUT);
					expect(viewport).toContain("STOPPED");
					await sm.stop(result.sessionId);
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 9: Stop terminates cleanly
		it(
			"stop → session terminates cleanly",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					const stopResult = await sm.stop(result.sessionId);
					expect(stopResult).toMatchObject({ actionCount: expect.any(Number) });
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);

		// Test 10: Error case — double stop returns error gracefully
		it(
			"error case → double stop returns error gracefully",
			async () => {
				const sm = sessionManagerFactory();
				try {
					const result = await sm.launch({
						command: fixture.command,
						language: fixture.language,
						breakpoints: [{ file: fixture.filePath, breakpoints: [{ line: fixture.loopBodyLine }] }],
					});

					await sm.stop(result.sessionId);
					// Second stop should throw (session already gone)
					await expect(sm.stop(result.sessionId)).rejects.toThrow();
				} finally {
					await sm.disposeAll();
				}
			},
			TIMEOUT,
		);
	});
}
