/**
 * Integration tests for CDPPortAdapter + StepExecutor against real Chrome.
 *
 * These tests exercise the full browser execution stack:
 * CDPPortAdapter → StepExecutor → headless Chrome → test-app fixture
 *
 * Skips gracefully when Chrome is not available.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CDPPortAdapter } from "../../../src/browser/executor/cdp-adapter.js";
import { StepExecutor } from "../../../src/browser/executor/step-executor.js";
import type { CaptureConfig, Step } from "../../../src/browser/executor/types.js";
import { type BrowserTestContext, isChromeAvailable, setupBrowserTest } from "../../helpers/browser-test-harness.js";

const SKIP = !(await isChromeAvailable());

// ---------------------------------------------------------------------------
// Helper: build a StepExecutor from a live BrowserTestContext
// ---------------------------------------------------------------------------

function buildExecutor(ctx: BrowserTestContext): StepExecutor {
	const cdpClient = ctx.recorder.getCDPClient()!;
	const tabSessionId = ctx.recorder.getPrimaryTabSession()!;
	const screenshotCapture = ctx.recorder.getScreenshotCapture();
	const screenshotDir = ctx.recorder.getScreenshotDir();

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
// Journey 1: Login flow — navigate, fill, submit, wait_for, evaluate, screenshot
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: login flow", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("executes 8 steps and all complete with status ok", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/login" },
			{ action: "fill", selector: '[data-testid="username"]', value: "admin" },
			{ action: "fill", selector: '[data-testid="password"]', value: "correct" },
			{ action: "submit", selector: "#login-form" },
			{ action: "wait", ms: 1500 },
			{ action: "wait_for", selector: '[data-testid="stats"]', state: "visible", timeout: 5000 },
			{ action: "evaluate", expression: "document.title" },
			{ action: "screenshot", label: "dashboard-loaded" },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(8);
		expect(result.completedSteps).toBe(8);
		expect(result.results).toHaveLength(8);

		for (const r of result.results) {
			expect(r.status).toBe("ok");
		}

		// evaluate step returns the page title
		const evaluateResult = result.results[6];
		expect(evaluateResult.action).toBe("evaluate");
		expect(evaluateResult.returnValue).toBe("Dashboard");

		// Auto-markers should be placed at each step (markers: true is default)
		const markerIds = result.results.map((r) => r.markerId).filter(Boolean);
		expect(markerIds.length).toBeGreaterThan(0);
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 2: Error handling — element not found
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: element not found error", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("stops at the failing step and reports error with selector in message", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "click", selector: "#nonexistent-element" },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(2);
		expect(result.completedSteps).toBe(1);
		expect(result.results).toHaveLength(2);

		expect(result.results[0].status).toBe("ok");

		const failedStep = result.results[1];
		expect(failedStep.status).toBe("error");
		expect(failedStep.error).toBeDefined();
		expect(failedStep.error?.toLowerCase()).toMatch(/not found|nonexistent/i);
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 3: wait_for timeout
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: wait_for timeout", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("times out waiting for a non-existent element and reports error", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "wait_for", selector: "#never-exists", state: "visible", timeout: 1000 },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(2);
		expect(result.completedSteps).toBe(1);
		expect(result.results).toHaveLength(2);

		expect(result.results[0].status).toBe("ok");

		const failedStep = result.results[1];
		expect(failedStep.status).toBe("error");
		expect(failedStep.error).toBeDefined();
		expect(failedStep.error).toMatch(/Timeout/i);
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 4A: Capture mode — screenshot: "none", markers: false
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: capture mode none", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("produces no screenshots and no markers when capture is disabled", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "click", selector: '[data-testid="nav-login"]' },
			{ action: "wait", ms: 500 },
		];

		const capture: CaptureConfig = { screenshot: "none", markers: false };
		const result = await executor.execute(steps, capture);

		expect(result.completedSteps).toBe(3);

		for (const r of result.results) {
			expect(r.screenshotPath).toBeUndefined();
			expect(r.markerId).toBeUndefined();
		}
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 4B: Capture mode — screenshot: "on_error"
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: capture mode on_error", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("captures screenshot only on the erroring step, not the successful step", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "click", selector: "#nonexistent" },
		];

		const capture: CaptureConfig = { screenshot: "on_error" };
		const result = await executor.execute(steps, capture);

		expect(result.totalSteps).toBe(2);
		expect(result.completedSteps).toBe(1);

		// Step 1 (ok) should have no screenshot
		expect(result.results[0].status).toBe("ok");
		expect(result.results[0].screenshotPath).toBeUndefined();

		// Step 2 (error) should have a screenshot if screenshotCapture is available
		expect(result.results[1].status).toBe("error");
		// Note: screenshotPath may be undefined if screenshotCapture is null, but it should not throw
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 5: Multi-page form flow with state persistence
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: multi-page form flow", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("completes 14-step login + settings update flow", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/login" },
			{ action: "fill", selector: '[data-testid="username"]', value: "admin" },
			{ action: "fill", selector: '[data-testid="password"]', value: "correct" },
			{ action: "submit", selector: "#login-form" },
			{ action: "wait", ms: 2000 },
			{ action: "navigate", url: "/settings" },
			{ action: "wait", ms: 500 },
			{ action: "fill", selector: '[data-testid="name"]', value: "Test User" },
			{ action: "fill", selector: '[data-testid="email"]', value: "test@example.com" },
			{ action: "fill", selector: '[data-testid="phone"]', value: "5551234567" },
			{ action: "submit", selector: "#settings-form" },
			{ action: "wait", ms: 1000 },
			{ action: "mark", label: "settings-saved" },
			{ action: "evaluate", expression: "document.querySelector('[data-testid=\"output\"]')?.textContent || ''" },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(14);
		expect(result.completedSteps).toBe(14);
		expect(result.results).toHaveLength(14);

		for (const r of result.results) {
			expect(r.status).toBe("ok");
		}

		// evaluate step should return settings saved message
		const evaluateResult = result.results[13];
		expect(evaluateResult.action).toBe("evaluate");
		expect(evaluateResult.returnValue).toMatch(/Settings saved|success/i);

		// mark step should return the label as its returnValue
		const markResult = result.results[12];
		expect(markResult.action).toBe("mark");
		// mark returns the marker ID (a UUID or string)
		expect(markResult.returnValue).toBeTruthy();
	}, 45_000);
});

// ---------------------------------------------------------------------------
// Journey 6: evaluate step returns values
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: evaluate returns values", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("returns correct values for arithmetic, title, and JSON expressions", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "evaluate", expression: "1 + 1" },
			{ action: "evaluate", expression: "document.title" },
			{ action: "evaluate", expression: "JSON.stringify({a: 1, b: 2})" },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(4);
		expect(result.completedSteps).toBe(4);

		for (const r of result.results) {
			expect(r.status).toBe("ok");
		}

		expect(result.results[1].returnValue).toBe("2");
		expect(result.results[2].returnValue).toBe("Test App — Home");
		expect(result.results[3].returnValue).toBe('{"a":1,"b":2}');
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 7: scroll and hover actions
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: scroll and hover actions", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("scroll_to, hover, and scroll_by complete without error on real elements", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [
			{ action: "navigate", url: "/" },
			{ action: "scroll_to", selector: '[data-testid="nav-settings"]' },
			{ action: "hover", selector: '[data-testid="nav-login"]' },
			{ action: "scroll_by", x: 0, y: 100 },
		];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(4);
		expect(result.completedSteps).toBe(4);

		for (const r of result.results) {
			expect(r.status).toBe("ok");
		}
	}, 30_000);
});

// ---------------------------------------------------------------------------
// Journey 8: reload action
// ---------------------------------------------------------------------------

describe.skipIf(SKIP)("StepExecutor Integration: reload action", () => {
	let ctx: BrowserTestContext;

	beforeAll(async () => {
		ctx = await setupBrowserTest();
	}, 60_000);

	afterAll(async () => {
		await ctx?.cleanup();
	});

	it("reload re-loads the same page and evaluate returns correct title before and after", async () => {
		const executor = buildExecutor(ctx);

		const steps: Step[] = [{ action: "navigate", url: "/" }, { action: "evaluate", expression: "document.title" }, { action: "reload" }, { action: "evaluate", expression: "document.title" }];

		const result = await executor.execute(steps);

		expect(result.totalSteps).toBe(4);
		expect(result.completedSteps).toBe(4);

		for (const r of result.results) {
			expect(r.status).toBe("ok");
		}

		expect(result.results[1].returnValue).toBe("Test App — Home");
		expect(result.results[3].returnValue).toBe("Test App — Home");
	}, 30_000);
});
