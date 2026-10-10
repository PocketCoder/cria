#!/usr/bin/env bash
# Build one section of docs/SWIFT-IOS-PLAN.md with Haiku 5.5 via OpenRouter.
# Usage: scripts/haiku-section.sh S-10
# Needs OPENROUTER_API_KEY in the environment. Optional EXTRA env var is
# appended to the prompt (e.g. a CI failure excerpt for a retry). Edits files only; the caller
# commits, pushes and checks CI.
set -euo pipefail

sec="${1:?usage: haiku-section.sh S-NN}"
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set}"
model="${HAIKU_MODEL:-anthropic/claude-haiku-5.5}"
plan="docs/SWIFT-IOS-PLAN.md"

text="$(awk -v s="**$sec " '
  index($0, s) == 1 { on = 1; print; next }
  on && (/^\*\*S-[0-9][0-9] / || /^## / || /^---$/) { exit }
  on { print }
' "$plan")"
[ -n "$text" ] || { echo "section $sec not found in $plan" >&2; exit 2; }

rules="$(awk '/^## How to use this plan/{on=1} /^---$/{if(on) exit} on' "$plan")"

prompt="You are building one section of the native Swift iOS port of Cria.
Read AGENTS.md first, then the TypeScript source this section ports and its
tests in tests/unit/. Swift code goes under ios-native/ (CriaKit package for
logic). Port tests first or alongside. Edit files only: do not run git, do not
commit, do not push. This machine has no Xcode, so do not try to build Swift;
CI will. Never weaken, skip or delete tests. Do not add features beyond the
section. When done, print one line: DONE <files changed>, or BLOCKED <reason>.

Plan rules:
$rules

Your section:
$text
${EXTRA:+
Extra context (fix this):
$EXTRA}"

ANTHROPIC_BASE_URL="https://openrouter.ai/api" \
ANTHROPIC_AUTH_TOKEN="$OPENROUTER_API_KEY" \
ANTHROPIC_API_KEY="" \
claude -p "$prompt" \
  --model "$model" \
  --max-turns "${MAX_TURNS:-60}" \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Glob,Grep,Bash(ls:*),Bash(git status:*),Bash(git diff:*)"
