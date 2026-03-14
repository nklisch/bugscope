# Design: Phase 3 — Viewport Intelligence

## Overview

Phase 3 transforms the viewport from a static snapshot renderer into an intelligent, context-aware system. It adds five capabilities that make long debug sessions sustainable within agent context windows:

1. **Watch expressions** — upgrade from stub to full auto-evaluation with error handling and removal support
2. **Session logging** — rich action recording with key observation extraction and periodic compression
3. **Viewport diffing** — when consecutive stops are in the same function, show only what changed
4. **Progressive compression** — automatically reduce viewport detail as action count increases
5. **Token budget estimation** — track cumulative viewport tokens and expose via status/log

Phase 3 builds on the complete Phase 1 + 2 foundation. The key files being modified:

- `src/core/session-manager.ts` — `DebugSession` state, `buildViewport()`, `handleStopResult()`, action logging, watch expressions
- `src/core/viewport.ts` — `renderViewport()` gains diff mode and compression awareness
- `src/core/types.ts` — new types for diff snapshots, compression config, enriched action log
- `src/mcp/tools/index.ts` — upgraded `debug_watch` (add/remove), enriched `debug_session_log`, new `debug_unwatch`
- `src/daemon/protocol.ts` — new RPC methods for unwatch
- `src/cli/commands/index.ts` — unwatch CLI command

**No existing tests or interfaces are broken.** All changes are additive or internal refactors. The existing viewport format is preserved as the default; diff mode and compression layer on top.

---

## Implementation Units

### Unit 1: Enriched Action Log Types

**File**: `src/core/types.ts`

Add types for the enriched action log, viewport diffing, and compression tiers.

```typescript
// --- Compression Tiers ---

export interface CompressionTier {
	/** Action count threshold to activate this tier */
	minActions: number;
	/** Override viewport config for this tier */
	overrides: Partial<ViewportConfig>;
	/** Enable diff mode automatically at this tier */
	diffMode: boolean;
}

export const DEFAULT_COMPRESSION_TIERS: CompressionTier[] = [
	// Tier 0: actions 1–20 — full viewport (defaults)
	{ minActions: 0, overrides: {}, diffMode: false },
	// Tier 1: actions 21–50 — moderate compression
	{ minActions: 21, overrides: { stackDepth: 3, stringTruncateLength: 80, collectionPreviewItems: 3 }, diffMode: false },
	// Tier 2: actions 51–100 — heavy compression + auto diff
	{ minActions: 51, overrides: { stackDepth: 2, stringTruncateLength: 60, collectionPreviewItems: 2, localsMaxItems: 10 }, diffMode: true },
	// Tier 3: actions 100+ — minimal viewport
	{ minActions: 100, overrides: { stackDepth: 1, stringTruncateLength: 40, collectionPreviewItems: 1, localsMaxItems: 5, sourceContextLines: 7 }, diffMode: true },
];

// --- Enriched Action Log ---

export interface ActionObservation {
	/** Type of observation */
	kind: "unexpected_value" | "variable_changed" | "new_frame" | "exception" | "bp_hit" | "terminated";
	/** Human-readable description */
	description: string;
}

export interface EnrichedActionLogEntry {
	actionNumber: number;
	tool: string;
	/** Key parameters (e.g., expression for evaluate, direction for step) */
	keyParams: Record<string, unknown>;
	summary: string;
	timestamp: number;
	/** Extracted observations from viewport at this action */
	observations: ActionObservation[];
	/** Location at this action (file:line function) */
	location?: string;
}

// --- Viewport Diff ---

export interface VariableChange {
	name: string;
	oldValue: string;
	newValue: string;
}

export interface ViewportDiff {
	/** True if this is a diff (same file + function as previous) */
	isDiff: true;
	file: string;
	line: number;
	function: string;
	reason: StopReason;
	/** Only variables whose values changed */
	changedVariables: VariableChange[];
	/** Count of unchanged variables */
	unchangedCount: number;
	/** New or removed stack frames relative to previous */
	stackChanges?: { added: StackFrame[]; removed: StackFrame[] };
	/** Source context only if current line moved out of previous window */
	source?: SourceLine[];
	/** Watch expression results (always included) */
	watches?: Variable[];
	/** Compression note if active */
	compressionNote?: string;
}

// --- Token Tracking ---

export interface TokenStats {
	/** Estimated tokens consumed by viewport output across session */
	viewportTokensConsumed: number;
	/** Number of viewports rendered */
	viewportCount: number;
}
```

