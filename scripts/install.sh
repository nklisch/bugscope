#!/usr/bin/env bash
# Install the krometrail CLI binary to ~/.local/bin
# Run after every release: bash scripts/install.sh

set -euo pipefail

DEST="${KROMETRAIL_INSTALL_DIR:-$HOME/.local/bin}"
BINARY="dist/krometrail"

if [ ! -f "$BINARY" ]; then
  echo "Building..."
  bun run build
fi

mkdir -p "$DEST"
cp "$BINARY" "$DEST/krometrail"
chmod +x "$DEST/krometrail"

echo "Installed: $DEST/krometrail"
"$DEST/krometrail" --version 2>/dev/null || true
