# Design: MCP Server Auto-Update

## Overview

Auto-update the Krometrail MCP server on startup so agents always get the latest tools without manual intervention. Supports all three installation methods: compiled binary, npx/bunx, and global npm install.

### Strategy by Install Type

| Install type | Detection | Update mechanism |
|---|---|---|
| **Binary** (`~/.local/bin/krometrail`) | `process.execPath` is not inside a `node_modules` dir and is not a bun/node binary | Download latest release binary from GitHub, atomically replace on disk |
| **npx/bunx** | `process.argv` contains `npx` or `bunx`, or running from a `.npm/_npx` / `.bun` cache dir | Update docs to recommend `@latest` tag; at runtime, log stderr hint if not using `@latest` |
| **Global npm** | `process.execPath` resolves through a global `node_modules` path | Spawn `npm update -g krometrail` or `bun update -g krometrail` in background |

### Behavior

- Runs **only on MCP startup** (`--mcp` flag), not on CLI commands
- **Fire-and-forget** — never blocks or delays MCP server startup
- **Silent** — no user interaction; logs to stderr only on actual update or error
- **Opt-out** via `KROMETRAIL_NO_UPDATE=1` environment variable
- **Throttled** — checks at most once per hour (stores timestamp in `~/.krometrail/last-update-check`)
- **Safe** — if any step fails, the server starts normally with the current version

### Non-Goals

- No rollback mechanism (users can pin versions or re-run install.sh)
- No automatic restart of the running MCP server — updates take effect on next startup
- No update mechanism for development installs (`bun run mcp`)

---

## Implementation Units

### Unit 1: Install Type Detection

**File**: `src/core/auto-update.ts`

```typescript
/** How krometrail was installed */
export type InstallType = "binary" | "npx" | "bunx" | "global-npm" | "dev";

export interface InstallInfo {
	type: InstallType;
	/** Absolute path to the krometrail binary (for binary installs) */
	binaryPath: string | undefined;
	/** Package manager command (for global-npm installs) */
	packageManager: "npm" | "bun" | undefined;
}

/**
 * Detect how krometrail was installed by inspecting process.execPath,
 * process.argv, and the module resolution path.
 */
export function detectInstallType(): InstallInfo;
```

**Implementation Notes**:
- **Binary detection**: `process.execPath` ends with `/krometrail` (or `krometrail.exe` on Windows) and is NOT inside a `node_modules` directory. This covers both `~/.local/bin/krometrail` and custom install paths. Also check that `process.execPath` does not contain `/.bun/` or similar cache paths.
- **npx detection**: Check if `process.env.npm_execpath` is set (npm sets this), or if `process.execPath` contains `/.npm/_npx/`. For bunx, check for `/.bun/install/` in the module path.
- **Global npm detection**: Running from a `node_modules` path but NOT in an npx cache. Check `process.argv[1]` (the script path) for `/lib/node_modules/krometrail/` patterns.
- **Dev detection**: `process.env.BUN_ENV === "development"` or running via `bun run` from the repo (check for `src/cli/index.ts` in argv). Skip update entirely for dev installs.

**Acceptance Criteria**:
- [ ] Binary install at `~/.local/bin/krometrail` detected as `"binary"` with correct `binaryPath`
- [ ] `npx krometrail --mcp` detected as `"npx"`
- [ ] `bunx krometrail --mcp` detected as `"bunx"`
- [ ] `npm install -g` detected as `"global-npm"` with `packageManager: "npm"`
- [ ] `bun run src/cli/index.ts --mcp` detected as `"dev"`

---

### Unit 2: Version Check (GitHub API)

**File**: `src/core/auto-update.ts`

```typescript
export interface VersionCheckResult {
	/** Latest version tag from GitHub (e.g. "v0.3.0") */
	latestVersion: string;
	/** Whether an update is available */
	updateAvailable: boolean;
	/** Current version from package.json */
	currentVersion: string;
}

/**
 * Check GitHub releases API for the latest version.
 * Returns null if the check fails or is throttled.
 * Uses a 5-second timeout to avoid blocking.
 */
export async function checkLatestVersion(): Promise<VersionCheckResult | null>;
```

**Implementation Notes**:
- Fetch `https://api.github.com/repos/nklisch/krometrail/releases/latest`
- Parse `tag_name` from the JSON response (e.g. `"v0.3.0"`)
- Compare against `pkg.version` from `package.json` using simple semver comparison (strip `v` prefix, split on `.`, compare numerically)
- Use `AbortSignal.timeout(5000)` to prevent hanging on slow networks
- Set `User-Agent: krometrail/${version}` header (GitHub requires this for API requests)

**Acceptance Criteria**:
- [ ] Returns `updateAvailable: true` when remote version is newer
- [ ] Returns `updateAvailable: false` when versions match
- [ ] Returns `null` on network error without throwing
- [ ] Respects 5-second timeout

---

### Unit 3: Throttle Gate