Also extend `ViewportSnapshot` with an optional compression note:

```typescript
export interface ViewportSnapshot {
	// ... existing fields unchanged ...
	/** Compression note appended to viewport when active */
	compressionNote?: string;
}
```

**Implementation Notes**:
- `DEFAULT_COMPRESSION_TIERS` is a module-level constant, not configurable per-session initially. Session-level override is possible via `viewportConfig` which always takes precedence.
- `ViewportDiff` is a separate type from `ViewportSnapshot` — the viewport renderer accepts either via a union.

**Acceptance Criteria**:
- [ ] All new types compile with no errors
- [ ] `DEFAULT_COMPRESSION_TIERS` has 4 tiers at action boundaries 0, 21, 51, 100
- [ ] `EnrichedActionLogEntry` extends the existing `ActionLogEntry` fields (backward-compatible)
- [ ] `ViewportDiff` captures changed variables with old and new values

---

### Unit 2: Viewport Diff Renderer

**File**: `src/core/viewport.ts`

Extend `renderViewport` to accept a diff and add a new `renderViewportDiff` function.

```typescript
/**
 * Render a compact diff viewport showing only changes from the previous stop.
 * Used when consecutive stops are in the same function.
 */
export function renderViewportDiff(diff: ViewportDiff, config: ViewportConfig): string;

/**
 * Determine if two ViewportSnapshots are eligible for diff mode.
 * Criteria: same file, same function, same stack depth.
 */
export function isDiffEligible(current: ViewportSnapshot, previous: ViewportSnapshot): boolean;

/**
 * Compute a ViewportDiff from two consecutive ViewportSnapshots.
 */
export function computeViewportDiff(
	current: ViewportSnapshot,
	previous: ViewportSnapshot,
	compressionNote?: string,
): ViewportDiff;
```

**Diff format output** (matches ARCH.md):

```
── STEP at order.py:148 (same frame) ──
Reason: step

Source (146–150):
 →148│   charge_result = payment.charge(user.card, total)

Changed:
  charge_result  = <ChargeResult: success=False, error="card_declined">
  (5 locals unchanged)

Watch:
  total > 0  = True
```

**Implementation Notes**:
- `isDiffEligible` checks: `current.file === previous.file && current.function === previous.function && current.stack.length === previous.stack.length`
- `computeViewportDiff` compares `current.locals` against `previous.locals` by name. Variables present in both with different `value` are "changed". Variables in current but not previous are "added" (treated as changed). Variables in previous but not current are omitted (they went out of scope).
- Source context in diff: if `current.line` is within the previous source window range, omit source entirely. If it moved outside, include the new source window.
- The header says `(same frame)` instead of showing the full stack.
- Watch expressions are always rendered in full (never diffed) since they're the agent's explicit monitoring targets.

**Acceptance Criteria**:
- [ ] `isDiffEligible` returns true for same file+function+stack depth, false otherwise
- [ ] `computeViewportDiff` correctly identifies changed, added, and unchanged variables
- [ ] `renderViewportDiff` produces the compact format from ARCH.md
- [ ] Source is omitted when current line is within the previous source window
- [ ] Source is included when current line moved outside the previous window
- [ ] Watch expressions always appear in diff output
- [ ] Compression note appears when present

---

### Unit 3: Progressive Compression Engine

**File**: `src/core/compression.ts` (new file)

Encapsulates the logic for selecting compression tiers and computing effective viewport config.

