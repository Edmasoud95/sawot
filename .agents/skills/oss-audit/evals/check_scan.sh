#!/usr/bin/env bash
# Deterministic regression tests for scripts/scan.sh against the generated fixtures.
# Usage: check_scan.sh [workdir]   (default: a fresh temp dir, removed afterwards)

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SCAN="$HERE/../scripts/scan.sh"
WORK="${1:-}"
if [ -z "$WORK" ]; then WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; fi
FX="$WORK/fixtures"
"$HERE/fixtures/build.sh" "$FX" >/dev/null || { echo "fixture build failed"; exit 1; }

PASS=0 FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
# Prints one section ([N]) of the current scan output.
sect() { awk -v h="=== [$1] " 'index($0, h) == 1 {on = 1; next} /^=== \[/ {on = 0} on' "$OUT"; }
has()  { if sect "$1" | grep -qE -- "$2"; then ok "[$1] ${3:-$2}"; else bad "[$1] ${3:-$2}"; fi; }
hasnt(){ if sect "$1" | grep -qE -- "$2"; then bad "[$1] ${3:-not $2}"; else ok "[$1] ${3:-not $2}"; fi; }
empty(){ if [ "$(sect "$1" | grep -vE '^(---|$)' | grep -vxF '(none)' | grep -cv 'no .gitignore')" -eq 0 ]; then ok "[$1] empty"; else bad "[$1] empty"; fi; }

snapshot() {
  (cd "$1" && git rev-parse HEAD && git status --porcelain --ignored &&
    find . -path ./.git -prune -o -type f -print0 | sort -z | xargs -0 sha256sum)
}

scan() {
  local name="$1"
  echo "$name"
  OUT="$WORK/$name.scan.txt"
  local before; before="$(snapshot "$FX/$name")"
  "$SCAN" "$FX/$name" --offline --max 200 >"$OUT" 2>"$WORK/$name.err"
  local rc=$?
  [ "$rc" -eq 0 ] && ok "exit 0" || bad "exit $rc"
  [ -s "$WORK/$name.err" ] && bad "stderr empty: $(head -c 200 "$WORK/$name.err")" || ok "stderr empty"
  [ "$before" = "$(snapshot "$FX/$name")" ] && ok "repository unchanged" || bad "repository unchanged"
  local leaked=0
  while IFS= read -r s; do
    [ -n "$s" ] && grep -qF -- "$s" "$OUT" && { leaked=1; bad "secret printed unmasked: ${s:0:4}****"; }
  done <"$FX/secrets/$name.txt"
  [ "$leaked" = 0 ] && ok "no unmasked secrets"
}

scan leaky
has 1 'src/github\.py:3:.*ghp_\*\*\*\*' "tree: GitHub token in src/github.py, masked"
has 1 '^\.env:1:.*sk-p\*\*\*\*' "tree: key in tracked .env"
has 2 ' - src/aws\.py: .*AKIA\*\*\*\*' "history: removed AWS key"
has 2 'id_rsa: -----BEGIN .*PRIVATE KEY----- \[key body not shown\]' "history: private key, body hidden"
has 3 '^tracked now: +\.env$' "tracked .env"
has 3 '^history only: +id_rsa' "id_rsa in history only"
has 4 'no \.gitignore' "missing .gitignore noted"
has 5 'config\.yaml:2:.*192\.168\.1\.5' "private IP"
has 5 '/home/alice/' "home path"
has 5 'alice@acme-internal\.lan' "author email"
has 6 '6\.0 MB +assets/model\.bin' "large file"
if command -v gitleaks >/dev/null 2>&1; then
  has 2 '^github-pat +src/github\.py:3 ' "gitleaks: GitHub token"
  has 2 '^private-key +id_rsa:1 ' "gitleaks: private key in history"
else
  echo "  skip  gitleaks assertions (not installed)"
fi
has 7 '^MISSING +LICENSE' "missing LICENSE"
has 7 '^MISSING +SECURITY' "missing SECURITY"

scan clean
empty 1; empty 2; empty 3; empty 4
hasnt 7 '^MISSING +(LICENSE|README|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|CI)$' "core community files present"
has 8 'detected: MIT' "MIT detected"
has 8 '^declared +package\.json: MIT' "package.json agrees"
hasnt 8 'MISMATCH' "no mismatch"

scan decoys
has 1 'docs/aws\.md:5:.*\[likely placeholder\]' "AWS docs example marked placeholder"
has 1 'tests/test_auth\.py:2:.*\[likely placeholder\]' "fake test token marked placeholder"
hasnt 1 'os\.environ|process\.env' "environment reads not flagged"
hasnt 5 '127\.0\.0\.1' "loopback not a private IP"
hasnt 5 'security@example\.com' "example.com email ignored"

scan license-mismatch
has 8 'detected: Apache-2\.0' "Apache detected"
has 8 "MISMATCH +package\.json declares 'MIT' but LICENSE is Apache-2\.0" "license mismatch"
has 8 'NO NOTICE +third_party/tinyfmt' "vendored code without notice"

scan injection
has 1 '^\.env:1:.*sk-p\*\*\*\*' "key in tracked .env"
has 3 '^tracked now: +\.env$' "tracked .env"

echo
echo "check_scan: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
