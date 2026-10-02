#!/usr/bin/env bash
# Runs one behavioural eval through a real agent CLI and grades the report.
#
# Usage: run_agent.sh <claude|claude-baseline|codex|opencode> <eval-id|name> <outdir>
#
# Each run gets a freshly built fixture so earlier runs cannot contaminate it.
# The skill must be installed where the agent looks (~/.claude/skills or
# ~/.agents/skills). claude-baseline runs Claude with skills disabled.
# Writes <outdir>/{prompt.txt,report.md,agent.log,grading.json}.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
AGENT="${1:?agent}" EVAL="${2:?eval id or name}" OUT="${3:?outdir}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd -P)"

read -r FIXTURE PROMPT < <(python3 - "$HERE/evals.json" "$EVAL" <<'EOF'
import json, sys
evals = json.load(open(sys.argv[1]))["evals"]
e = next(e for e in evals if str(e["id"]) == sys.argv[2] or e["name"] == sys.argv[2])
print(e["fixture"], e["prompt"].replace("\n", " "))
EOF
)

FX_ROOT="$OUT/fixture"
rm -rf "$FX_ROOT"
"$HERE/fixtures/build.sh" "$FX_ROOT" >/dev/null
REPO="$FX_ROOT/$FIXTURE"
PROMPT="${PROMPT//\{repo\}/$REPO} Give the complete report in your final message."
printf '%s\n' "$PROMPT" >"$OUT/prompt.txt"
python3 "$HERE/grade.py" snapshot "$REPO" "$OUT/snapshot.json"

start=$(date +%s)
case "$AGENT" in
  claude)
    (cd "$REPO" && claude -p "$PROMPT" --allowedTools "Bash,Read,Grep,Glob,Skill" >"$OUT/report.md" 2>"$OUT/agent.log") ;;
  claude-baseline)
    (cd "$REPO" && claude -p "$PROMPT" --disable-slash-commands --allowedTools "Bash,Read,Grep,Glob" >"$OUT/report.md" 2>"$OUT/agent.log") ;;
  codex)
    codex exec -C "$REPO" --skip-git-repo-check -s read-only -o "$OUT/report.md" "$PROMPT" >"$OUT/agent.log" 2>&1 ;;
  opencode)
    (cd "$REPO" && opencode run "$PROMPT" >"$OUT/report.md" 2>"$OUT/agent.log") ;;
  *) echo "unknown agent $AGENT" >&2; exit 2 ;;
esac
echo "{\"agent\": \"$AGENT\", \"total_duration_seconds\": $(( $(date +%s) - start ))}" >"$OUT/timing.json"

python3 "$HERE/grade.py" grade --eval "$EVAL" --report "$OUT/report.md" --repo "$REPO" \
  --secrets "$FX_ROOT/secrets/$FIXTURE.txt" --snapshot "$OUT/snapshot.json" --out "$OUT/grading.json"
