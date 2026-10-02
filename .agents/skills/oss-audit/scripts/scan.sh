#!/usr/bin/env bash
# oss-audit scanner: read-only open-source readiness checks for a git repository.
#
# Usage: scan.sh [repo-dir] [--max N] [--offline]
#   --max N     lines shown per section (default 40)
#   --offline   skip dependency audits that query the network
#
# Needs bash, git and perl. gitleaks, trufflehog, npm, pip-audit and
# license-checker are used when installed; nothing is installed.
# Secret values are masked to their first 4 characters in all output.
# Exit status: 0 after a completed scan, 2 when the target is not a git repository.

set -uo pipefail
export GIT_OPTIONAL_LOCKS=0 LC_ALL=C GIT_PAGER=cat

REPO="."
MAX=40
OFFLINE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --max) MAX="$2"; shift 2 ;;
    --offline) OFFLINE=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) REPO="$1"; shift ;;
  esac
done

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$REPO" 2>/dev/null || { echo "oss-audit: cannot enter $REPO" >&2; exit 2; }
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "oss-audit: $REPO is not a git repository" >&2; exit 2; }
cd "$ROOT" || exit 2
ROOT="$(pwd -P)"

# Keep the skill's own patterns, fixtures and evals out of the results.
EXCLUDES=()
case "$SELF_DIR/" in
  "$ROOT"/*) EXCLUDES+=(":(exclude)${SELF_DIR#"$ROOT"/}") ;;
esac
for link in .claude/skills/oss-audit .agents/skills/oss-audit .opencode/skills/oss-audit; do
  EXCLUDES+=(":(exclude)$link")
done
PATHSPEC=(-- . "${EXCLUDES[@]}")

HAS_HEAD=1
git rev-parse --verify -q HEAD >/dev/null || HAS_HEAD=0
SKIPPED=()

# --- patterns ----------------------------------------------------------------
# Provider tokens and key material (case-sensitive).
STRONG='(AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|(sk|rk)_(live|test)_[0-9A-Za-z]{16,}|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
# Literal values assigned to secret-looking names (case-insensitive).
GENERIC='(password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'[:space:]]{8,}["'"'"']'
# Credentials embedded in URLs.
URLCRED='[a-zA-Z][a-zA-Z0-9+.-]*://[^/[:space:]:@"'"'"']+:[^/[:space:]@"'"'"']+@'
SECRETS="$STRONG|$URLCRED"
SENSITIVE='(^|/)(\.env(\.[^/]*)?|[^/]*\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate|sqlite3?|db)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.(json|ya?ml|csv|txt|ini|xml|toml))?|secrets?\.(json|ya?ml|env|txt|ini|toml)|settings\.json|\.npmrc|\.pypirc|\.netrc|\.htpasswd)$|(^|/)certs?/'
TEMPLATE='\.(example|sample|template|dist|tmpl)$|\.pub$'
PRIVATE_IP='(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9.]|$)'
HOME_PATH='/home/[a-z_][a-z0-9_.-]*/|/Users/[A-Za-z][A-Za-z0-9_.-]*/|[A-Za-z]:\\\\Users\\\\'
EMAIL='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
export STRONG GENERIC URLCRED

