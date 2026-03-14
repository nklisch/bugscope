# Design: Rename bugscope → krometrail

## Overview

Full project rename from `bugscope` to `krometrail`. Covers every identifier, path, env var, config dir, doc reference, skill directory, script, and the GitHub repo + local folder.

### Naming Convention Map

| Context | Old | New |
|---|---|---|
| Package / CLI / MCP name | `bugscope` | `krometrail` |
| Title case (prose) | `Bugscope` | `Krometrail` |
| Error base class | `BugscopeError` | `KrometrailError` |
| Env var prefix | `BUGSCOPE_` | `KROMETRAIL_` |
| Config directory | `~/.bugscope/` | `~/.krometrail/` |
| Socket file | `bugscope.sock` | `krometrail.sock` |
| JS window bindings | `bugscopeMark`, `bugscopeScreenshot` | `krometrailMark`, `krometrailScreenshot` |
| Window guard | `window.__bugscopePanel` | `window.__krometrailPanel` |
| DOM element ID | `__bugscope_panel` | `__krometrail_panel` |
| DAP client/adapter ID | `"bugscope"` | `"krometrail"` |
| HAR creator name | `Bugscope Browser` | `Krometrail Browser` |
| Skill directories | `bugscope-cli/`, `bugscope-mcp/` | `krometrail-cli/`, `krometrail-mcp/` |

---

## Implementation Units

### Unit 1: Package & Build Config

**File**: `package.json`

Replace all occurrences:
- `"name": "bugscope"` → `"name": "krometrail"`
- `"bugscope": "./src/cli/index.ts"` → `"krometrail": "./src/cli/index.ts"`
- All `dist/bugscope*` → `dist/krometrail*` in build scripts

**Acceptance Criteria**:
- [ ] `bun run build` produces `dist/krometrail`
- [ ] `bun run dev --help` shows `krometrail` as the command name

---

### Unit 2: Error Hierarchy

**File**: `src/core/errors.ts`

```typescript
// Rename class and all references
export class KrometrailError extends Error {
	constructor(message: string, public readonly code: string) {
		super(message);
		this.name = "KrometrailError";
	}
}
```

All 13 subclasses keep their names (DAPTimeoutError, etc.) but `extends BugscopeError` → `extends KrometrailError`.

**Acceptance Criteria**:
- [ ] `BugscopeError` no longer exists anywhere in source
- [ ] All error subclasses extend `KrometrailError`
- [ ] `instanceof KrometrailError` works for all error types

---

### Unit 3: MCP Server Identity

**File**: `src/mcp/index.ts`

```typescript
const toolGroups = options.toolGroups ?? parseToolGroups(process.env.KROMETRAIL_TOOLS);

const server = new McpServer({
	name: "krometrail",
	version: "0.1.0",
});

const browserDataDir = process.env.KROMETRAIL_BROWSER_DATA_DIR ?? resolve(homedir(), ".krometrail", "browser");
```

**Acceptance Criteria**:
- [ ] MCP server reports name `"krometrail"`
- [ ] Env vars `KROMETRAIL_TOOLS` and `KROMETRAIL_BROWSER_DATA_DIR` are recognized
- [ ] Default data dir is `~/.krometrail/browser`

---

### Unit 4: CLI Identity

**File**: `src/cli/index.ts`

- `name: "bugscope"` → `name: "krometrail"`

**File**: `src/cli/commands/doctor.ts`

- `Bugscope v0.1.0` → `Krometrail v0.1.0`

**File**: `src/cli/commands/index.ts`, `src/cli/commands/browser.ts`

- Any prose/description references to "bugscope" or "Bugscope"

**Acceptance Criteria**:
- [ ] `krometrail --help` shows correct name
- [ ] `krometrail doctor` prints `Krometrail v0.1.0`

---

### Unit 5: DAP Client Identity

**File**: `src/core/dap-client.ts`

```typescript
clientID: "krometrail",
adapterID: "krometrail",
```

**Acceptance Criteria**:
- [ ] DAP initialize request sends `clientID: "krometrail"`

---

### Unit 6: Daemon Socket Path

**File**: `src/daemon/protocol.ts`

```typescript
export function getDaemonSocketPath(): string {
	const xdgRuntime = process.env.XDG_RUNTIME_DIR;
	if (xdgRuntime) {
		return join(xdgRuntime, "krometrail.sock");
	}
	const dir = join(homedir(), ".krometrail");
	mkdirSync(dir, { recursive: true });
	return join(dir, "krometrail.sock");
}
```

**File**: `src/daemon/server.ts`, `src/daemon/client.ts`, `src/daemon/entry.ts`

- Any "bugscope" references in log messages or comments

**Acceptance Criteria**:
- [ ] Socket path resolves to `krometrail.sock`
- [ ] Config dir is `~/.krometrail/`

---

