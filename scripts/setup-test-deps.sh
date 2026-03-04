#!/usr/bin/env bash
set -euo pipefail

# Idempotent script to check/install debuggers needed for integration and e2e tests.

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

echo "Checking test dependencies..."
echo ""

# --- Python + debugpy ---
echo "Python:"
if command -v python3 &>/dev/null; then
    ok "python3 $(python3 --version 2>&1 | awk '{print $2}')"
else
    fail "python3 not found"
fi

if python3 -m debugpy --version &>/dev/null 2>&1; then
    ok "debugpy installed"
else
    warn "debugpy not found — installing..."
    pip3 install --user debugpy
    ok "debugpy installed"
fi

echo ""

# --- Node.js + js-debug adapter ---
echo "Node.js:"
if command -v node &>/dev/null; then
    ok "node $(node --version)"

    JS_DEBUG_CACHE="$HOME/.agent-lens/adapters/js-debug/js-debug/src/dapDebugServer.js"
    if [ -f "$JS_DEBUG_CACHE" ]; then
        ok "js-debug DAP adapter cached"
    else
        warn "js-debug DAP adapter not cached — downloading..."
        # Trigger the download by running a quick bun script
        bun -e "import { getJsDebugAdapterPath } from './src/adapters/js-debug-adapter.js'; await getJsDebugAdapterPath();"
        ok "js-debug DAP adapter cached"
    fi
else
    fail "node not found (needed for node adapter tests) — install from https://nodejs.org"
fi

echo ""

# --- Go + Delve ---
echo "Go:"
if command -v go &>/dev/null; then
    ok "go $(go version | awk '{print $3}')"
    if command -v dlv &>/dev/null; then
        ok "dlv (delve) installed"
    else
        warn "dlv not found — installing..."
        go install github.com/go-delve/delve/cmd/dlv@latest
        ok "dlv installed"
    fi
else
    warn "go not found (needed for go adapter tests — skipping dlv)"
fi


# --- Rust + CodeLLDB ---
echo "Rust:"
if command -v cargo &>/dev/null; then
    ok "cargo $(cargo --version | awk '{print $2}')"

    CODELLDB_CACHE="$HOME/.agent-lens/adapters/codelldb/adapter/codelldb"
    if [ -f "$CODELLDB_CACHE" ]; then
        ok "CodeLLDB DAP adapter cached"
    else
        warn "CodeLLDB DAP adapter not cached — downloading..."
        bun -e "import { downloadAndCacheCodeLLDB } from './src/adapters/rust.js'; await downloadAndCacheCodeLLDB();"
        ok "CodeLLDB DAP adapter cached"
    fi
else
    warn "cargo not found (needed for rust adapter tests) — install from https://rustup.rs"
fi

echo ""

# --- Java + java-debug-adapter ---
echo "Java:"
if command -v javac &>/dev/null; then
    JAVAC_VERSION=$(javac -version 2>&1 | awk '{print $2}')
    JAVAC_MAJOR=$(echo "$JAVAC_VERSION" | cut -d. -f1)
    if [ "$JAVAC_MAJOR" -ge 17 ] 2>/dev/null; then
        ok "javac $JAVAC_VERSION"

        JAVA_DEBUG_JAR="$HOME/.agent-lens/adapters/java-debug"
        if ls "$JAVA_DEBUG_JAR"/com.microsoft.java.debug.plugin-*.jar &>/dev/null 2>&1; then
            ok "java-debug-adapter JAR cached"
        else
            warn "java-debug-adapter JAR not cached — downloading..."
            bun -e "import { downloadAndCacheJavaDebugAdapter } from './src/adapters/java.js'; await downloadAndCacheJavaDebugAdapter();"
            ok "java-debug-adapter JAR cached"
        fi
    else
        warn "javac $JAVAC_VERSION found but JDK 17+ required (needed for java adapter tests)"
    fi
else
    warn "javac not found (needed for java adapter tests) — install JDK 17+:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        warn "  brew install openjdk@21"
    elif command -v dnf &>/dev/null; then
        warn "  sudo dnf install java-21-openjdk-devel"
    elif command -v apt-get &>/dev/null; then
        warn "  sudo apt-get install openjdk-21-jdk"
    elif command -v pacman &>/dev/null; then
        warn "  sudo pacman -S jdk21-openjdk"
    elif command -v zypper &>/dev/null; then
        warn "  sudo zypper install java-21-openjdk-devel"
    else
        warn "  See: https://adoptium.net"
    fi
fi

echo ""

# --- C/C++ + GDB ---
echo "C/C++:"
if command -v gdb &>/dev/null; then
    GDB_VERSION=$(gdb --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
    GDB_MAJOR=$(echo "$GDB_VERSION" | cut -d. -f1)
    if [ "$GDB_MAJOR" -ge 14 ] 2>/dev/null; then
        ok "gdb $GDB_VERSION (DAP support)"
    else
        warn "gdb $GDB_VERSION found but 14+ required for DAP support (needed for cpp adapter tests)"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            warn "  brew install gdb  (or use lldb-dap via xcode-select --install)"
        elif command -v dnf &>/dev/null; then
            warn "  sudo dnf install gdb"
        elif command -v apt-get &>/dev/null; then
            warn "  sudo apt-get install gdb"
        fi
    fi
else
    warn "gdb not found (needed for cpp adapter tests)"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        warn "  brew install gdb  (or use lldb-dap via xcode-select --install)"
    elif command -v dnf &>/dev/null; then
        warn "  sudo dnf install gdb"
    elif command -v apt-get &>/dev/null; then
        warn "  sudo apt-get install gdb"
    elif command -v pacman &>/dev/null; then
        warn "  sudo pacman -S gdb"
    elif command -v zypper &>/dev/null; then
        warn "  sudo zypper install gdb"
    fi
fi

echo ""
echo "Done. Missing tools will cause their adapter tests to be skipped."