```typescript
import type { CompressionTier, ViewportConfig } from "./types.js";
import { DEFAULT_COMPRESSION_TIERS } from "./types.js";

/**
 * Resolve the active compression tier based on the current action count.
 * Returns the tier with the highest `minActions` that is <= actionCount.
 */
export function resolveCompressionTier(
	actionCount: number,
	tiers?: CompressionTier[],
): CompressionTier;

/**
 * Compute the effective ViewportConfig by merging the session's base config
 * with the compression tier overrides.
 * Session-level config always takes precedence over tier defaults for fields
 * that were explicitly set by the user at launch.
 */
export function computeEffectiveConfig(
	baseConfig: ViewportConfig,
	tier: CompressionTier,
): ViewportConfig;

/**
 * Determine if diff mode should be active based on tier and session state.
 */
export function shouldUseDiffMode(
	tier: CompressionTier,
	sessionDiffMode?: boolean,
): boolean;

/**
 * Generate a compression note for the viewport footer.
 * Returns undefined if no compression is active (tier 0).
 */
export function compressionNote(
	actionCount: number,
	maxActions: number,
	tier: CompressionTier,
): string | undefined;

/**
 * Estimate token count for a string (rough heuristic: chars / 4).
 */
export function estimateTokens(text: string): number;
```

**Implementation Notes**:
- `resolveCompressionTier` iterates `DEFAULT_COMPRESSION_TIERS` in reverse to find the highest matching tier. With 4 tiers this is O(1) effectively.
- `computeEffectiveConfig` merges: `{ ...baseConfig, ...tier.overrides }`. If the user explicitly set a viewport config field at launch time, that field should NOT be overridden by compression. This requires tracking which fields were user-specified vs defaulted — handled via an `explicitFields` set on the session (see Unit 5).
- `compressionNote` returns e.g., `"(compressed: action 35/200, use debug_variables for full locals)"` for tier 1+. Returns `undefined` for tier 0.
- `estimateTokens` uses `Math.ceil(text.length / 4)` — a rough but adequate estimate matching the roadmap spec.

**Acceptance Criteria**:
- [ ] `resolveCompressionTier(1)` returns tier 0 (no compression)
- [ ] `resolveCompressionTier(21)` returns tier 1
- [ ] `resolveCompressionTier(51)` returns tier 2
- [ ] `resolveCompressionTier(100)` returns tier 3
- [ ] `resolveCompressionTier(200)` returns tier 3
- [ ] `computeEffectiveConfig` merges tier overrides into base config
- [ ] `shouldUseDiffMode` returns true when tier has `diffMode: true`
- [ ] `compressionNote` returns undefined for tier 0, descriptive string for tier 1+
- [ ] `estimateTokens("hello")` returns 2

---

### Unit 4: Enriched Session Logging

**File**: `src/core/session-logger.ts` (new file)

Dedicated module for the enriched session log — observation extraction, periodic compression, and formatted output.

```typescript
import type { ActionObservation, EnrichedActionLogEntry, Variable, ViewportSnapshot } from "./types.js";

/**
 * Extract notable observations from a viewport snapshot.
 * Used to annotate the action log with key findings.
 */
export function extractObservations(
	snapshot: ViewportSnapshot,
	previousSnapshot: ViewportSnapshot | null,
): ActionObservation[];

/**
 * Format the session log in summary mode.
 * Includes action number, tool, summary, location, and observations.
 * Entries older than the compression window are collapsed into a summary paragraph.
 */
export function formatSessionLogSummary(
	entries: EnrichedActionLogEntry[],
	compressionWindowSize: number,
	sessionElapsedMs: number,
	tokenStats: { viewportTokensConsumed: number; viewportCount: number },
): string;

/**
 * Format the session log in detailed mode.
 * Includes timestamps and full observation details.
 */
export function formatSessionLogDetailed(
	entries: EnrichedActionLogEntry[],
	sessionElapsedMs: number,
	tokenStats: { viewportTokensConsumed: number; viewportCount: number },
): string;

/**
 * Generate a compressed summary paragraph from a slice of action log entries.
 * Condenses N entries into 2-3 sentences capturing the key observations.
 */
export function compressEntries(entries: EnrichedActionLogEntry[]): string;
```

