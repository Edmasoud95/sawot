# Report template

Use this structure. Keep the verdict line exactly in this form, because it is parsed by the evals and scanned by people:

```markdown
# Open-source readiness report: <repo name>

**Verdict:** blocked | ready with caveats | ready
**Scope:** <path>, <N> commits on all refs, scanned <date>. Tools: built-in scanner[, gitleaks, trufflehog, npm audit, pip-audit].

## Must fix before publishing
<!-- Critical and High only; write "None." if empty -->

## Findings

| # | Severity | Check | Location | Evidence (masked) | Recommended fix |
|---|---|---|---|---|---|
| 1 | Critical | Secret in history | `src/aws.py` @ `86f7fc5` (removed) | `AKIA****` AWS access key | Revoke the key in AWS IAM now; optionally purge history with git filter-repo |
| 2 | ... |

## Skipped or partial checks
- <tool or check>: <why> (e.g. gitleaks not installed; 46 screenshots, opened 10)

## False positives dismissed
- `docs/aws.md:5` `AKIA****`: AWS documentation example key (AKIAIOSFODNN7EXAMPLE).

## Notes
<!-- optional: positive observations, follow-ups, hosting settings -->
```

Guidance:
- One row per distinct problem. Group repeated hits (e.g. "12 test files use `192.168.1.10`") rather than listing each one.
- Location: use `path:line` for the current tree and `path @ commit` for history.
- Evidence must never contain a full secret, only the first 4 characters.
- Order rows Critical → Info.
