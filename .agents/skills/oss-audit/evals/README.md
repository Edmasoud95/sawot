# oss-audit evals

The evals are not part of the skill's runtime instructions. Agents using the skill never need to read this folder.

| File | Purpose |
|---|---|
| `fixtures/build.sh <dir>` | Builds five throwaway git repos (`leaky`, `clean`, `decoys`, `license-mismatch`, `injection`) plus `secrets/<fixture>.txt`. |
| `check_scan.sh` | Deterministic tests of `scripts/scan.sh` against the fixtures. No model involved; run after every scanner change. |
| `evals.json` | Behavioural test cases in skill-creator format. `checks` are machine-graded; other `expectations` need a grader agent. |
| `grade.py` | `snapshot` a fixture before a run, then `grade` the saved report: verdict, findings, masking, repo unchanged. |
| `run_agent.sh` | Runs one eval end to end through `claude`, `claude-baseline` (skills disabled), `codex` or `opencode`, then grades it. |
| `trigger-evals.json` | 10 should-trigger and 10 near-miss queries for skill-creator's description optimiser. |

```sh
evals/check_scan.sh                          # scanner regression tests
evals/run_agent.sh codex leaky-pre-publish /tmp/oss-evals/codex-leaky
evals/run_agent.sh claude-baseline 5 /tmp/oss-evals/baseline-injection
```

Fake secrets are assembled from string fragments in `build.sh`. That keeps this folder from tripping push protection or the scanner itself, which also excludes its own directory.