**Observation extraction rules** (in `extractObservations`):
- `"bp_hit"`: when `snapshot.reason === "breakpoint"`, emit `"BP hit at {file}:{line}"`
- `"exception"`: when `snapshot.reason === "exception"`, emit `"Exception at {file}:{line}"`
- `"variable_changed"`: compare `snapshot.locals` with `previousSnapshot.locals` — for each variable whose value changed, emit `"{name}: {oldValue} → {newValue}"`
- `"unexpected_value"`: heuristic checks on locals — negative numbers where positive expected (variable name contains "count", "total", "amount", "price" and value is negative), null/None for variables that had a value before
- `"new_frame"`: when the top-of-stack function differs from previous, emit `"Entered {function}"`
- `"terminated"`: when session terminates

**Summary log format**:
```
Session Log (12 actions, 45s elapsed, ~2400 viewport tokens):

Summary of actions 1-10:
  Launched pytest, hit BP at order.py:147. discount=-149.97 (unexpected negative).
  Stepped into calculate_discount. base_rate=1.0 suggests wrong multiplier.

 11. [debug_evaluate] Evaluated: tier_multipliers → {"gold": 1.0} — at discount.py:18
 12. [debug_stop] Session terminated
```

**Detailed log format**:
```
Session Log (12 actions, 45s elapsed, ~2400 viewport tokens):

#1 2024-01-15T10:30:00.000Z [debug_launch] Launched pytest tests/test_order.py
#2 2024-01-15T10:30:01.200Z [debug_continue] → order.py:147 (process_order)
   Observations:
   - BP hit at order.py:147
   - discount = -149.97 (unexpected negative for "discount")
...
```

**Implementation Notes**:
- `compressionWindowSize` defaults to 10 (matching ROADMAP.md). Entries 1 through `max(0, entries.length - compressionWindowSize)` are compressed into a summary paragraph. The most recent `compressionWindowSize` entries are shown individually.
- `compressEntries` extracts observations from the entries, deduplicates by description, and joins them into a prose paragraph.
- Token stats (`viewportTokensConsumed`, `viewportCount`) are included in both log formats as a header line.

**Acceptance Criteria**:
- [ ] `extractObservations` returns `"bp_hit"` for breakpoint stops
- [ ] `extractObservations` returns `"variable_changed"` when locals differ from previous
- [ ] `extractObservations` returns `"unexpected_value"` for negative totals/counts/amounts/prices
- [ ] `formatSessionLogSummary` compresses entries older than the compression window
- [ ] `formatSessionLogSummary` includes token stats in header
- [ ] `formatSessionLogDetailed` includes timestamps and full observations
- [ ] `compressEntries` produces a 1-3 sentence summary paragraph
- [ ] Empty entry list produces `"No actions logged."`

---

### Unit 5: Session Manager Integration

**File**: `src/core/session-manager.ts`

Integrate watch expression removal, enriched logging, viewport diffing, progressive compression, and token tracking into the session manager.

#### 5a: Extend DebugSession interface

```typescript
export interface DebugSession {
	// ... existing fields unchanged ...

	/** Enriched action log (replaces basic actionLog) */
	actionLog: EnrichedActionLogEntry[];

	/** Previous viewport snapshot for diff computation */
	previousSnapshot: ViewportSnapshot | null;

	/** Whether diff mode is enabled for this session */
	diffMode: boolean;

	/** Cumulative token stats */
	tokenStats: TokenStats;

	/** Fields explicitly set by user in viewportConfig (not auto-compressed) */
	explicitViewportFields: Set<string>;
}
```

#### 5b: New and modified methods