# Masks secret values, marks likely placeholders, truncates long lines.
MASK='
  sub m4 { my $s = shift; return substr($s, 0, 4) . "****[" . length($s) . " chars]"; }
  my $hint = /EXAMPLE|example|dummy|DUMMY|fake|FAKE|placeholder|changeme|xxxxxxxx|your[-_]|<[a-z_-]+>|\$\{|process\.env|os\.environ/ ? "  [likely placeholder]" : "";
  s/(-----BEGIN ([A-Z]+ )?PRIVATE KEY-----)/$1 [key body not shown]/g;
  s/((AKIA|ASIA)[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-(ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|(sk|rk)_(live|test)_[0-9A-Za-z]{16,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/m4($1)/ge;
  s{(://[^/\s:@"\x27]+:)([^/\s@"\x27]+)(@)}{$1 . m4($2) . $3}ge;
  s/((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)["\x27]?\s*[:=]\s*["\x27])([^"\x27\s]{8,})(["\x27])/$1 . m4($2) . $3/gie;
  chomp; $_ = substr($_, 0, 220) . " ..." if length($_) > 220;
  $_ .= "$hint\n";
  print;
'
mask() { perl -ne "$MASK"; }

section() { printf '\n=== [%s] %s ===\n' "$1" "$2"; }

# Prints at most MAX lines of stdin, or "(none)".
cap() {
  awk -v max="$MAX" 'NR <= max {print} END {
    if (NR == 0) print "(none)"
    else if (NR > max) print "... " NR - max " more lines (rerun with --max N)" }'
}

# git log -p over all refs, printing "commit date +/- file: line" for changed lines matching PERL_RE.
history_grep() {
  local git_re="$1" flags="$2"
  # shellcheck disable=SC2086
  git log --all -p --no-color --no-ext-diff $flags -G"$git_re" --format='@@COMMIT %h %ad' --date=short "${PATHSPEC[@]}" 2>/dev/null |
    PERL_RE="$git_re" PERL_I="$flags" perl -ne '
      BEGIN { $re = $ENV{PERL_I} =~ /-i/ ? qr/$ENV{PERL_RE}/i : qr/$ENV{PERL_RE}/; }
      if (/^\@\@COMMIT (\S+) (\S+)/) { $c = "$1 $2"; next }
      if (/^--- a\/(.*)/) { $f = $1; next }
      if (/^\+\+\+ b\/(.*)/) { $f = $1; next }
      next if /^(\+\+\+|---) /;
      if (/^([+-])(.*)/) { my ($s, $l) = ($1, $2); print "$c $s $f: $l\n" if $l =~ $re && !$seen{"$c$s$f$l"}++ }
    '
}

echo "oss-audit scan of $ROOT"
echo "branch: $(git symbolic-ref --short -q HEAD || echo detached)  commits: $( [ $HAS_HEAD = 1 ] && git rev-list --all --count || echo 0)  date: $(date +%Y-%m-%d)"

# --- [1] secrets in the current tree -------------------------------------------
section 1 "Secrets in working tree (tracked files)"
{
  git grep -nIE "$SECRETS" "${PATHSPEC[@]}" 2>/dev/null
  git grep -nIiE "$GENERIC" "${PATHSPEC[@]}" 2>/dev/null
} | sort -u | mask | cap

# --- [2] secrets in history ----------------------------------------------------
section 2 "Secrets in git history (all refs; '-' = removed, '+' = added)"
{
  history_grep "$SECRETS" ""
  history_grep "$GENERIC" "-i"
} | mask | awk '!seen[$0]++' | cap
if command -v gitleaks >/dev/null 2>&1; then
  echo "--- gitleaks, all refs (rule  file:line  commit  date) ---"
  # --log-opts carries --all and the self-exclusion pathspec; exit 1 just means leaks were found.
  gitleaks git --redact --no-banner --no-color --log-level error \
    --log-opts="--all -- . ${EXCLUDES[*]}" --report-format json --report-path /dev/stdout . 2>/dev/null |
    perl -MJSON::PP -0777 -ne 'for my $f (@{ decode_json($_ || "[]") }) {
      printf "%s  %s:%s  %s  %s\n", $f->{RuleID}, $f->{File}, $f->{StartLine}, substr($f->{Commit}, 0, 8), substr($f->{Date}, 0, 10) }' |
    sort -u | cap
else
  SKIPPED+=("gitleaks not installed (built-in patterns used)")
fi
if command -v trufflehog >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  echo "--- trufflehog (no raw values) ---"
  trufflehog git "file://$ROOT" --json --no-update 2>/dev/null |
    jq -r '[.DetectorName, (.Verified|tostring), (.SourceMetadata.Data.Git.commit // "")[0:8], (.SourceMetadata.Data.Git.file // ""), ((.SourceMetadata.Data.Git.line // "")|tostring)] | "\(.[0]) verified=\(.[1]) \(.[2]) \(.[3]):\(.[4])"' | sort -u | cap
else
  SKIPPED+=("trufflehog not installed (or jq missing)")
fi

# --- [3] sensitive files -------------------------------------------------------
section 3 "Sensitive files tracked now or in history"
{
  git ls-files "${PATHSPEC[@]}" | grep -E "$SENSITIVE" | grep -vE "$TEMPLATE" | sed 's/^/tracked now:     /'
  git log --all --diff-filter=A --name-only --format= "${PATHSPEC[@]}" 2>/dev/null | sort -u |
    grep -E "$SENSITIVE" | grep -vE "$TEMPLATE" | while IFS= read -r f; do
      git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 ||
        echo "history only:    $f (added in $(git log --all --diff-filter=A --format='%h %ad' --date=short -- "$f" | tail -n1))"
    done
} | cap

# --- [4] ignore coverage -------------------------------------------------------
section 4 "Sensitive untracked files NOT covered by .gitignore"
[ -f .gitignore ] || echo "no .gitignore at repository root"
git ls-files --others --exclude-standard | grep -E "$SENSITIVE" | grep -vE "$TEMPLATE" | cap

# --- [5] privacy ---------------------------------------------------------------
section 5 "Privacy: private IPs, home paths, emails"
echo "--- private IPs in tree ---"
git grep -nIE "$PRIVATE_IP" "${PATHSPEC[@]}" 2>/dev/null | cap
echo "--- private IPs in history (commit file) ---"
history_grep "$PRIVATE_IP" "" | awk '{sub(/:$/, "", $4); print $1, $2, $4}' | sort -u | cap
echo "--- absolute home paths in tree ---"
git grep -nIE "$HOME_PATH" "${PATHSPEC[@]}" 2>/dev/null | cap
echo "--- email addresses in tree (count, address, first location) ---"
git grep -nIoE "$EMAIL" "${PATHSPEC[@]}" 2>/dev/null |
  grep -vE '@(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.[a-z.]+)$|:[^:]*@[0-9]+\.[0-9]+' |
  awk -F: '{e=$NF; c[e]++; if(!(e in w)) w[e]=$1":"$2} END {for (e in c) print c[e], e, w[e]}' | sort -rn | cap
echo "--- commit identities (count, name <email>) ---"
[ $HAS_HEAD = 1 ] && git log --all --format='%an <%ae>%n%cn <%ce>' | sort | uniq -c | sort -rn | cap

# --- [6] hygiene ---------------------------------------------------------------
section 6 "Repository hygiene"
echo "--- files over 5 MB in HEAD ---"
[ $HAS_HEAD = 1 ] && git ls-tree -r -l HEAD | awk '$4 > 5242880 {printf "%.1f MB  %s\n", $4/1048576, $5}' | cap
echo "--- blobs over 5 MB anywhere in history ---"
git rev-list --objects --all 2>/dev/null |
  git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' |
  awk '$1 == "blob" && $3 > 5242880 {printf "%.1f MB  %s  %s\n", $3/1048576, substr($2,1,10), $4}' | sort -u | cap
echo "--- committed build output, dependencies, caches ---"
git ls-files "${PATHSPEC[@]}" |
  grep -E '(^|/)(node_modules|dist|build|out|target|__pycache__|\.venv|venv|\.next|\.nuxt|coverage|\.pytest_cache|\.mypy_cache)/|\.(pyc|pyo|log)$|(^|/)\.DS_Store$|(^|/)Thumbs\.db$' |
  awk -F/ '{d=$1; for (i=2;i<NF;i++) if ($i ~ /^(node_modules|dist|build|out|target|__pycache__|\.venv|venv|\.next|\.nuxt|coverage)$/) {d=d"/"$i; break} else d=d"/"$i; c[d]++} END {for (d in c) print c[d]" files  "d}' | sort -rn | cap
echo "--- binary files in tree (open images/PDFs to check for personal data) ---"
git ls-files --eol "${PATHSPEC[@]}" | awk '$1 == "i/-text" {print $NF}' | cap

# --- [7] community files -------------------------------------------------------
section 7 "Community and project files"
FILES="$(git ls-files "${PATHSPEC[@]}")"
check_file() {
  local label="$1" re="$2" hit
  hit="$(printf '%s\n' "$FILES" | grep -iE "$re" | head -n 3 | tr '\n' ' ')"
  if [ -n "$hit" ]; then echo "present   $label: $hit"; else echo "MISSING   $label"; fi
}
check_file LICENSE '^(licen[cs]e|copying|unlicense)(\.[a-z]+)?$|^licen[cs]es/'
check_file README '^readme(\.[a-z]+)?$'
check_file CONTRIBUTING '^(\.github/|docs/)?contributing(\.[a-z]+)?$'
check_file CODE_OF_CONDUCT '^(\.github/|docs/)?code_of_conduct(\.[a-z]+)?$'
check_file SECURITY '^(\.github/|docs/)?security(\.[a-z]+)?$'
check_file CHANGELOG '^(changelog|changes|history|news)(\.[a-z]+)?$'
check_file ISSUE_TEMPLATE '^\.github/issue_template'
check_file PR_TEMPLATE '(^|/)pull_request_template'
check_file CI '^\.github/workflows/|^\.gitlab-ci\.yml$|^\.circleci/|^jenkinsfile$|^azure-pipelines\.yml$|^\.woodpecker'
check_file DEPENDENCY_UPDATES '^\.github/dependabot\.ya?ml$|renovate\.json5?$'
check_file GITIGNORE '^\.gitignore$'

# --- [8] license consistency ---------------------------------------------------
section 8 "License consistency"
LIC_FILE="$(printf '%s\n' "$FILES" | grep -iE '^(licen[cs]e|copying)(\.[a-z]+)?$' | head -n 1)"
LIC_TYPE="none"
if [ -n "$LIC_FILE" ]; then
  LIC_TYPE="$(perl -0777 -ne '
    if (/GNU AFFERO GENERAL PUBLIC LICENSE/i) { print "AGPL-3.0" }
    elsif (/GNU LESSER GENERAL PUBLIC LICENSE/i) { print /Version 3/ ? "LGPL-3.0" : "LGPL-2.1" }
    elsif (/GNU GENERAL PUBLIC LICENSE/i) { print /Version 3/ ? "GPL-3.0" : "GPL-2.0" }
    elsif (/Apache License/i && /Version 2\.0/) { print "Apache-2.0" }
    elsif (/Mozilla Public License/i) { print "MPL-2.0" }
    elsif (/Permission is hereby granted, free of charge/i || /^\s*MIT License/i) { print "MIT" }
    elsif (/Permission to use, copy, modify, and\/or distribute/i) { print "ISC" }
    elsif (/Redistribution and use in source and binary forms/i) { print /Neither the name/i ? "BSD-3-Clause" : "BSD-2-Clause" }
    elsif (/This is free and unencumbered software/i) { print "Unlicense" }
    else { print "unrecognised" }' "$LIC_FILE")"
fi
echo "LICENSE file: ${LIC_FILE:-none}  detected: $LIC_TYPE"
norm() { tr '[:upper:]' '[:lower:]' | sed -E 's/-only$//; s/-or-later$//; s/ license$//; s/^the //; s/[[:space:]]+//g'; }
printf '%s\n' "$FILES" | grep -E '(^|/)(package\.json|pyproject\.toml|Cargo\.toml|setup\.cfg|composer\.json)$' |
  grep -vE '(^|/)node_modules/' | while IFS= read -r m; do
    decl="$(perl -ne '
      if (/^\s*"license"\s*:\s*"([^"]+)"/) { print $1; exit }
      if (/^\s*license\s*=\s*"([^"]+)"/) { print $1; exit }
      if (/^\s*license\s*=\s*\{\s*text\s*=\s*"([^"]+)"/) { print $1; exit }
      if (/^\s*license\s*=\s*([A-Za-z0-9.\-]+)\s*$/) { print $1; exit }' "$m")"
    if [ -z "$decl" ]; then
      echo "no license field  $m"
    elif [ "$LIC_TYPE" != "none" ] && [ "$LIC_TYPE" != "unrecognised" ] && [ "$(echo "$decl" | norm)" != "$(echo "$LIC_TYPE" | norm)" ]; then
      echo "MISMATCH  $m declares '$decl' but LICENSE is $LIC_TYPE"
    else
      echo "declared  $m: $decl"
    fi
  done
echo "--- vendored / third-party directories (need their own license notices) ---"
printf '%s\n' "$FILES" | grep -E '(^|/)(third[_-]?party|vendor|vendored|external|extern)/' | grep -vE '(^|/)node_modules/' |
  awk -F/ '{for (i=1;i<=NF;i++) if ($i ~ /^(third[_-]?party|vendor|vendored|external|extern)$/) {p=$1; for (j=2;j<=i+1 && j<NF;j++) p=p"/"$j; print p; break}}' | sort -u |
  while IFS= read -r d; do
    if printf '%s\n' "$FILES" | grep -qiE "^$d/(licen[cs]e|copying|notice)"; then echo "has notice  $d"; else echo "NO NOTICE   $d"; fi
  done | cap
if command -v license-checker >/dev/null 2>&1; then
  for d in $(printf '%s\n' "$FILES" | grep -E '(^|/)package\.json$' | grep -v node_modules | xargs -n1 dirname | head -n 5); do
    [ -d "$d/node_modules" ] && { echo "--- license-checker $d ---"; (cd "$d" && license-checker --summary 2>/dev/null) | cap; }
  done
else
  SKIPPED+=("license-checker not installed (npm dependency licenses not listed)")
fi

# --- [9] dependency audit ------------------------------------------------------
section 9 "Dependency vulnerabilities"
run_timeout() { if command -v timeout >/dev/null 2>&1; then timeout 120 "$@"; else "$@"; fi; }
if [ "$OFFLINE" = 1 ]; then
  echo "skipped (--offline)"
  SKIPPED+=("dependency audit (--offline)")
else
  LOCKS="$(printf '%s\n' "$FILES" | grep -E '(^|/)package-lock\.json$' | grep -v node_modules | head -n 5)"
  if [ -n "$LOCKS" ] && command -v npm >/dev/null 2>&1; then
    for l in $LOCKS; do
      echo "--- npm audit $(dirname "$l") ---"
      (cd "$(dirname "$l")" && run_timeout npm audit --omit=dev 2>&1 | grep -E 'vulnerabilit|Severity|^[a-z@].*  ' ) | cap
    done
  elif [ -n "$LOCKS" ]; then SKIPPED+=("npm audit (npm not installed)"); fi
  REQS="$(printf '%s\n' "$FILES" | grep -E '(^|/)requirements[^/]*\.txt$' | head -n 3)"
  if [ -n "$REQS" ] && command -v pip-audit >/dev/null 2>&1; then
    for r in $REQS; do echo "--- pip-audit $r ---"; run_timeout pip-audit -r "$r" 2>&1 | cap; done
  elif [ -n "$REQS" ]; then SKIPPED+=("pip-audit not installed (Python dependencies not audited)"); fi
  [ -z "$LOCKS" ] && [ -z "$REQS" ] && echo "(no package-lock.json or requirements*.txt found)"
fi

# --- summary -------------------------------------------------------------------
section S "Skipped checks"
if [ ${#SKIPPED[@]} -eq 0 ]; then echo "(none)"; else printf '%s\n' "${SKIPPED[@]}"; fi
echo
echo "Scanner output is raw evidence. Verify each hit, then do the judgement checks in references/checklist.md."
exit 0
