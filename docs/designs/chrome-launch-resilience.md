# Design: Chrome Launch Resilience

Fixes for Chrome launch failures, misleading error messages, and agent-facing recovery guidance observed during real-world usage on a Nobara/Fedora Linux desktop with Electron apps running.

## Issues Addressed

1. **Chrome wrapper binary absorption** — `google-chrome` on Linux is a shell wrapper that delegates to an existing Chrome instance and exits 0 before CDP is available. `findChromeBinary()` selects it because `--version` succeeds, but it fails at launch.
2. **Dangerous `pkill -f chrome` suggestion** — The MCP error hint suggests `pkill -f chrome` which matches Electron app crashpad handlers (Discord, Unity Hub, etc.), killing unrelated apps.
3. **`isCdpError` heuristic too broad** — `ChromeEarlyExitError`, `CDPConnectionError`, and `BrowserRecorderStateError` all match `/cdp|chrome|connect/i` and produce the same 3-option remediation, even though each has a different root cause and fix.
4. **`browser.status` / `browser.start` state inconsistency** — After a failed start, `state.recorder` can be non-null with `isRecording() === false`, causing `browser.status` to report "no active recording" while `browser.start` silently overwrites the stale recorder without cleanup.
5. **`startedAt = 0` epoch timestamp** — `BrowserRecorder.startedAt` defaults to `0`; if `start()` fails after `state.setRecorder(recorder)` but before `this.startedAt = Date.now()`, session info shows `1970-01-01T00:00:00.000Z`.
6. **`session_search` console_levels filter excludes `page_error`** — Searching with `event_types: ["console", "page_error"]` and `console_levels: ["error"]` returns nothing because `console_levels` is applied as a filter to ALL matching event types, not just `console` events. The `page_error` events don't have a `level` field, so they're excluded.

## Implementation Units

### Unit 1: Binary fallback chain in `findChromeBinary()`

**File**: `src/browser/recorder/chrome-launcher.ts`

```typescript
/** Binary search order for Chrome/Chromium. */
const CHROME_BINARIES = [
	// Direct binaries first — these bypass wrapper scripts
	"/opt/google/chrome/chrome",
	"/opt/google/chrome/google-chrome",
	// Standard PATH names (may be wrappers on some distros)
	"google-chrome-stable",
	"google-chrome",
	"chromium-browser",
	"chromium",
	// macOS
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/**
 * Find the first available Chrome binary by spawning each candidate with --version.
 * Returns the binary path, or null if none found.
 */
export async function findChromeBinary(): Promise<string | null> {
	for (const binary of CHROME_BINARIES) {
		const ok = await new Promise<boolean>((resolve) => {
			const proc = spawn(binary, ["--version"], { stdio: "pipe" });
			proc.on("close", (code) => resolve(code === 0));
			proc.on("error", () => resolve(false));
		});
		if (ok) return binary;
	}
	return null;
}
```

**Implementation Notes**:
- Place direct binary paths first so they're preferred over wrapper scripts.
- `/opt/google/chrome/chrome` is the real binary on Fedora/RHEL/Nobara. The wrapper at `/usr/bin/google-chrome` delegates to it but exits immediately if another Chrome is running.
- `google-chrome-stable` before `google-chrome` because on Debian/Ubuntu `google-chrome-stable` is typically the actual binary installed by the deb package, while `google-chrome` may be an alternative managed by `update-alternatives`.
- The `--version` probe is unchanged — it verifies the binary exists and is executable. Wrapper scripts also pass this check, but since direct paths are tried first, the wrapper is only used as fallback when no direct binary is found.

**Acceptance Criteria**:
- [ ] On a system where `/opt/google/chrome/chrome` exists, it is selected over `/usr/bin/google-chrome`
- [ ] On macOS, the Applications path is still found
- [ ] On systems with only `google-chrome` in PATH, it still works as fallback
- [ ] Existing unit tests continue to pass

---

### Unit 2: Error-specific MCP remediation messages

**File**: `src/mcp/tools/browser.ts`

Replace the single `isCdpError` heuristic with error-type-specific messages:

```typescript
// In the chrome_start catch block:
} catch (err) {
	if (err instanceof ChromeEarlyExitError) {
		return textResponse(
			`Error: ${err.message}\n\n` +
			"Chrome launched but exited immediately — likely an existing Chrome instance absorbed the launch.\n\n" +
			"Fix: close your existing Chrome browser, then retry chrome_start.\n" +
			"If you can't close Chrome, ask the user to launch it with remote debugging:\n" +
			"  google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/krometrail-chrome\n" +
			"  Then: chrome_start(attach: true)",
		);
	}
	if (err instanceof CDPConnectionError) {
		return textResponse(
			`Error: ${err.message}\n\n` +
			"Chrome was launched but its debug port never became available.\n\n" +
			"This can happen if:\n" +
			"- Another process is using port 9222\n" +
			"- Chrome is taking unusually long to start\n\n" +
			"Fix option 1 — try a different port:\n" +
			"  chrome_start(port: 9223, profile: 'krometrail', url: '<your-url>')\n\n" +
			"Fix option 2 — ask the user to launch Chrome manually:\n" +
			"  google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/krometrail-chrome\n" +
			"  Then: chrome_start(attach: true)",
		);
	}
	if (err instanceof ChromeNotFoundError) {
		return textResponse(`Error: ${err.message}`);
	}
	return errorResponse(err);
}
```

**Implementation Notes**:
- Import `ChromeEarlyExitError`, `CDPConnectionError`, `ChromeNotFoundError` from `../../core/errors.js`.
- `ChromeEarlyExitError`: Remove the `pkill` suggestion entirely. The fix is to close Chrome normally or use attach mode. The agent should NOT be killing user processes.
- `CDPConnectionError`: Suggest a different port as first option since port conflicts are the most likely cause.
- `ChromeNotFoundError`: The error message already contains platform-specific install hints, just surface it directly.
- Remove the `isCdpError` regex heuristic entirely — it catches too broadly and produces wrong remediation for each error type.

**Acceptance Criteria**:
- [ ] `ChromeEarlyExitError` produces a message that does NOT contain `pkill`
- [ ] `CDPConnectionError` suggests trying a different port
- [ ] `ChromeNotFoundError` shows install instructions without generic remediation
- [ ] Other errors fall through to `errorResponse(err)`
- [ ] No regex heuristic remains in the catch block

---

### Unit 3: Clean up stale recorder on `browser.start`

**File**: `src/daemon/browser-handlers.ts`

```typescript
case "browser.start": {
	const p = BrowserStartParamsSchema.parse(params);
	if (state.recorder?.isRecording()) {
		throw new BrowserRecorderStateError("Browser recording is already active. Call browser.stop first.");
	}
	// Clean up stale recorder from a previous failed start
	if (state.recorder) {
		try {
			await state.recorder.stop();
		} catch {
			// Ignore cleanup errors — the recorder is in a bad state
		}
		state.setRecorder(null);
	}
	const { BrowserRecorder } = await import("../browser/recorder/index.js");
	// ... rest unchanged
```

**Implementation Notes**:
- This handles the case where `state.recorder` is non-null but `isRecording()` is false — a "stuck" recorder from a failed previous start.
- `stop()` is called in a try/catch to swallow errors since the recorder is already in a bad state.
- `state.setRecorder(null)` ensures the stale recorder is fully cleared before creating a new one.
- This fixes the state inconsistency where `browser.status` reports no recording but `browser.start` behavior depends on the stale recorder.

**Acceptance Criteria**:
- [ ] After a failed `browser.start`, calling `browser.start` again succeeds without requiring `browser.stop`
- [ ] `browser.status` and `browser.start` agree on recording state
- [ ] The stale recorder's Chrome process (if any) is cleaned up

---

### Unit 4: Move `setRecorder` after successful `start()`

**File**: `src/daemon/browser-handlers.ts`

