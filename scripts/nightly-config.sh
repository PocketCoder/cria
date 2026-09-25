#!/usr/bin/env bash
# CI-only: rewrite src-tauri/tauri.conf.json in place into the "Cria (Nightly)"
# channel. Separate identifier = separate app, data dir, and iOS bundle, so it
# installs beside stable Cria. Updater reads nightly.json instead of update.json.
# Usage: nightly-config.sh [version]   (omit version to keep the stable one, e.g. iOS)
set -euo pipefail
conf=src-tauri/tauri.conf.json
jq --arg v "${1:-}" '
  .productName = "Cria (Nightly)"
  | .identifier = "io.cria.app.nightly"
  | .app.windows[0].title = "Cria (Nightly)"
  | .plugins.updater.endpoints = ["https://pocketcoder.github.io/cria/nightly.json"]
  | if $v != "" then .version = $v else . end
' "$conf" > "$conf.tmp" && mv "$conf.tmp" "$conf"
jq '{productName, version, identifier, endpoints: .plugins.updater.endpoints}' "$conf"
