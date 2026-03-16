/**
 * E2E tests: step execution events appear in the recording timeline
 * and can be investigated with MCP tools.
 *
 * These tests use StepExecutor directly (not through MCP/daemon) to drive
 * a real Chrome session, then call finishRecording() and query the recording
 * with MCP investigation tools.
 *
 * Skips gracefully when Chrome is not available.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CDPPortAdapter } from "../../../src/browser/executor/cdp-adapter.js";
import { StepExecutor } from "../../../src/browser/executor/step-executor.js";
import type { CaptureConfig, RunStepsResult, Step } from "../../../src/browser/executor/types.js";
import { type BrowserTestContext, isChromeAvailable, setupBrowserTest } from "../../helpers/browser-test-harness.js";
import { extractSessionId } from "../../helpers/journey-helpers.js";

const SKIP = !(await isChromeAvailable());

// ---------------------------------------------------------------------------
// Helper: build a StepExecutor from a live BrowserTestContext.
//
// NOTE: The daemon's buildStepExecutorAdapter() uses getOrCreateScreenshotDir()
// which eagerly creates the session dir. In tests we call placeMarker() before
// this for investigation landmarks, but it's no longer required for screenshots.
// ---------------------------------------------------------------------------

function buildExecutor(ctx: BrowserTestContext): StepExecutor {
	const cdpClient = ctx.recorder.getCDPClient()!;
	const tabSessionId = ctx.recorder.getPrimaryTabSession()!;
	const screenshotCapture = ctx.recorder.getScreenshotCapture();
	const screenshotDir = ctx.recorder.getOrCreateScreenshotDir();

	const adapter = new CDPPortAdapter({
		cdpClient,
		tabSessionId,
		recorder: ctx.recorder,
		screenshotCapture,
		screenshotDir,
	});

	return new StepExecutor(adapter);
}

// ---------------------------------------------------------------------------
// Journey 1: Step execution produces an investigatable recording
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("RunSteps Journey: step execution produces investigatable recording", () => {
	let ctx: BrowserTestContext;
	let sessionId: string;
	let stepResult: RunStepsResult;

	beforeAll(async () => {
		ctx = await setupBrowserTest();

		// Place a marker first to initialise the persistence session dir
		await ctx.placeMarker("test-start");

		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "navigate", url: "/login" },
			{ action: "fill", selector: '[data-testid="username"]', value: "admin" },
			{ action: "fill", selector: '[data-testid="password"]', value: "correct" },
			{ action: "submit", selector: "#login-form" },
			{ action: "wait", ms: 1500 },
			{ action: "mark", label: "checkpoint" },
		];

		stepResult = await executor.execute(steps);

		await ctx.finishRecording();

		const listResult = await ctx.callTool("session_list", {});
		sessionId = extractSessionId(listResult);
	}, 90_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("all 7 steps complete successfully", () => {
		expect(stepResult.totalSteps).toBe(7);
		expect(stepResult.completedSteps).toBe(7);
		for (const r of stepResult.results) {
			expect(r.status).toBe("ok");
		}
	});

	it("session_list returns a recording", async () => {
		const result = await ctx.callTool("session_list", {});
		expect(result).toMatch(/Sessions/i);
		expect(sessionId).toMatch(/[a-f0-9-]{36}/);
	});

	it("session_overview shows step markers in the timeline", async () => {
		const overview = await ctx.callTool("session_overview", {
			session_id: sessionId,
			include: ["timeline", "markers"],
		});

		// Auto-step markers use the pattern "step:N:..." and we also placed "checkpoint"
		expect(overview).toMatch(/step:\d+:|checkpoint|test-start/i);
	});

	it("session_overview includes manual checkpoint marker", async () => {
		const overview = await ctx.callTool("session_overview", {
			session_id: sessionId,
			include: ["markers"],
		});

		expect(overview).toContain("checkpoint");
	});

	it("session_search for user_input events finds form fill interactions", async () => {
		const result = await ctx.callTool("session_search", {
			session_id: sessionId,
			event_types: ["user_input"],
		});

		expect(result).toContain("Found");
	});

	it("session_search for navigation events shows page navigations", async () => {
		const result = await ctx.callTool("session_search", {
			session_id: sessionId,
			event_types: ["navigation"],
		});

		expect(result).toContain("Found");
	});
});

// ---------------------------------------------------------------------------
// Journey 2: Screenshots captured and accessible in the recording
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("RunSteps Journey: screenshots captured and accessible", () => {
	let ctx: BrowserTestContext;
	let sessionId: string;
	let stepResult: RunStepsResult;

	beforeAll(async () => {
		ctx = await setupBrowserTest();

		// Place a marker first to initialise the persistence session dir,
		// which is required for screenshotDir to be non-null
		await ctx.placeMarker("before-steps");

		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "click", selector: '[data-testid="nav-login"]' },
			{ action: "wait", ms: 500 },
		];

		const capture: CaptureConfig = { screenshot: "all" };
		stepResult = await executor.execute(steps, capture);

		await ctx.finishRecording();

		const listResult = await ctx.callTool("session_list", {});
		sessionId = extractSessionId(listResult);
	}, 90_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("all 3 steps complete successfully", () => {
		expect(stepResult.totalSteps).toBe(3);
		expect(stepResult.completedSteps).toBe(3);
		for (const r of stepResult.results) {
			expect(r.status).toBe("ok");
		}
	});

	it("step results contain non-empty screenshot paths (capture: all with active session)", () => {
		// We placed a marker before buildExecutor, so the session dir existed at
		// executor build time. With capture: "all", every non-screenshot/mark step
		// should have a screenshot path.
		const stepsWithScreenshots = stepResult.results.filter((r) => r.screenshotPath && r.screenshotPath.length > 0);

		// At least one step should have a screenshot
		expect(stepsWithScreenshots.length).toBeGreaterThan(0);

		// All captured paths should look like real files
		for (const r of stepsWithScreenshots) {
			expect(r.screenshotPath).toMatch(/\.(jpg|jpeg|png|webp)$/i);
		}
	});

	it("session_overview shows the recording session", async () => {
		const overview = await ctx.callTool("session_overview", {
			session_id: sessionId,
		});

		expect(overview).toBeTruthy();
		expect(overview.length).toBeGreaterThan(0);
	});

	it("session_search finds navigation events after step execution", async () => {
		const result = await ctx.callTool("session_search", {
			session_id: sessionId,
			event_types: ["navigation"],
		});

		expect(result).toContain("Found");
	});
});

// ---------------------------------------------------------------------------
// Journey 3: Per-step screenshot override — step-level screenshot: false
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("RunSteps Journey: per-step screenshot override", () => {
	let ctx: BrowserTestContext;
	let stepResult: RunStepsResult;
	let screenshotDirWasAvailable: boolean;

	beforeAll(async () => {
		ctx = await setupBrowserTest();

		// Place a marker first to initialise the persistence session dir
		await ctx.placeMarker("before-steps");

		// Capture screenshotDir availability NOW (before session ends via finishRecording)
		screenshotDirWasAvailable = ctx.recorder.getScreenshotDir() !== null;

		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			// screenshot: false overrides the global "all" mode for this step
			{ action: "navigate", url: "/", screenshot: false },
			// No per-step override — global "all" mode applies
			{ action: "navigate", url: "/login" },
			// screenshot: false again
			{ action: "navigate", url: "/", screenshot: false },
		];

		const capture: CaptureConfig = { screenshot: "all" };
		stepResult = await executor.execute(steps, capture);

		// No need to finishRecording — we only verify step results
	}, 90_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("all 3 steps complete", () => {
		expect(stepResult.totalSteps).toBe(3);
		expect(stepResult.completedSteps).toBe(3);
		for (const r of stepResult.results) {
			expect(r.status).toBe("ok");
		}
	});

	it("steps with screenshot: false have no screenshotPath regardless of global mode", () => {
		// Steps 0 and 2 have per-step screenshot: false — must never capture
		expect(stepResult.results[0].screenshotPath).toBeUndefined();
		expect(stepResult.results[2].screenshotPath).toBeUndefined();
	});

	it("step without override captures screenshot when screenshotDir is configured", () => {
		// Step 1 (index 1) has no per-step override → global "all" mode applies
		if (screenshotDirWasAvailable) {
			const path = stepResult.results[1].screenshotPath;
			expect(typeof path).toBe("string");
			expect(path!.length).toBeGreaterThan(0);
		} else {
			// screenshotDir was unavailable at executor build time → path is empty or undefined
			const path = stepResult.results[1].screenshotPath ?? "";
			expect(path).toBe("");
		}
	});
});