### Unit 7: Browser Recorder Bindings

**File**: `src/browser/recorder/marker-overlay.ts`

```typescript
const MARK_BINDING = "krometrailMark";
const SCREENSHOT_BINDING = "krometrailScreenshot";
// ...
if (window.__krometrailPanel) return;
window.__krometrailPanel = true;
// ...
panel.id = '__krometrail_panel';
```

**File**: `src/browser/recorder/chrome-launcher.ts`

- Chrome profile path: `~/.bugscope/chrome-profiles/` → `~/.krometrail/chrome-profiles/`

**File**: `src/browser/storage/persistence.ts`

- Default data dir references

**File**: `src/browser/export/har.ts`

```typescript
creator: { name: "Krometrail Browser", version: "1.0" }
```

**Acceptance Criteria**:
- [ ] CDP bindings use `krometrailMark` / `krometrailScreenshot`
- [ ] Panel guard is `__krometrailPanel`
- [ ] HAR export creator is `Krometrail Browser`

---

### Unit 8: Adapter Cache Paths

**Files**: `src/adapters/kotlin.ts`, `src/adapters/csharp.ts`, `src/adapters/netcoredbg.ts`, `src/adapters/js-debug-adapter.ts`, and any other adapter referencing `~/.bugscope/adapters/`

Replace `~/.bugscope/adapters/` → `~/.krometrail/adapters/` (or however each adapter resolves its cache dir).

**Acceptance Criteria**:
- [ ] All adapter cache dirs resolve under `~/.krometrail/`

---

### Unit 9: MCP Tool Descriptions

**File**: `src/mcp/tools/index.ts`, `src/mcp/tools/browser.ts`, `src/mcp/tools/utils.ts`

- Any description strings or comments mentioning "bugscope" or "Bugscope"

**Acceptance Criteria**:
- [ ] No MCP tool description contains "bugscope"

---

### Unit 10: Scripts

**File**: `scripts/install.sh`

```bash
#!/usr/bin/env bash
# Install the krometrail CLI binary to ~/.local/bin

DEST="${KROMETRAIL_INSTALL_DIR:-$HOME/.local/bin}"
BINARY="dist/krometrail"

# ...
cp "$BINARY" "$DEST/krometrail"
chmod +x "$DEST/krometrail"
echo "Installed: $DEST/krometrail"
"$DEST/krometrail" --version 2>/dev/null || true
```

**File**: `scripts/setup-test-deps.sh`

- Any "bugscope" references

**Acceptance Criteria**:
- [ ] `bash scripts/install.sh` installs `~/.local/bin/krometrail`

---

### Unit 11: Test Files

**Scope**: All files under `tests/` containing "bugscope" (case-insensitive).

Key files:
- `tests/unit/core/errors.test.ts` — `BugscopeError` → `KrometrailError`
- `tests/unit/daemon/protocol.test.ts` — socket path assertions
- `tests/helpers/browser-test-harness.ts` — `BUGSCOPE_BROWSER_DATA_DIR` env var
- `tests/agent-harness/lib/harness.ts` — binary name, skill dir paths
- `tests/agent-harness/lib/config.ts` — any config references
- `tests/agent-harness/report.ts` — product name in output
- `tests/agent-harness/drivers/*.ts` — tool name references
- `tests/agent-harness/README.md` — prose
- All unit tests referencing `BUGSCOPE_*` env vars or `~/.bugscope/` paths

**Implementation Notes**:
- Use project-wide find-and-replace with the naming convention map
- Run tests after to catch any missed references

**Acceptance Criteria**:
- [ ] `bun run test:unit` passes
- [ ] No test file contains "bugscope" (case-insensitive)

---

### Unit 12: Skill Directories

**Directory renames**:
- `.agents/skills/bugscope-cli/` → `.agents/skills/krometrail-cli/`
- `.agents/skills/bugscope-mcp/` → `.agents/skills/krometrail-mcp/`

**File content**: Update all `.md` files within these directories plus:
- `.agents/installed.json` — skill name references
- `skill.md`, `skill/SKILL.md`, `skill/references/*.md` — all "bugscope" refs
- `src/browser/SKILL.md` — any refs

**Acceptance Criteria**:
- [ ] No directory or file under `.agents/skills/` contains "bugscope" in name or content

---

### Unit 13: Claude Config

**File**: `CLAUDE.md`

- Title: `# Krometrail`
- Binary path: `~/.local/bin/krometrail`
- Project Name: `krometrail`
- All prose references

**File**: `.claude/settings.local.json`

- Path references: `~/.bugscope/` → `~/.krometrail/`
- MCP tool patterns: `mcp__bugscope__*` → `mcp__krometrail__*`

**File**: `.claude/rules/patterns.md`

- Any "bugscope"/"Bugscope" references

**File**: `.claude/skills/patterns/error-hierarchy.md`