**File**: `src/core/auto-update.ts`

```typescript
const THROTTLE_FILE = "~/.krometrail/last-update-check";
const THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Returns true if enough time has passed since the last check.
 * Updates the timestamp file if returning true.
 */
export function shouldCheckForUpdate(): boolean;
```

**Implementation Notes**:
- Read `~/.krometrail/last-update-check` — file contains a single Unix timestamp (milliseconds)
- If file doesn't exist or timestamp is older than 1 hour, return `true` and write current timestamp
- If timestamp is within 1 hour, return `false`
- Create `~/.krometrail/` directory if it doesn't exist (use `mkdirSync` with `recursive: true`)
- On any filesystem error (permissions, etc.), return `true` (fail open — allow the check)

**Acceptance Criteria**:
- [ ] Returns `true` on first run (no file exists)
- [ ] Returns `false` when called again within 1 hour
- [ ] Returns `true` after 1 hour has elapsed
- [ ] Creates `~/.krometrail/` directory if missing
- [ ] Returns `true` if file read fails (fail open)

---

### Unit 4: Binary Updater

**File**: `src/core/auto-update.ts`

```typescript
/**
 * Download the latest binary and atomically replace the current one.
 * Returns true on success, false on failure (logged to stderr).
 */
export async function updateBinary(
	binaryPath: string,
	version: string,
): Promise<boolean>;
```

**Implementation Notes**:
- Detect platform and architecture:
  - `process.platform` → `"linux"` | `"darwin"`
  - `process.arch` → `"x64"` | `"arm64"`
- Construct download URL: `https://github.com/nklisch/krometrail/releases/download/${version}/krometrail-${platform}-${arch}`
- Download to a temp file in the same directory as the binary (ensures same filesystem for atomic rename): `${binaryPath}.update.${Date.now()}`
- Verify the download succeeded (file size > 0)
- **Skip checksum verification** — adds complexity and another HTTP request; the GitHub download URL is HTTPS and the binary is code-signed in CI
- `chmod +x` the temp file
- Atomic rename: `rename(tempPath, binaryPath)` — on Unix, this is atomic and safe even while the current binary is running (the OS keeps the old inode open)
- On macOS, remove quarantine attribute: `xattr -d com.apple.quarantine`
- Clean up temp file on any error
- Log to stderr: `[krometrail] Updated to ${version} (restart to use new version)`

**Acceptance Criteria**:
- [ ] Downloads correct binary for current platform/arch
- [ ] Atomically replaces binary at `binaryPath`
- [ ] Cleans up temp file on download failure
- [ ] Returns `false` (not throw) on any error
- [ ] Logs update success to stderr

---

### Unit 5: Package Manager Updater

**File**: `src/core/auto-update.ts`

```typescript
/**
 * Update global npm/bun package in the background.
 * Fire-and-forget — never throws.
 */
export async function updateGlobalPackage(
	packageManager: "npm" | "bun",
): Promise<void>;
```

**Implementation Notes**:
- Spawn `npm update -g krometrail` or `bun update -g krometrail` as a detached subprocess
- Use `Bun.spawn` with `{ detached: true, stdio: ["ignore", "ignore", "ignore"] }` so it doesn't block the process
- Catch all errors silently — this is best-effort
- Log to stderr: `[krometrail] Updating via ${pm}...`

**Acceptance Criteria**:
- [ ] Spawns the correct update command
- [ ] Does not block or throw
- [ ] Works for both npm and bun

---

### Unit 6: Orchestrator

**File**: `src/core/auto-update.ts`

```typescript
/**
 * Main entry point. Detects install type, checks for updates,
 * and performs the appropriate update action.
 *
 * Fire-and-forget — never throws, never blocks MCP startup.
 * Called without await from the MCP entry point.
 */
export function performAutoUpdate(): void;
```

**Implementation Notes**:
- Check `KROMETRAIL_NO_UPDATE` env var — if set and truthy, return immediately
- Call `detectInstallType()` — if `"dev"`, return immediately
- Call `shouldCheckForUpdate()` — if `false`, return immediately
- Start an async IIFE (fire-and-forget, no await at call site):
  1. `checkLatestVersion()` — if `null` or `updateAvailable: false`, return
  2. Based on install type:
     - `"binary"`: call `updateBinary(binaryPath, latestVersion)`
     - `"global-npm"`: call `updateGlobalPackage(packageManager)`
     - `"npx"` or `"bunx"`: log to stderr suggesting `@latest` tag if the invocation doesn't already include it
- Wrap entire async body in try/catch that silently swallows errors (auto-update must never crash the server)

**Acceptance Criteria**:
- [ ] Returns synchronously (does not block)
- [ ] Respects `KROMETRAIL_NO_UPDATE=1`
- [ ] Skips dev installs
- [ ] Respects throttle gate
- [ ] Routes to correct updater based on install type
- [ ] Never throws or rejects

---

### Unit 7: MCP Entry Point Integration

