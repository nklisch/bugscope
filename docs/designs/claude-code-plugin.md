# Design: Claude Code Plugin

## Overview

Package krometrail as a Claude Code plugin so users can install it with `/plugin install krometrail` and get the MCP server, skills, and tool permissions configured automatically. The plugin lives in this repo at `plugin/` and is referenced from the `nklisch/skills` marketplace via `git-subdir` source.

## Plugin Directory Structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── settings.json
└── skills/
    ├── krometrail-mcp/
    │   ├── SKILL.md
    │   └── references/
    │       ├── python.md
    │       ├── node.md
    │       └── go.md
    ├── krometrail-debug/
    │   ├── SKILL.md
    │   └── references/
    │       ├── cli.md
    │       ├── python.md
    │       ├── javascript.md
    │       ├── go.md
    │       ├── rust.md
    │       ├── cpp.md
    │       └── java.md
    └── krometrail-chrome/
        ├── SKILL.md
        └── references/
            └── chrome.md
```

## Implementation Units

### Unit 1: plugin.json

**File**: `plugin/.claude-plugin/plugin.json`

```json
{
  "name": "krometrail",
  "description": "Runtime debugging for AI agents — debug 10 languages via DAP, record and control Chrome via CDP.",
  "version": "0.2.19",
  "author": {
    "name": "nklisch"
  },
  "homepage": "https://krometrail.dev",
  "repository": "https://github.com/nklisch/krometrail",
  "license": "MIT"
}
```

**Implementation Notes**:
- Version should match `package.json` version. Consider whether the bump script should also update this, or whether plugin versioning is independent.
- Name `krometrail` means skills install as `/krometrail:krometrail-debug`, `/krometrail:krometrail-chrome`, `/krometrail:krometrail-mcp`.

**Acceptance Criteria**:
- [ ] Valid JSON matching Claude Code plugin.json schema
- [ ] Name matches npm package name

---

### Unit 2: .mcp.json

**File**: `plugin/.mcp.json`

```json
{
  "mcpServers": {
    "krometrail": {
      "command": "sh",
      "args": [
        "-c",
        "command -v krometrail >/dev/null && exec krometrail mcp || exec npx krometrail@latest mcp"
      ]
    }
  }
}
```

**Implementation Notes**:
- Prefers local binary (installed via `install.sh` or `dev-install.sh`) for fast startup — no npm download delay.
- Falls back to `npx krometrail@latest` for users who haven't installed the binary. npx caches after first run.
- Uses `exec` to replace the shell process so the MCP server runs as PID 1 in the process group (clean signal handling).
- `sh -c` is POSIX — works on macOS and Linux. Windows users would need a different config (out of scope for now).

**Acceptance Criteria**:
- [ ] Valid `.mcp.json` format recognized by Claude Code
- [ ] Server starts successfully when `krometrail` binary is in PATH
- [ ] Server starts successfully via npx when binary is not in PATH
- [ ] `exec` ensures clean process hierarchy (no orphan `sh` wrapper)

---

### Unit 3: settings.json

**File**: `plugin/settings.json`

```json
{
  "permissions": {
    "allow": [
      "mcp__krometrail__*"
    ]
  }
}
```

**Implementation Notes**:
- Auto-allows all krometrail MCP tools (`debug_*`, `chrome_*`, `session_*`) so the agent isn't prompted on every tool call.
- The `mcp__krometrail__*` pattern matches the MCP server name `krometrail` from `.mcp.json` and wildcards all tools.
- Users can override this in their own settings if they want more restrictive permissions.

**Acceptance Criteria**:
- [ ] Valid Claude Code settings.json format
- [ ] All 30 MCP tools (18 debug + 6 chrome + 6 session) are auto-allowed without per-call prompts

---

### Unit 4: Skills (copy from .agents/skills/)

**Files**: `plugin/skills/krometrail-{mcp,debug,chrome}/`

Copy the three existing skills and their reference files from `.agents/skills/` into `plugin/skills/`. The SKILL.md content stays identical — the skills are already well-written.

**Changes needed for plugin context**:
- The `allowed-tools` frontmatter in krometrail-debug and krometrail-chrome currently says `Bash(krometrail:*)`. In a plugin context where the MCP server is auto-configured, the skills should also reference MCP tools. However, the CLI skill content is still valid for users who use the CLI directly, so keep both.
- No other changes needed — the skills are already self-contained with references.

**File inventory** (14 files total):

| Skill | Files |
|-------|-------|
| `krometrail-mcp` | `SKILL.md`, `references/python.md`, `references/node.md`, `references/go.md` |
| `krometrail-debug` | `SKILL.md`, `references/cli.md`, `references/python.md`, `references/javascript.md`, `references/go.md`, `references/rust.md`, `references/cpp.md`, `references/java.md` |
| `krometrail-chrome` | `SKILL.md`, `references/chrome.md` |

**Acceptance Criteria**:
- [ ] All 14 files copied with content identical to `.agents/skills/` originals
- [ ] Directory structure matches `skills/<skill-name>/SKILL.md` + `references/` convention
- [ ] Skills are loadable via `/krometrail:krometrail-debug` etc. after plugin install

---

### Unit 5: Marketplace entry in nklisch/skills

**File**: `/home/nathan/dev/skills/.claude-plugin/marketplace.json` (edit existing)

Add a new entry to the `plugins` array:

```json
{
  "name": "krometrail",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/nklisch/krometrail",
    "path": "plugin"
  },
  "description": "Runtime debugging for AI agents — debug 10 languages via DAP, record and control Chrome via CDP.",
  "category": "developer-tools",
  "tags": ["debugging", "dap", "cdp", "mcp", "browser"]
}
```

**Implementation Notes**:
- Uses `git-subdir` because the plugin lives at `plugin/` within the krometrail repo, not at the repo root.
- Description matches plugin.json for consistency.
- This entry lets users discover and install krometrail from the `nklisch/skills` marketplace without the krometrail repo being a marketplace itself.

**Acceptance Criteria**:
- [ ] Valid marketplace.json after edit
- [ ] `/plugin install krometrail` resolves to the correct repo and subdirectory
- [ ] Plugin appears in `/plugin marketplace list` after marketplace is added

---

## Implementation Order

1. **Unit 1: plugin.json** — manifest, no dependencies
2. **Unit 4: Skills** — copy files into plugin/skills/
3. **Unit 2: .mcp.json** — MCP server config
4. **Unit 3: settings.json** — permissions
5. **Unit 5: Marketplace entry** — cross-repo edit, do last

Units 1-4 are all in this repo and can be done in one pass. Unit 5 is a separate repo edit.

## Open Questions

### Plugin version syncing

Should `scripts/bump-version.ts` also update `plugin/.claude-plugin/plugin.json` version? Options:
- **Yes, auto-sync** — plugin version always matches npm package. Simple for users.
- **No, independent** — plugin could version independently if skill content changes without code changes.

Recommendation: auto-sync. The plugin bundles MCP tool references that are coupled to the server version.

### Windows support

The `sh -c` fallback in `.mcp.json` doesn't work on Windows. Options:
- Ignore for now (krometrail's user base is macOS/Linux developers)
- Add a second `.mcp.json` entry or platform-conditional config (if Claude Code supports it)

Recommendation: ignore for now, document the limitation.

### MCP skill adaptation

The `krometrail-mcp` navigation skill currently references CLI tool namespaces (`debug_*`, `chrome_*`, `session_*`). These map 1:1 to MCP tool names, so the skill works for both CLI and MCP usage. No changes needed.

### skilltap compatibility

Users who install via skilltap get the skills only (no MCP config, no permissions). This is fine — skilltap's purpose is agent-agnostic skill distribution. Document that for full auto-configuration, use `/plugin install`.

## Testing

### Manual verification checklist

1. Install the marketplace: `/plugin marketplace add nklisch/skills`
2. Install the plugin: `/plugin install krometrail`
3. Verify skills appear: `/krometrail:krometrail-debug`, `/krometrail:krometrail-chrome`, `/krometrail:krometrail-mcp`
4. Verify MCP server starts: check that `debug_launch` and `chrome_start` tools are available
5. Verify permissions: MCP tool calls should not prompt for approval
6. Test with binary in PATH: server should start without npx
7. Test without binary in PATH: server should fall back to npx

## Verification Checklist

```bash
# Validate plugin.json is valid JSON
bun -e "JSON.parse(require('fs').readFileSync('plugin/.claude-plugin/plugin.json', 'utf8'))"

# Validate .mcp.json is valid JSON
bun -e "JSON.parse(require('fs').readFileSync('plugin/.mcp.json', 'utf8'))"

# Validate settings.json is valid JSON
bun -e "JSON.parse(require('fs').readFileSync('plugin/settings.json', 'utf8'))"

# Verify all 14 skill files exist
find plugin/skills -type f | wc -l  # should be 14

# Verify skill directory structure
ls plugin/skills/krometrail-mcp/SKILL.md
ls plugin/skills/krometrail-debug/SKILL.md
ls plugin/skills/krometrail-chrome/SKILL.md

# Verify marketplace.json is valid after edit
bun -e "JSON.parse(require('fs').readFileSync('../skills/.claude-plugin/marketplace.json', 'utf8'))"
```
