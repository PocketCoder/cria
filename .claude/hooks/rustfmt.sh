#!/usr/bin/env bash
# PostToolUse hook: format any Rust file Claude just edited, so the
# "Rust checks" CI job (cargo fmt --check) never fails on style.
f=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
case "$f" in
  *.rs) command -v rustfmt >/dev/null && rustfmt --edition 2021 "$f" ;;
esac
exit 0