```typescript
// --- Watch expression management ---

/**
 * Remove watch expressions from the session.
 * Accepts expressions to remove. Returns remaining watch list.
 */
removeWatchExpressions(sessionId: string, expressions: string[]): string[];

// --- Enhanced logAction (private, replaces existing) ---

/**
 * Log an action with enriched data including observations and location.
 */
private logAction(
	session: DebugSession,
	tool: string,
	summary: string,
	keyParams?: Record<string, unknown>,
	snapshot?: ViewportSnapshot | null,
): void;

// --- Modified handleStopResult (private, replaces existing) ---

/**
 * Handle stop result with diff mode, compression, and observation extraction.
 * 1. Resolve compression tier from action count
 * 2. Compute effective viewport config (base + compression overrides)
 * 3. Build viewport snapshot
 * 4. If diff-eligible and diff mode active, compute diff and render diff viewport
 * 5. Otherwise render full viewport
 * 6. Extract observations, log enriched action entry
 * 7. Track token consumption
 * 8. Store snapshot as previousSnapshot for next diff
 */
private async handleStopResult(session: DebugSession, stopResult: StopResult): Promise<string>;

// --- Modified buildViewport (private, unchanged signature) ---
// Uses computeEffectiveConfig to apply compression tier overrides.

// --- Modified getSessionLog (replaces existing) ---

/**
 * Return enriched session log with observations, compression, and token stats.
 */
getSessionLog(sessionId: string, format?: "summary" | "detailed"): string;

// --- Modified getStatus (replaces existing) ---

/**
 * Includes token stats in status response.
 */
async getStatus(sessionId: string): Promise<{
	status: SessionStatus;
	viewport?: string;
	tokenStats?: TokenStats;
	actionCount?: number;
	elapsedMs?: number;
}>;
```

**Implementation Notes**:
- **Diff mode activation**: Diff mode is activated by: (a) explicit session config (`diffMode: true` on launch), or (b) automatic activation by the compression tier when `tier.diffMode === true`. The session's `diffMode` field is initially `false` and gets set to `true` when a tier with `diffMode: true` is reached.
- **handleStopResult flow**:
  1. `resolveCompressionTier(session.actionCount)` to get the active tier
  2. `computeEffectiveConfig(session.viewportConfig, tier)` for effective config
  3. `buildViewport(session)` using the effective config
  4. If `session.previousSnapshot && isDiffEligible(snapshot, session.previousSnapshot) && shouldUseDiffMode(tier, session.diffMode)`:
     - `computeViewportDiff(snapshot, session.previousSnapshot, compressionNote(...))`
     - `renderViewportDiff(diff, effectiveConfig)`
  5. Else: `renderViewport(snapshot, effectiveConfig)` (with compression note if tier > 0)
  6. `extractObservations(snapshot, session.previousSnapshot)` → store in log
  7. `session.tokenStats.viewportTokensConsumed += estimateTokens(renderedViewport)`
  8. `session.previousSnapshot = snapshot`
- **explicitViewportFields**: Populated at launch time from the `viewportConfig` option. If the user passes `{ stackDepth: 10 }`, then `explicitViewportFields = new Set(["stackDepth"])`. `computeEffectiveConfig` respects these by not overriding those fields.
- **removeWatchExpressions**: Filters `session.watchExpressions` to remove matching expressions. Logs the removal action.

**Acceptance Criteria**:
- [ ] `removeWatchExpressions` removes specified expressions and returns remaining list
- [ ] `removeWatchExpressions` with unknown expression is a no-op (no error)
- [ ] `handleStopResult` uses compression tier based on action count
- [ ] At action 25, viewport config has `stackDepth: 3` (tier 1 override)
- [ ] At action 55, diff mode is auto-activated
- [ ] `previousSnapshot` is set after each stop for diff computation
- [ ] Token stats increment on each viewport render
- [ ] `getSessionLog` returns enriched log with observations
- [ ] `getStatus` includes `tokenStats`, `actionCount`, `elapsedMs`
- [ ] User-explicit viewport config fields are NOT overridden by compression
- [ ] Existing tests continue to pass (backward-compatible)

---

### Unit 6: MCP Tool Updates

**File**: `src/mcp/tools/index.ts`

Upgrade existing tools and add `debug_unwatch`.

#### 6a: Upgrade `debug_watch` tool

Add `action` parameter to support add/remove:

