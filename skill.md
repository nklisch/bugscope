# Krometrail Skill

The krometrail skill is defined in the [`skill/`](skill/) directory using the [Agent Skills specification](https://agentskills.io/specification).

## Install

```bash
# skilltap
skilltap install ./skill

# Manual: copy skill/ to your agent's skills directory
```

## Structure

```
skill/
  SKILL.md                    # Main skill file (frontmatter + instructions)
  references/
    cli.md                    # Full CLI command reference
    python.md                 # Python-specific setup and tips
    javascript.md             # JavaScript/TypeScript debugging
    go.md                     # Go (Delve) debugging
    rust.md                   # Rust (CodeLLDB) debugging
    cpp.md                    # C/C++ (GDB/LLDB) debugging
    java.md                   # Java debugging
```
