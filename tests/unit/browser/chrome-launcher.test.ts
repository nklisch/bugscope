import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CDPConnectionError, ChromeEarlyExitError } from "../../../src/core/errors.js";

/**
 * We test the early-exit detection by directly exercising the private waitForChrome
 * logic via a minimal reproduction. The actual ChromeLauncher class delegates to
 * launchChrome (binary search) + waitForChrome (poll with exit detection), and both
 * are private. We replicate the polling+exit logic here to verify the contract:
 *
 *   - Chrome process exits early → ChromeEarlyExitError (fast, no 10s timeout)
 *   - CDP never available → CDPConnectionError after timeout
 */

/** Simulate the waitForChrome logic extracted from ChromeLauncher. */
async function waitForChrome(
	port: number,
	chromeProcess: EventEmitter & { removeListener: EventEmitter["removeListener"] },
	fetchFn: (port: number) => Promise<string>,
	timeoutMs: number,
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	let lastError: Error | undefined;
	let earlyExit: { code: number | null; signal: string | null } | null = null;

	const exitHandler = (code: number | null, signal: string | null) => {
		earlyExit = { code, signal };
	};
	chromeProcess.on("exit", exitHandler);

	try {
		while (Date.now() < deadline) {
			if (earlyExit) {
				throw new ChromeEarlyExitError(earlyExit.code, earlyExit.signal);
			}
			try {
				return await fetchFn(port);
			} catch (err) {
				lastError = err as Error;
				await new Promise<void>((r) => setTimeout(r, 50));
			}
		}
		throw new CDPConnectionError(`Chrome CDP not available after ${timeoutMs}ms: ${lastError?.message}`, lastError);
	} finally {
		chromeProcess.removeListener("exit", exitHandler);
	}
}

describe("ChromeLauncher early exit detection", () => {
	it("throws ChromeEarlyExitError when Chrome process exits before CDP is ready", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		// Simulate Chrome exiting after 100ms (existing instance absorbed the launch)
		setTimeout(() => fakeProc.emit("exit", 0, null), 100);

		await expect(waitForChrome(9222, fakeProc, fetchFn, 5_000)).rejects.toThrow(ChromeEarlyExitError);
	});

	it("includes exit code and signal in error", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		setTimeout(() => fakeProc.emit("exit", 1, "SIGTERM"), 50);

		try {
			await waitForChrome(9222, fakeProc, fetchFn, 5_000);
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ChromeEarlyExitError);
			const e = err as ChromeEarlyExitError;
			expect(e.exitCode).toBe(1);
			expect(e.signal).toBe("SIGTERM");
			expect(e.code).toBe("CHROME_EARLY_EXIT");
		}
	});

	it("fails fast (not waiting for full timeout) on early exit", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		// Exit after 50ms — should NOT wait the full 5s timeout
		setTimeout(() => fakeProc.emit("exit", 0, null), 50);

		const start = Date.now();
		await expect(waitForChrome(9222, fakeProc, fetchFn, 5_000)).rejects.toThrow(ChromeEarlyExitError);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(1_000);
	});

	it("throws CDPConnectionError when CDP never becomes available (no early exit)", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		// Process stays alive — just CDP never responds
		await expect(waitForChrome(9222, fakeProc, fetchFn, 300)).rejects.toThrow(CDPConnectionError);
	});

	it("succeeds when CDP becomes available before timeout", async () => {
		const fakeProc = new EventEmitter();
		let callCount = 0;
		const fetchFn = vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount < 3) throw new Error("ECONNREFUSED");
			return "ws://localhost:9222/devtools/browser/abc";
		});

		const wsUrl = await waitForChrome(9222, fakeProc, fetchFn, 5_000);
		expect(wsUrl).toBe("ws://localhost:9222/devtools/browser/abc");
	});

	it("cleans up exit listener after resolution", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockResolvedValue("ws://localhost:9222/devtools/browser/abc");

		await waitForChrome(9222, fakeProc, fetchFn, 5_000);
		expect(fakeProc.listenerCount("exit")).toBe(0);
	});

	it("cleans up exit listener after error", async () => {
		const fakeProc = new EventEmitter();
		const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

		setTimeout(() => fakeProc.emit("exit", 0, null), 50);

		await expect(waitForChrome(9222, fakeProc, fetchFn, 5_000)).rejects.toThrow();
		expect(fakeProc.listenerCount("exit")).toBe(0);
	});
});
