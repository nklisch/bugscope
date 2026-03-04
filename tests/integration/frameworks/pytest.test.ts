import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PythonAdapter } from "../../../src/adapters/python.js";
import { registerAdapter } from "../../../src/adapters/registry.js";
import { SessionManager } from "../../../src/core/session-manager.js";
import { ResourceLimitsSchema } from "../../../src/core/types.js";
import { registerAllDetectors } from "../../../src/frameworks/index.js";
import { SKIP_NO_DEBUGPY } from "../../helpers/debugpy-check.js";

const FIXTURE_DIR = resolve(import.meta.dirname, "../../fixtures/python/pytest-target");
const FIXTURE_TEST = resolve(FIXTURE_DIR, "test_module.py");
const FIXTURE_MODULE = resolve(FIXTURE_DIR, "module.py");

registerAdapter(new PythonAdapter());
registerAllDetectors();

const testLimits = ResourceLimitsSchema.parse({
	sessionTimeoutMs: 60_000,
	maxActionsPerSession: 50,
	maxConcurrentSessions: 3,
	stepTimeoutMs: 15_000,
});

describe.skipIf(SKIP_NO_DEBUGPY)("pytest framework detection integration", () => {
	let manager: SessionManager;
	let sessionId: string;

	beforeEach(() => {
		manager = new SessionManager(testLimits);
	});

	afterEach(async () => {
		try {
			if (sessionId) await manager.stop(sessionId);
		} catch {
			// ignore cleanup errors
		}
		await manager.disposeAll();
	});

	it("detects pytest and returns framework in launch result", async () => {
		const result = await manager.launch({
			command: `python3 -m pytest ${FIXTURE_TEST} -x`,
			cwd: FIXTURE_DIR,
		});
		sessionId = result.sessionId;
		expect(result.framework).toBe("pytest");
	});

	it("framework='none' disables detection", async () => {
		const result = await manager.launch({
			command: `python3 -m pytest ${FIXTURE_TEST} -x`,
			cwd: FIXTURE_DIR,
			framework: "none",
		});
		sessionId = result.sessionId;
		expect(result.framework).toBeUndefined();
	});

	it("launches pytest with breakpoint and hits it", async () => {
		const result = await manager.launch({
			command: `python3 -m pytest ${FIXTURE_TEST} -x`,
			cwd: FIXTURE_DIR,
			breakpoints: [{ file: FIXTURE_MODULE, breakpoints: [{ line: 2 }] }],
		});
		sessionId = result.sessionId;
		expect(result.framework).toBe("pytest");

		const viewport = await manager.continue(sessionId, 20_000);
		expect(viewport).toContain("STOPPED");
	});
});