```typescript
server.tool(
	"debug_watch",
	"Manage watch expressions. Watched expressions are automatically evaluated and shown in every viewport snapshot.",
	{
		session_id: z.string().describe("The active debug session"),
		action: z.enum(["add", "remove"]).optional().describe("Whether to add or remove expressions. Default: 'add'"),
		expressions: z.array(z.string()).describe(
			"Expressions to add or remove from the watch list. " +
			"E.g., ['len(cart.items)', 'user.tier', 'total > 0']"
		),
	},
	async ({ session_id, action, expressions }) => {
		// Dispatch to addWatchExpressions or removeWatchExpressions
	},
);
```

#### 6b: Upgrade `debug_session_log` tool

Return enriched log format:

```typescript
server.tool(
	"debug_session_log",
	"Get the investigation log for the current session. " +
	"Shows actions taken, key observations (unexpected values, variable changes), " +
	"and cumulative viewport token consumption. Older entries are automatically " +
	"compressed into summaries. Use this to reconstruct your reasoning chain " +
	"without re-reading old viewports.",
	{
		session_id: z.string().describe("The active debug session"),
		format: z.enum(["summary", "detailed"]).optional().describe(
			"Level of detail. 'summary' compresses older entries. " +
			"'detailed' includes timestamps and full observations. Default: 'summary'"
		),
	},
	async ({ session_id, format }) => {
		// Delegate to sessionManager.getSessionLog
	},
);
```

#### 6c: Upgrade `debug_status` tool

Include token stats in response:

```typescript
// In the debug_status handler, after getting status:
const text = result.viewport
	? `Status: ${result.status}\nActions: ${result.actionCount}, Elapsed: ${result.elapsedMs}ms, Viewport tokens: ${result.tokenStats?.viewportTokensConsumed ?? 0}\n\n${result.viewport}`
	: `Status: ${result.status}\nActions: ${result.actionCount ?? 0}, Elapsed: ${result.elapsedMs ?? 0}ms, Viewport tokens: ${result.tokenStats?.viewportTokensConsumed ?? 0}`;
```

**Implementation Notes**:
- The `debug_watch` tool's `action` parameter defaults to `"add"` for backward compatibility. Existing callers that don't pass `action` continue to work.
- No separate `debug_unwatch` MCP tool is needed — the `action: "remove"` parameter on `debug_watch` covers the use case cleanly.

**Acceptance Criteria**:
- [ ] `debug_watch` with `action: "add"` adds expressions (backward-compatible)
- [ ] `debug_watch` with `action: "remove"` removes expressions
- [ ] `debug_watch` without `action` defaults to add
- [ ] `debug_session_log` returns enriched format with observations and token stats
- [ ] `debug_status` includes token stats, action count, and elapsed time
- [ ] All tool descriptions are updated with Phase 3 guidance

---

### Unit 7: Daemon Protocol & CLI Updates

**File**: `src/daemon/protocol.ts`, `src/cli/commands/index.ts`

#### 7a: Protocol update

Extend `RpcMethods` to support the enhanced watch action:

```typescript
export type RpcMethods = {
	// ... existing methods unchanged ...

	// Updated intelligence
	"session.watch": { params: WatchParams; result: string[] };
	"session.unwatch": { params: UnwatchParams; result: string[] };
};

export const UnwatchParamsSchema = z.object({
	sessionId: z.string(),
	expressions: z.array(z.string()),
});
export type UnwatchParams = z.infer<typeof UnwatchParamsSchema>;
```

Update `StatusResultPayload`:

```typescript
export interface StatusResultPayload {
	status: string;
	viewport?: string;
	tokenStats?: { viewportTokensConsumed: number; viewportCount: number };
	actionCount?: number;
	elapsedMs?: number;
}
```

#### 7b: CLI unwatch command

```typescript
export const unwatchCommand = defineCommand({
	meta: { name: "unwatch", description: "Remove watch expressions" },
	args: {
		expressions: {
			type: "positional",
			description: "Expression(s) to stop watching",
			required: true,
		},
		...globalArgs,
	},
	async run({ args }) {
		// Call "session.unwatch" RPC
	},
});
```

