#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"

# linuxdeploy's GTK plugin is not idempotent and fails on stale AppDir symlinks.
rm -rf \
  "$ROOT_DIR/target/debug/bundle/appimage" \
  "$ROOT_DIR/target/x86_64-unknown-linux-gnu/release/bundle/appimage"

cd "$APP_DIR"
pnpm exec dotenv -e .env.tauri.local -- tauri build --target x86_64-unknown-linux-gnu --config src-tauri/tauri.local.conf.json --bundles appimage
