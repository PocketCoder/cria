#!/usr/bin/env bash
set -euo pipefail

read_ver() { node -p "require('./package.json').version"; }

usage() {
  echo "Usage: $0 <patch|minor|major|X.Y.Z>"
  echo "  Bump version in package.json, Cargo.toml, tauri.conf.json"
  exit 1
}

CMD=${1:-}
CUR=$(read_ver)

case "$CMD" in
  patch|minor|major)
    NEW=$(node -e "
      const [maj, min, pat] = '$CUR'.split('.').map(Number);
      const v = { patch: [maj, min, pat+1], minor: [maj, min+1, 0], major: [maj+1, 0, 0] };
      console.log(v['$CMD'].join('.'));
    ")
    ;;
  [0-9]*.[0-9]*.[0-9]*)
    NEW=$CMD
    ;;
  *)
    usage
    ;;
esac

if [ "$CUR" = "$NEW" ]; then echo "Already at $CUR"; exit 0; fi

echo "Bumping $CUR → $NEW"

# Update all three files
sed -i '' 's/"version": "'"$CUR"'"/"version": "'"$NEW"'"/' package.json
sed -i '' 's/^version = "'"$CUR"'"/version = "'"$NEW"'"/' src-tauri/Cargo.toml
sed -i '' 's/"version": "'"$CUR"'"/"version": "'"$NEW"'"/' src-tauri/tauri.conf.json

cargo check --manifest-path src-tauri/Cargo.toml --quiet

echo "Done — $CUR → $NEW (Cargo.lock updated)"

node -e "
  const p = require('./package.json').version;
  const c = require('./src-tauri/tauri.conf.json').version;
  console.log('  package.json:       ' + p);
  console.log('  tauri.conf.json:    ' + c);
"
grep '^version' src-tauri/Cargo.toml | sed 's/version/  Cargo.toml:        version/'