#### 7c: CLI status command update

Show token stats in status output when not in quiet mode.

#### 7d: Register in daemon server

Add `"session.unwatch"` dispatch in `src/daemon/server.ts` to call `sessionManager.removeWatchExpressions`.

#### 7e: Register in CLI entry

Add `unwatchCommand` to the CLI command tree in `src/cli/index.ts`.

**Acceptance Criteria**:
- [ ] `session.unwatch` RPC method defined with Zod schema
- [ ] `StatusResultPayload` includes token stats, action count, elapsed time
- [ ] `krometrail unwatch "expr"` removes a watch expression
- [ ] `krometrail status` shows token stats
- [ ] Daemon server dispatches `session.unwatch` correctly

---

### Unit 8: Token Budget Tracking

**File**: `src/core/session-manager.ts` (integrated with Unit 5)

Token tracking is wired into the session lifecycle:

```typescript
// In handleStopResult, after rendering the viewport:
const tokens = estimateTokens(renderedViewport);
session.tokenStats.viewportTokensConsumed += tokens;
session.tokenStats.viewportCount += 1;
```

The token stats are exposed via:
- `getStatus()` — includes `tokenStats` in response
- `getSessionLog()` — includes token stats in log header
- `debug_status` MCP tool — includes token stats in text output

**Implementation Notes**:
- The token estimator is intentionally simple (`Math.ceil(text.length / 4)`) per the roadmap. A more sophisticated tokenizer would add a dependency and complexity without proportional benefit.
- Token tracking only counts viewport output, not tool overhead or agent reasoning. This matches the roadmap's scope.

**Acceptance Criteria**:
- [ ] After rendering 5 viewports of ~400 chars each, `viewportTokensConsumed` ≈ 500
- [ ] `viewportCount` equals the number of viewports rendered
- [ ] Token stats are included in session log header
- [ ] Token stats are included in status response

---

## Implementation Order

1. **Unit 1: Enriched Action Log Types** — all other units depend on these types
2. **Unit 3: Progressive Compression Engine** — standalone module, no dependencies beyond types
3. **Unit 2: Viewport Diff Renderer** — depends on types (Unit 1)
4. **Unit 4: Enriched Session Logging** — depends on types (Unit 1)
5. **Unit 5: Session Manager Integration** — depends on Units 1-4, this is the main integration point
6. **Unit 6: MCP Tool Updates** — depends on Unit 5
7. **Unit 7: Daemon Protocol & CLI Updates** — depends on Unit 5
8. **Unit 8: Token Budget Tracking** — implemented within Unit 5, verified separately

Units 2, 3, and 4 can be implemented in parallel after Unit 1. Units 6 and 7 can be implemented in parallel after Unit 5.

```
Unit 1 (types)
  ├── Unit 2 (viewport diff) ─────┐
  ├── Unit 3 (compression engine)─┤
  └── Unit 4 (session logger) ────┘
                                  │
                              Unit 5 (session manager integration)
                                  │
                       ┌──────────┼──────────┐
                   Unit 6 (MCP) Unit 7 (CLI) Unit 8 (tokens)
```

---

## Testing

### Unit Tests: `tests/unit/core/compression.test.ts`

```typescript
describe("resolveCompressionTier", () => {
	it("returns tier 0 for actions 1-20");
	it("returns tier 1 for actions 21-50");
	it("returns tier 2 for actions 51-99");
	it("returns tier 3 for actions 100+");
});

describe("computeEffectiveConfig", () => {
	it("merges tier overrides into base config");
	it("does not override user-explicit fields");
});

describe("shouldUseDiffMode", () => {
	it("returns false for tier 0");
	it("returns true for tier 2+");
	it("returns true when session diff mode is explicitly enabled");
});

describe("compressionNote", () => {
	it("returns undefined for tier 0");
	it("returns descriptive string for tier 1+");
	it("includes action count and max actions");
});

describe("estimateTokens", () => {
	it("returns chars / 4 rounded up");
	it("returns 0 for empty string");
});
```

