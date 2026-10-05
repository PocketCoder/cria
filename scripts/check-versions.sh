#!/usr/bin/env bash
# Fail if the four version sources disagree. Optional arg: expected version.
# Use `pnpm bump` to change versions; never hand-edit.
set -euo pipefail

pkg=$(jq -r .version package.json)
conf=$(jq -r .version src-tauri/tauri.conf.json)
cargo=$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed -E 's/.*"(.*)".*/\1/')
lock=$(grep -A1 '^name = "cria"$' src-tauri/Cargo.lock | grep '^version = ' | sed -E 's/.*"(.*)".*/\1/')
want=${1:-$pkg}

echo "want=$want package.json=$pkg tauri.conf.json=$conf Cargo.toml=$cargo Cargo.lock=$lock"

fail=0
for pair in "package.json:$pkg" "tauri.conf.json:$conf" "Cargo.toml:$cargo" "Cargo.lock:$lock"; do
  if [ "${pair#*:}" != "$want" ]; then
    echo "::error::${pair%%:*} is ${pair#*:}, expected $want. Bump with 'pnpm bump $want'"
    fail=1
  fi
done
exit $fail