- `BugscopeError` → `KrometrailError`

**Acceptance Criteria**:
- [ ] No file under `.claude/` contains "bugscope" (case-insensitive)

---

### Unit 14: Documentation

**Scope**: All `.md` files in `docs/`, `README.md`, `mcp-debug-adapter-design.md`

Apply the naming convention map across all prose:
- `bugscope` → `krometrail` (CLI commands, config keys, paths)
- `Bugscope` → `Krometrail` (titles, sentences)
- `BUGSCOPE_` → `KROMETRAIL_` (env vars)
- `~/.bugscope/` → `~/.krometrail/`

**Implementation Notes**:
- ~50 markdown files, ~300+ occurrences total
- Bulk find-and-replace is safe here since "bugscope" is unique to this project

**Acceptance Criteria**:
- [ ] No `.md` file in the repo contains "bugscope" (case-insensitive)

---

### Unit 15: Benchmarks

**File**: `benchmarks/run.ts`

- Any "bugscope" references

**Acceptance Criteria**:
- [ ] No "bugscope" in benchmark files

---

### Unit 16: GitHub Repo Rename

**Manual step** via GitHub UI or CLI:

```bash
gh repo rename krometrail
```

Then update the one GitHub URL found in docs:
- `docs/guides/troubleshooting.md` line 257: `https://github.com/anthropics/bugscope/issues` → update to new repo URL

**Acceptance Criteria**:
- [ ] GitHub repo is renamed
- [ ] All GitHub URLs in docs point to new repo name

---

### Unit 17: Local Folder Rename

**Manual step** (after all code changes are committed):

```bash
mv ~/dev/bugscope ~/dev/krometrail
```

**Acceptance Criteria**:
- [ ] Working directory is `~/dev/krometrail`

---

### Unit 18: Dist Artifacts

**File**: `dist/bugscope`, `dist/agent-lens`

- Old binaries should be cleaned up
- New build produces `dist/krometrail`

**Acceptance Criteria**:
- [ ] `dist/krometrail` exists after build
- [ ] Old `dist/bugscope` removed

---

## Implementation Order

1. **Unit 2**: Error hierarchy (foundational — other code imports these)
2. **Unit 3**: MCP server identity
3. **Unit 4**: CLI identity
4. **Unit 5**: DAP client identity
5. **Unit 6**: Daemon socket path
6. **Unit 7**: Browser recorder bindings
7. **Unit 8**: Adapter cache paths
8. **Unit 9**: MCP tool descriptions
9. **Unit 1**: Package & build config
10. **Unit 10**: Scripts
11. **Unit 11**: Test files
12. **Unit 12**: Skill directories
13. **Unit 13**: Claude config
14. **Unit 14**: Documentation
15. **Unit 15**: Benchmarks
16. **Unit 18**: Dist cleanup + rebuild
17. **Unit 16**: GitHub repo rename (manual)
18. **Unit 17**: Local folder rename (manual, last)

**Implementation strategy**: Units 1–15 can be done as a single bulk find-and-replace operation across the repo, since "bugscope" is a unique token with no substring collisions. The replacements are:

| Find | Replace |
|---|---|
| `BugscopeError` | `KrometrailError` |
| `BUGSCOPE_` | `KROMETRAIL_` |
| `bugscopeMark` | `krometrailMark` |
| `bugscopeScreenshot` | `krometrailScreenshot` |
| `__bugscopePanel` | `__krometrailPanel` |
| `__bugscope_panel` | `__krometrail_panel` |
| `Bugscope` | `Krometrail` |
| `bugscope` | `krometrail` |

**Order matters** — replace specific identifiers (BugscopeError, BUGSCOPE_, bugscopeMark, etc.) before the generic `bugscope`/`Bugscope` catch-all to avoid double-replacing.

After bulk replace, manually handle:
- Directory renames (`.agents/skills/bugscope-*`)
- `bun.lock` — run `bun install` to regenerate
- Verify no "bugscope" remains: `grep -ri bugscope .`

## Testing

### Verification Commands

```bash
# Confirm no references remain
grep -ri "bugscope" --include="*.ts" --include="*.json" --include="*.md" --include="*.sh" .

# Rebuild
bun run build

# Run all tests
bun run test:unit
bun run lint

# Verify CLI
dist/krometrail --help
dist/krometrail doctor
```

## Verification Checklist

- [ ] `grep -ri bugscope` returns zero results (excluding git history and bun.lock)
- [ ] `bun run build` succeeds and produces `dist/krometrail`
- [ ] `bun run test:unit` passes
- [ ] `bun run lint` passes
- [ ] MCP server identifies as `krometrail`
- [ ] CLI shows `krometrail` in help output
- [ ] `scripts/install.sh` installs `~/.local/bin/krometrail`
- [ ] GitHub repo renamed
- [ ] Local folder is `~/dev/krometrail`