### Unit Tests: `tests/unit/core/viewport-diff.test.ts`

```typescript
describe("isDiffEligible", () => {
	it("returns true for same file, function, and stack depth");
	it("returns false when file differs");
	it("returns false when function differs");
	it("returns false when stack depth differs");
});

describe("computeViewportDiff", () => {
	it("identifies changed variables");
	it("identifies added variables as changes");
	it("counts unchanged variables");
	it("omits source when line is within previous window");
	it("includes source when line moved outside previous window");
	it("includes watches in full");
	it("includes compression note when provided");
});

describe("renderViewportDiff", () => {
	it("renders compact diff with changed variables only");
	it("shows (same frame) in header");
	it("shows unchanged count");
	it("renders watch expressions");
	it("shows compression note");
	it("produces fewer tokens than full viewport for same-frame step");
});
```

### Unit Tests: `tests/unit/core/session-logger.test.ts`

```typescript
describe("extractObservations", () => {
	it("detects breakpoint hits");
	it("detects exception stops");
	it("detects variable changes between snapshots");
	it("detects unexpected negative values for amount/total/count/price variables");
	it("detects new function entry");
	it("returns empty array when no notable observations");
});

describe("formatSessionLogSummary", () => {
	it("shows recent entries individually");
	it("compresses older entries into summary paragraph");
	it("includes token stats header");
	it("handles empty log");
});

describe("formatSessionLogDetailed", () => {
	it("shows all entries with timestamps");
	it("includes observation details");
	it("includes token stats header");
});

describe("compressEntries", () => {
	it("produces 1-3 sentence summary from entries");
	it("deduplicates repeated observations");
	it("preserves key location and value information");
});
```

### Unit Tests: `tests/unit/core/viewport.test.ts` (extended)

Add test cases to the existing viewport test file:

```typescript
describe("renderViewport with compression note", () => {
	it("appends compression note at end of viewport");
});
```

### Unit Tests: `tests/unit/core/session-manager.test.ts` (extended)

Add test cases to the existing session manager test file:

```typescript
describe("removeWatchExpressions", () => {
	it("throws SessionNotFoundError for unknown session");
	// Integration tests cover the actual removal logic with a real session
});
```

### Integration Tests: `tests/integration/viewport-intelligence.test.ts`

```typescript
describe.skipIf(SKIP_NO_DEBUGPY)("Viewport Intelligence integration", () => {
	it("diff mode produces compact output for consecutive steps in same function");
	it("diff mode falls back to full viewport when function changes");
	it("progressive compression reduces viewport detail at action 21+");
	it("watch expressions auto-evaluate on every stop");
	it("watch expression errors show <error> instead of failing");
	it("removeWatchExpressions removes expressions from viewport");
	it("session log includes observations from stops");
	it("session log compresses entries after compression window");
	it("token stats accumulate across stops");
});
```

### E2E Tests: `tests/e2e/mcp/viewport-intelligence.test.ts`

```typescript
describe.skipIf(SKIP_NO_DEBUGPY)("E2E: Viewport Intelligence", () => {
	it("debug_watch add + remove cycle works", async () => {
		// Launch session, add watch, step, verify watch in viewport
		// Remove watch, step, verify watch absent from viewport
	});

	it("debug_session_log returns enriched observations", async () => {
		// Launch session, hit breakpoint, step a few times
		// Call debug_session_log, verify observations present
	});

	it("debug_status includes token stats", async () => {
		// Launch session, stop on entry, check status
		// Verify tokenStats in response
	});
});
```

---

## Verification Checklist

```bash
# All existing tests still pass (backward compatibility)
bun run test:unit

# New unit tests pass
bun run test tests/unit/core/compression.test.ts
bun run test tests/unit/core/viewport-diff.test.ts
bun run test tests/unit/core/session-logger.test.ts

# Integration tests pass (requires debugpy)
bun run test:integration

# E2E tests pass (requires debugpy)
bun run test:e2e

# Lint passes
bun run lint

# Type check passes
bunx tsc --noEmit
```