```typescript
case "browser.start": {
	const p = BrowserStartParamsSchema.parse(params);
	if (state.recorder?.isRecording()) {
		throw new BrowserRecorderStateError("Browser recording is already active. Call browser.stop first.");
	}
	// Clean up stale recorder from a previous failed start
	if (state.recorder) {
		try {
			await state.recorder.stop();
		} catch {
			// Ignore cleanup errors
		}
		state.setRecorder(null);
	}
	const { BrowserRecorder } = await import("../browser/recorder/index.js");
	const recorder = new BrowserRecorder({
		port: p.port,
		attach: p.attach,
		profile: p.profile,
		allTabs: p.allTabs,
		tabFilter: p.tabFilter,
		url: p.url,
		persistence: {},
		...(p.screenshotIntervalMs !== undefined && { screenshots: { intervalMs: p.screenshotIntervalMs } }),
		frameworkState: p.frameworkState,
	});
	recorder.onAutoStop = () => {
		state.setRecorder(null);
		state.resetIdleTimer();
	};
	// Start FIRST, then register. If start() throws, the daemon
	// never holds a reference to a broken recorder.
	const result = await recorder.start();
	state.setRecorder(recorder);
	return result;
}
```

**Implementation Notes**:
- Currently `state.setRecorder(recorder)` is called on line 73 BEFORE `recorder.start()` on line 74. If `start()` throws, the daemon holds a non-null recorder that isn't recording — the "stuck" state.
- Moving `setRecorder` after `start()` means a failed start never pollutes daemon state.
- The `onAutoStop` callback is set before `start()` because it could be needed during the start process if Chrome disconnects during initialization.
- Combined with Unit 3's stale cleanup, this eliminates the stuck state entirely.

**Acceptance Criteria**:
- [ ] If `recorder.start()` throws, `state.recorder` remains null
- [ ] Successful starts still register the recorder and `onAutoStop` works
- [ ] The `browser.status` / `browser.start` state inconsistency cannot occur

---

### Unit 5: Fix `console_levels` filter excluding `page_error` events

**File**: `src/browser/investigation/query-engine.ts`

Lines 213-220 — the `consoleLevels` post-filter:

```typescript
// CURRENT (broken): excludes ALL non-console events when consoleLevels is set
results = results.filter((e) => {
	if (e.type !== "console") return false;  // <-- kills page_error events
	const match = e.summary.match(/^\[(\w+)\]/);
	return match ? levels.includes(match[1]) : false;
});

// FIXED: only filter console events by level; pass through non-console events
results = results.filter((e) => {
	if (e.type !== "console") return true;  // non-console events pass through
	const match = e.summary.match(/^\[(\w+)\]/);
	return match ? levels.includes(match[1]) : false;
});
```

**Implementation Notes**:
- Line 216 currently returns `false` for non-console events, which means when `console_levels: ["error"]` is set alongside `event_types: ["console", "page_error"]`, the `page_error` events are filtered out even though they were explicitly requested.
- The fix changes `return false` to `return true` — non-console events are not subject to the `console_levels` filter. The `event_types` filter (applied earlier in the pipeline) already constrains which event types are included.
- This is a one-line change: `false` → `true` on line 216.

**Acceptance Criteria**:
- [ ] `session_search(event_types: ["console", "page_error"], console_levels: ["error"])` returns both console errors AND page_error events
- [ ] `session_search(event_types: ["console"], console_levels: ["error"])` still returns only console error events (no page_errors)
- [ ] `session_search(event_types: ["page_error"])` returns page_error events regardless of console_levels

---

### Unit 6: Validate `startedAt` in session info rendering

**File**: `src/mcp/tools/browser.ts`

```typescript
function formatSessionInfo(info: BrowserSessionInfo): string {
	const lines: string[] = [];
	const startedAt = info.startedAt > 0
		? new Date(info.startedAt).toISOString()
		: "just now";
	lines.push(`Browser recording active since ${startedAt}`);
	lines.push(`Events: ${info.eventCount}  Markers: ${info.markerCount}  Buffer age: ${Math.round(info.bufferAgeMs / 1000)}s`);
	if (info.tabs.length > 0) {
		lines.push("Tabs:");
		for (const tab of info.tabs) {
			const title = tab.title ? `"${tab.title}" ` : "";
			lines.push(`  ${title}(${tab.url})`);
		}
	}
	return lines.join("\n");
}
```

