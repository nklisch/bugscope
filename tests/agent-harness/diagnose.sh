#!/usr/bin/env bash
# Diagnostic script: test Claude Code spawning outside the harness.
# Run this from a separate terminal (NOT inside a claude code session).
#
# Usage: bash tests/agent-harness/diagnose.sh

set -uo pipefail

echo "=== Environment check ==="
echo "CLAUDECODE env var: ${CLAUDECODE:-<not set>}"
echo "Claude version: $(claude --version 2>&1)"
echo ""

# Create a temp workspace similar to what the harness does
WORKDIR=$(mktemp -d /tmp/krometrail-diag-XXXXXX)
echo "=== Workspace: $WORKDIR ==="

# Copy the python-discount-bug scenario
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCENARIO_DIR="$SCRIPT_DIR/scenarios/python-discount-bug/src"
cp -r "$SCENARIO_DIR"/* "$WORKDIR/"

# Init git
cd "$WORKDIR"
git init -q
git add -A
GIT_AUTHOR_NAME=diag GIT_AUTHOR_EMAIL=diag@test \
GIT_COMMITTER_NAME=diag GIT_COMMITTER_EMAIL=diag@test \
git commit -q -m 'initial' --no-gpg-sign

echo "=== Files in workspace ==="
ls -la "$WORKDIR"
echo ""

# Helper: run claude with a timeout, kill process group on timeout
run_with_timeout() {
  local timeout_sec=$1
  shift
  # Run in background, capture PID
  "$@" &
  local pid=$!
  # Wait up to timeout
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$timeout_sec" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "(killing after ${timeout_sec}s timeout)"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    return 124
  fi
  wait "$pid" 2>/dev/null
  return $?
}

# Test 1: Minimal claude -p (text output)
echo "=== Test 1: claude -p with text output (15s timeout) ==="
run_with_timeout 15 claude -p "Say hello" --dangerously-skip-permissions >"$WORKDIR/stdout1.txt" 2>"$WORKDIR/stderr1.txt" || true
echo "stdout bytes: $(wc -c < "$WORKDIR/stdout1.txt")"
echo "stderr bytes: $(wc -c < "$WORKDIR/stderr1.txt")"
echo "stdout: $(head -3 "$WORKDIR/stdout1.txt")"
echo "stderr: $(head -3 "$WORKDIR/stderr1.txt")"
echo ""

# Test 2: With stream-json output
echo "=== Test 2: claude -p with stream-json (15s timeout) ==="
run_with_timeout 15 claude -p "Say hello" --dangerously-skip-permissions --output-format stream-json --verbose >"$WORKDIR/stdout2.txt" 2>"$WORKDIR/stderr2.txt" || true
echo "stdout bytes: $(wc -c < "$WORKDIR/stdout2.txt")"
echo "stderr bytes: $(wc -c < "$WORKDIR/stderr2.txt")"
echo "stdout first line: $(head -1 "$WORKDIR/stdout2.txt")"
echo "stderr: $(head -3 "$WORKDIR/stderr2.txt")"
echo ""

echo "=== Done. Workspace: $WORKDIR ==="
echo "Inspect full output:"
echo "  cat $WORKDIR/stdout1.txt"
echo "  cat $WORKDIR/stdout2.txt"
