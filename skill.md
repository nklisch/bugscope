# Krometrail Skills

Three skills for AI agents, following the [Agent Skills specification](https://agentskills.io/specification).

## Install

```bash
# All three skills
npx skills add nklisch/krometrail --skill krometrail-debug krometrail-chrome krometrail-mcp

# Just the debugger
npx skills add nklisch/krometrail --skill krometrail-debug

# Just browser observation
npx skills add nklisch/krometrail --skill krometrail-chrome

# Navigation guide only (load this first if unsure)
npx skills add nklisch/krometrail --skill krometrail-mcp
```

## Skills

### krometrail-debug

Runtime debugging — breakpoints, stepping, variable inspection across 10 languages.

```
.agents/skills/krometrail-debug/
  SKILL.md
  references/
    cli.md          # Debug CLI commands
    python.md       # Python (debugpy)
    javascript.md   # JavaScript/TypeScript (js-debug)
    go.md           # Go (Delve)
    rust.md         # Rust (CodeLLDB)
    cpp.md          # C/C++ (GDB/LLDB)
    java.md         # Java (JDWP)
```

### krometrail-chrome

Browser observation — session recording, network/console/DOM/framework capture, batch browser actions, investigation tools.

```
.agents/skills/krometrail-chrome/
  SKILL.md
  references/
    chrome.md       # Browser recording and investigation commands
```

### krometrail-mcp

Navigation guide — which namespace to use, which skill to load, common pitfalls. Includes language references for Python, Node.js, and Go.

```
.agents/skills/krometrail-mcp/
  SKILL.md
  references/
    python.md       # Python (debugpy) quick reference
    node.md         # Node.js / TypeScript (js-debug) quick reference
    go.md           # Go (Delve) quick reference
```