**Implementation Notes**:
- `startedAt` defaults to `0` in the recorder and is set to `Date.now()` near the end of `start()`. If the session info is queried before that line runs (unlikely but possible in error paths), it renders as epoch.
- This is a defensive formatting fix. The root cause (Unit 4) prevents the broken state from occurring, but defense in depth is appropriate for agent-facing output.

**Acceptance Criteria**:
- [ ] `startedAt = 0` renders as `"just now"` instead of `"1970-01-01T00:00:00.000Z"`
- [ ] Valid timestamps continue to render as ISO strings

---

### Unit 7: Update skill docs with launch failure guidance

**Files**: `.agents/skills/krometrail-mcp/SKILL.md` and `plugin/skills/krometrail-mcp/SKILL.md` (the MCP navigation guide — both copies)

Add to the "Common pitfalls" section:

```markdown
- **Chrome launch absorbed.** On Linux, Chrome wrapper scripts (e.g., `/usr/bin/google-chrome`) may delegate to an existing Chrome and exit immediately, causing `chrome_start` to fail. If this happens, ask the user to close their Chrome browser and retry. Do NOT suggest `pkill` — it can kill Electron apps (Discord, VS Code, etc.) that have `chrome` in their process names.
```

**Files**: `.agents/skills/krometrail-chrome/SKILL.md` and `plugin/skills/krometrail-chrome/SKILL.md` (the Chrome skill — both copies)

Add a troubleshooting section:

```markdown
### Chrome launch failures

If `chrome_start` fails with "Chrome exited immediately":
1. Ask the user to close their Chrome browser, then retry
2. If they can't close Chrome, ask them to run:
   `google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/krometrail-chrome <url>`
   Then use: `krometrail chrome start --attach`
3. Do NOT use `pkill -f chrome` — this kills Electron apps (Discord, VS Code, Unity Hub, etc.)
```

**Acceptance Criteria**:
- [ ] MCP navigation skill warns about Chrome wrapper absorption
- [ ] Chrome skill has explicit troubleshooting section
- [ ] Neither skill suggests `pkill`

---

## Implementation Order

1. **Unit 1** — Binary fallback chain. No dependencies, pure function change.
2. **Unit 3 + Unit 4** — Stale recorder cleanup + move setRecorder. These are the same code block in `browser-handlers.ts` and should be implemented together.
3. **Unit 2** — Error-specific MCP messages. Depends on understanding the error types but no code dependencies on Units 1/3/4.
4. **Unit 6** — `startedAt` validation. Independent formatting fix.
5. **Unit 5** — `console_levels` filter fix. Requires locating the exact filter code in the query engine; independent of other units.
6. **Unit 7** — Skill doc updates. Do last after code changes are finalized.

## Testing

### Unit Tests: `tests/unit/browser/chrome-launcher.test.ts`

Add tests:
```typescript
describe("findChromeBinary", () => {
	it("prefers direct binary paths over wrapper scripts");
	// Mock spawn to simulate /opt/google/chrome/chrome existing
});
```

Existing `waitForChrome` tests are unaffected.

### Unit Tests: `tests/unit/daemon/browser-handlers.test.ts` (new file)

```typescript
describe("browser.start stale recorder cleanup", () => {
	it("cleans up a stale non-recording recorder before creating a new one");
	it("does not call setRecorder if start() throws");
	it("overwrites a stopped recorder without error");
});
```

### Unit Tests: `tests/unit/mcp/browser-error-messages.test.ts` (new file)

```typescript
describe("chrome_start error messages", () => {
	it("surfaces ChromeEarlyExitError without pkill suggestion");
	it("surfaces CDPConnectionError with port alternative");
	it("surfaces ChromeNotFoundError with install instructions");
	it("falls through to errorResponse for unknown errors");
});
```

### Unit Tests: `tests/unit/browser/search-filter.test.ts` (new or existing)

```typescript
describe("console_levels filter scoping", () => {
	it("applies console_levels only to console events, not page_error events");
	it("returns page_error events when included in event_types regardless of console_levels");
});
```

## Verification Checklist

```bash
bun run test:unit                    # All unit tests pass
bun run lint                         # No lint errors
bun run test:e2e -- tests/e2e/browser  # Browser E2E tests pass (if Chrome available)
```