**File**: `src/mcp/index.ts`

```typescript
// Add import
import { performAutoUpdate } from "../core/auto-update.js";

// Add in startMcpServer(), before server.connect():
performAutoUpdate(); // fire-and-forget, like telemetry
```

**Implementation Notes**:
- Single line addition — call `performAutoUpdate()` without `await`
- Place after adapter registration but before `server.connect()` so the update check starts early
- Follows the same fire-and-forget pattern as `sendPing()` in the CLI entry

**Acceptance Criteria**:
- [ ] `performAutoUpdate()` called on MCP startup
- [ ] Not called on CLI commands (only in MCP path)
- [ ] Does not delay server startup (no await)

---

### Unit 8: Documentation Updates

**File**: `docs/guide/mcp-configuration.md`

Update all npx/bunx examples to use `@latest` tag:

```diff
- "args": ["krometrail", "--mcp"]
+ "args": ["krometrail@latest", "--mcp"]
```

This applies to all configuration examples: Claude Code, Cursor, Windsurf, OpenAI Codex.

Also update `docs/guides/claude-code.md` and `docs/guides/cursor-windsurf.md` if they contain MCP config examples.

Add a new section to `docs/guide/mcp-configuration.md`:

```markdown
## Auto-Updates

Krometrail checks for updates on every MCP server startup and updates itself
automatically. Updates take effect the next time the server starts.

- **Binary installs** download the latest release from GitHub
- **npx/bunx** uses the `@latest` tag (no download needed)
- **Global npm/bun** runs the package manager's update command

To disable auto-updates, set the environment variable in your MCP config:

\`\`\`json
{
  "mcpServers": {
    "krometrail": {
      "command": "krometrail",
      "args": ["--mcp"],
      "env": {
        "KROMETRAIL_NO_UPDATE": "1"
      }
    }
  }
}
\`\`\`
```

**Acceptance Criteria**:
- [ ] All npx/bunx examples use `@latest` tag
- [ ] Auto-update section documents behavior and opt-out
- [ ] Claude Code CLI examples updated

---

## Implementation Order

1. **Unit 1: Install Type Detection** — no dependencies, needed by everything else
2. **Unit 3: Throttle Gate** — no dependencies, simple filesystem logic
3. **Unit 2: Version Check** — no dependencies, pure HTTP
4. **Unit 4: Binary Updater** — depends on platform detection concepts from Unit 1
5. **Unit 5: Package Manager Updater** — no dependencies, simple spawn
6. **Unit 6: Orchestrator** — depends on all above units
7. **Unit 7: MCP Entry Point Integration** — depends on Unit 6
8. **Unit 8: Documentation Updates** — independent, can be done anytime

Units 1-5 can be implemented in any order (all within the same file). Unit 6 composes them. Unit 7 is a one-line change. Unit 8 is independent.

---

## Testing

### Unit Tests: `tests/unit/core/auto-update.test.ts`

**Install type detection**:
- Mock `process.execPath` and `process.argv` for each install type scenario
- Test binary detection with various paths (`~/.local/bin/krometrail`, `/usr/local/bin/krometrail`, custom paths)
- Test npx/bunx detection via cache path patterns
- Test dev detection

**Version comparison**:
- `"0.2.4"` vs `"0.3.0"` → update available
- `"0.2.4"` vs `"0.2.4"` → no update
- `"0.3.0"` vs `"0.2.4"` → no update (current is newer, e.g. dev build)
- Handle `"v"` prefix stripping

**Throttle gate**:
- Mock filesystem (or use temp dir) to test timestamp logic
- Test first-run (no file), within-throttle, and expired-throttle cases

**Orchestrator**:
- Mock all dependencies, verify routing logic:
  - `KROMETRAIL_NO_UPDATE=1` → no check
  - `dev` install → no check
  - Throttled → no check
  - Binary + update available → calls `updateBinary`
  - Global npm + update available → calls `updateGlobalPackage`
  - npx without @latest → logs hint

### E2E Test: `tests/e2e/auto-update.test.ts`

- Skip unless `KROMETRAIL_TEST_UPDATE=1` (avoid actual GitHub API calls in CI)
- Start MCP server, verify it creates the throttle file at `~/.krometrail/last-update-check`
- Verify `KROMETRAIL_NO_UPDATE=1` prevents the throttle file from being created/updated

---

## Verification Checklist

```bash
# Unit tests pass
bun run test:unit

# Lint passes
bun run lint

# Manual: start MCP server and check stderr for update log
KROMETRAIL_NO_UPDATE=0 bun run mcp 2>/tmp/krometrail-stderr.log &
sleep 2; kill %1; cat /tmp/krometrail-stderr.log

# Manual: verify opt-out works
KROMETRAIL_NO_UPDATE=1 bun run mcp 2>/tmp/krometrail-stderr.log &
sleep 2; kill %1; cat /tmp/krometrail-stderr.log
# Should have no update-related output
```
