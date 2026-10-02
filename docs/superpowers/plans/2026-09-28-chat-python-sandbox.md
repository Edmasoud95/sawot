# Chat Python Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits the user's selection.

**Goal:** Let chat models download public files and run flexible Python against conversation-owned inputs without executing generated code in host Python.

**Architecture:** A controlled public-URL downloader transfers opaque bytes; a local Unix-socket broker launches disposable gVisor containers for Python and document parsing. File manifests enforce conversation/turn access, and the current chat tool loop returns bounded results and provenance. Prove isolation with real jobs before enabling tools.

**Tech Stack:** Existing Node 22+/TypeScript/Fastify and React/Zustand; a Python 3.12+ broker using standard-library HTTP/Unix sockets and subprocess argument arrays; Docker with mandatory gVisor and cgroup v2. The guest image includes pinned Python, pandas, NumPy, matplotlib, openpyxl, and pypdf dependencies.

**Spec:** [Approved design](../specs/2026-09-28-chat-python-sandbox-design.md). Read both documents before execution.

## Global Constraints

- Mandatory gVisor, no host/sidecar/unrestricted-container fallback; no model-controlled runtime configuration.
- No network, application credentials, host namespaces/devices, or Docker socket in the guest. Only explicitly staged job files are exposed.
- Guest parsing only; downloaded bytes and outputs remain untrusted. No automatic execution of file contents or runtime package installation.
- Download: 20 MiB, 30 seconds including DNS/redirects/body, five redirects, HTTP/HTTPS ports 80/443 only, no credentials, no HTTPS downgrade, identity encoding only.
- Source sizes: URL 8 KiB; Python 64 KiB. Per assistant turn: five downloads and five executions within the existing five-round budget.
- Job: 30 seconds from creation, 1 CPU, 512 MiB RAM, no swap, 64 guest processes; numerical library thread counts fixed to 1.
- Writable scratch plus outputs: 128 MiB aggregate. Inputs: ten files / 100 MiB aggregate. Captured stdout plus stderr: 64 KiB.
- Exports: ten files, 20 MiB each, 50 MiB total. Retention: 100 files / 200 MiB per conversation and 2 GiB installation-wide.
- Concurrency: one job per conversation, two installation-wide; return busy rather than queue indefinitely. Reserve storage before writing.
- No user authentication is added; conversation checks limit tool access, not trusted-LAN users' access to the entire application.
- Preserve unrelated working-tree changes. No commits/pushes unless requested; task commit messages below are suggestions for an authorized commit workflow.
- Model provider remains configurable. Browser disconnection does not cancel a turn; explicit stop, deletion, and shutdown do.
- No live HA commands. No model-generated payload may be run outside the tested runtime, even as a development shortcut.
- Runtime installation and daemon/service changes are a separate operational action; prepare and validate artifacts first. Do not restart the user's Docker daemon implicitly.

## Review Focus

- DNS changes after validation, mixed public/private answers, mapped IPv6, and proxy environment variables must not change the actual destination (Task 3).
- Regeneration or deletion during a slow file write must not expose old files or recreate deleted conversation state (Tasks 4 and 6).
- A guest can forge stdout and create links/FIFOs; neither may become trusted job status or an unsafe host read (Tasks 1 and 2).
- A broker/backend crash must not leave a job running beyond its deadline or leak quota reservations (Tasks 2, 4, and 8).
- Disguised HTML, malicious filenames, spreadsheet formulas, and provider-directed instructions in output must remain untrusted data and inert UI content (Tasks 3, 5, and 7).

## File map and dependency order

| Location | Responsibility |
| --- | --- |
| `sandbox/runner/protocol.py`, `limits.py` | Bounded broker request/result schema and constants |
| `sandbox/runner/runtime.py`, `storage.py` | Fixed Docker/runsc jobs; quota-backed job mounts; safe output collection |
| `sandbox/runner/server.py`, `__main__.py`, `__init__.py` | Unix HTTP service, job registry, independent deadlines and recovery |
| `sandbox/image/Dockerfile`, `requirements.in`, `requirements.lock` | Fixed guest environment, pinned dependencies and hashes |
| `sandbox/tests/`, `sandbox/systemd/` | Unit/live isolation checks and host service definitions |
| `ts-backend/src/publicFetch.ts` | Validated, IP-pinned public HTTP transport |
| `ts-backend/src/analysis/{types,limits,runnerClient,fileStore,tools,routes}.ts` | Backend contracts, socket client, ownership/quota lifecycle, tools, safe file serving |
| `web/src/lib/chatAnalysis.ts`, `components/chat/AnalysisActivity.tsx` | Typed progress/results and compact UI |
| Existing chat/search/config files | Narrow integration with tool discovery, history, cancellation and settings |
| `docs/python-sandbox.md`, `docker-compose.sandbox.yml` | Operator setup and optional backend socket mount |

Tasks 1–3 establish the execution/download boundary. Task 5 proves a complete
download-to-calculation slice using fixtures and deterministic tool invocation.
Tasks 6–7 expose it in chat. Task 8 verifies deployment and failure recovery.
The feature stays unavailable until real isolation checks pass.

## Shared contracts

`analysis/types.ts` defines `AnalysisScope = { conversationId: string;
turnId: string; visibleTurnIds: string[] }`, `AnalysisFile = { id: string;
conversationId: string; turnId: string; name: string; size: number; sha256: string;
mediaType: string; source?: { originalUrl: string; finalUrl: string };
inputIds: string[] }`, and `AnalysisStatus = 'success' | 'python_error' |
'timeout' | 'resource_limit' | 'cancelled' | 'unavailable' | 'policy_rejected' |
'busy'`. Error text must not disclose host paths, environment, or secrets.

`AnalysisResult = { status: AnalysisStatus; stdout: string; stderr: string;
exitCode: number | null; durationMs: number; truncated: boolean;
files: AnalysisFile[]; error?: string }`.

`AnalysisEvent = { id: string; turnId: string; tool: 'download_file' |
'run_python'; phase: 'start' | 'complete' | 'error'; code?: string;
result?: AnalysisResult; file?: AnalysisFile; error?: string }`.

Define `Readiness = { ready: boolean; reason?: string; runtime: 'runsc';
imageDigest: string }` in backend types and its equivalent in broker protocol.
`RunnerResult` uses the same status/log/exit/duration/truncation fields as
`AnalysisResult`, replacing `files` with `outputs: RunnerOutput[]` where
`RunnerOutput = { id: string; name: string; size: number;
body: AsyncIterable<Uint8Array> }`. Task 5 validates and registers these streams.
`Reservation` is a server-generated ID plus scope/count/byte allowance;
`StagedFile` records its private staging path, safe metadata, digest and input IDs.
Task 4 owns both types and never exposes staging paths to callers outside the backend.

Broker `JobResult` mirrors the result schema with registered output IDs instead
of streams; `OutputFile` records its internal descriptor and public metadata.
`RunnerConfig` is trusted startup configuration only: socket path/group, local
Docker endpoint, runsc binary/config identity, pinned image digest, and private
job root. `Job` binds generated job/input IDs, validated code/metadata, a creation
deadline and internal storage descriptors. Task 1 defines these dataclasses in
`protocol.py`; Task 2 alone creates and admits jobs.

The broker has a separate JSON schema with bounded strings/arrays, no unknown
fields, and generated job/input/output IDs. Its fixed Unix HTTP endpoints are:
`GET /v1/ready`, `POST /v1/jobs` (code + input metadata, returns generated IDs),
`PUT /v1/jobs/:job/inputs/:input` (raw bytes of declared length),
`POST /v1/jobs/:job/start`, `GET /v1/jobs/:job` (state/result),
`GET /v1/jobs/:job/outputs/:output` (bounded raw bytes), and
`DELETE /v1/jobs/:job` (cancel/release, idempotent). The client uploads inputs
sequentially and starts once; each job's deadline starts at creation, including
staging. Metadata responses never contain host paths. Finished results expire
after 60 seconds; quotas and concurrency reservations remain held until release.

### Task 1: A fixed gVisor execution primitive

**Files:** Create `sandbox/runner/{__init__,limits,protocol,runtime,storage}.py`,
`sandbox/image/{Dockerfile,requirements.in,requirements.lock}`,
`sandbox/tests/test_runtime.py`, `sandbox/tests/test_storage.py`.

**Interfaces:** Produce `execute_job(job: Job, cancel: threading.Event) -> JobResult`,
`check_runtime(config: RunnerConfig) -> Readiness`, and
`collect_outputs(job_dir: Path) -> list[OutputFile]`. `Job` contains server-generated
IDs, code and validated staged input descriptors; no user-selected container options.

- [ ] Write failing unit tests using a fake subprocess adapter. Assert fixed runtime `runsc`, `network=none`, read-only root, non-root UID, all capabilities dropped, no-new-privileges, 1 CPU, memory and memory+swap both 512 MiB, and no sockets/application mounts. Assert source text is a file, never a shell command argument.
- [ ] Write output tests: `symlink_to_host`, `hardlink`, `fifo`, `device`, `nested_link`, `sparse_oversize`, and `more_than_ten_files` are rejected without opening targets. Assert total retained bytes <= 50 MiB and every file <= 20 MiB. Read only after the workload has stopped.
- [ ] Run `python3 -m unittest discover -s sandbox/tests -p 'test_*.py'`; confirm failures concern missing implementation, then implement the interfaces.
- [ ] Build a fixed command using subprocess argument arrays with `shell=False`, minimal environment and no implicit image pull. Pin the base image by digest and resolve/hash library dependencies during implementation using official package sources; keep the speech requirements independent.
- [ ] Implement job storage as broker-created, per-job quota-backed tmpfs directories. Stage read-only inputs separately; allocate one 128 MiB writable filesystem for work, outputs, temporary files, home and caches. Mount only those disposable directories, never a host root/application directory. Bound inode count as well as bytes. Require broker and Docker daemon to share the same Linux host paths; remote/Desktop daemon layouts fail readiness unless this is actually established.
- [ ] Set thread variables to 1; map writable locations into the same capped filesystem, disable separate writable shared memory, and use descriptor-relative no-follow access to collect only regular top-level output files with link count 1. Generated names replace hostile basenames; preserve safe display names separately.
- [ ] Enforce whole-job termination from outside Python and ensure guest children cannot survive main-process exit. Docker logging must not write unbounded logs; capture/drain attached output with a 64 KiB combined retained limit. Status comes from trusted runtime observations, never JSON printed by the guest.
- [ ] Set the guest hard process limit to 64 as well as host cgroup limits; verify the effective guest limit under gVisor with the real fork test. If the chosen runtime cannot enforce it, fail readiness and report the unsupported control instead of interpreting host process counts as proof.
- [ ] Re-run unit tests; expected all pass. Suggested commit: `feat(sandbox): add fixed gvisor execution primitive`.

### Task 2: Broker lifecycle and real isolation readiness

**Files:** Create `sandbox/runner/{server,__main__}.py`,
`sandbox/tests/test_broker.py`, `sandbox/tests/test_live_isolation.py`,
`sandbox/systemd/sawot-runner.service`; extend Task 1 runtime/storage modules.

**Interfaces:** Consume Task 1 APIs. Produce `serve(config: RunnerConfig) -> None`
and the Unix endpoints above. `Readiness` contains `ready`, a non-sensitive reason,
and trusted runtime/image identity. The socket is group-restricted mode 0660.

- [ ] Write failing protocol tests: unknown options/image/mount/env fields rejected; third concurrent job returns busy; upload length mismatches rejected; creation starts the 30-second deadline; deletion is idempotent; slow/incomplete clients expire; guest stdout cannot forge status. Bound metadata to 128 KiB and total staged inputs to 100 MiB per admitted job.
- [ ] Run the sandbox unit command from Task 1 and confirm the new cases fail.
- [ ] Implement HTTP over the Unix socket with no TCP listener, bounded headers/body/concurrency, server-generated IDs, peer/socket permissions and no caller-selected execution flags. Store a minimal fsynced job ledger before allocating a container; label only owned containers for recovery. Release scratch/results after acknowledgement or 60-second result expiry.
- [ ] Implement a watchdog independent of request handlers. Add a host systemd deadline unit per job before container creation, plus broker-startup reconciliation. A broker crash must not remove the deadline; its action can only kill the exact server-generated, labelled job container and clean that job's storage. Stop the entire broker with its jobs on service shutdown. Do not rely solely on a Python timer in the broker.
- [ ] Establish runtime identity from trusted host configuration and inspected container configuration, not guest `dmesg`. Readiness verifies the pinned image, cgroup controls, mount visibility, watchdog, actual network denial and resource enforcement. Missing evidence returns unavailable, without fallback. Admission rechecks trusted configuration so stale readiness cannot launch an unprotected job.
- [ ] Add live tests using generated canaries, never real secrets: host/application/Docker-socket reads fail; `/inputs` is read-only; public/LAN/metadata/DNS access fails; sibling inputs cannot be read; infinite loops time out; children die; memory/disk/process/log attacks remain bounded. Include guest process limits separately from host gVisor process counts.
- [ ] Run `SAWOT_SANDBOX_LIVE=1 python3 -m unittest discover -s sandbox/tests -p 'test_live_*.py'` only on a prepared host. Under this flag absent gVisor/cgroups/watchdog MUST fail, not skip. Without it, ordinary unit runs explicitly skip live tests. Capture actual enforcement and cleanup evidence; never execute guest payloads with host Python.
- [ ] Re-run units. Suggested commit: `feat(sandbox): add isolated runner broker and readiness checks`.

### Task 3: Public download transport with connection pinning

**Files:** Create `ts-backend/src/publicFetch.ts`,
`ts-backend/tests/publicFetch.test.ts`; modify `ts-backend/src/search.ts`,
`ts-backend/tests/{search,findInPage}.test.ts`, and backend package manifests if an address-classifier dependency is added.

**Interfaces:** Produce `fetchPublic(url: string, options: { signal: AbortSignal;
deadlineMs: number; maxBytes: number; oversize: 'reject' | 'truncate' }): Promise<{
body: AsyncIterable<Uint8Array>; finalUrl: string; mediaType: string;
displayName: string; truncated: () => boolean; close(): void }>`.
Dependency injection covers DNS and connection establishment, not a bypassable
production `fetch` fallback. `deadlineMs` is an absolute monotonic deadline.

- [ ] Write failing tests asserting all resolved addresses are checked and the connector receives the validated address while TLS SNI/Host retain the hostname. Test rebinding, mixed answers, mapped IPv6, CGNAT, metadata, alternate IP spellings, transition ranges, trailing dots, credentials, forbidden ports and proxy environment variables.
- [ ] Add redirect/stream cases: six redirects rejected; every hop revalidated; HTTPS downgrade rejected; slow DNS/body share one deadline; missing/lying lengths remain capped; encoded responses rejected; cancellation closes the connection; malicious filenames never become paths. Assert `maxBytes + 1` rejects downloads instead of registering a truncated file.
- [ ] Run from `ts-backend/`: `node --import tsx --test tests/publicFetch.test.ts`; confirm the expected failures.
- [ ] Implement with Node HTTP/HTTPS and an explicitly pinned lookup/connection path, no shared unchecked connection pool or environment proxies. Choose a maintained IP parser/classifier, pin its package, and augment its classifications with explicit non-global/special-use fixtures rather than inventing string-prefix security checks. Cap response headers, strip credential-bearing headers and accept identity encoding only.
- [ ] Move existing page fetching onto this transport while preserving its 2 MiB/10-second limits and explicit truncation behavior. Preserve search-key calls to the fixed Brave endpoint separately; credentials must never reach arbitrary URLs. Adapt mocks to the transport boundary.
- [ ] Run `node --import tsx --test tests/publicFetch.test.ts tests/search.test.ts tests/findInPage.test.ts tests/voiceSearch.test.ts`; expected pass. Suggested commit: `fix(search): pin public fetch connections and bound downloads`.

### Task 4: Private file manifests and quota-safe lifecycle

**Files:** Create `ts-backend/src/analysis/{types,limits,fileStore}.ts`,
`ts-backend/tests/analysisFiles.test.ts`.

**Interfaces:** Produce `AnalysisFileStore` with async methods
`reserve(scope: AnalysisScope, count: number, bytes: number): Promise<Reservation>`,
`commit(reservation: Reservation, files: StagedFile[]): Promise<AnalysisFile[]>`,
`release(reservation: Reservation): Promise<void>`,
`openInputs(scope: AnalysisScope, ids: string[]): Promise<AnalysisInput[]>`,
`listVisible(scope: AnalysisScope): Promise<AnalysisFile[]>`,
`prune(conversationId: string, visibleTurnIds: string[]): Promise<void>`, and
`reconcile(): Promise<void>`. `AnalysisInput` is ID/name/size plus an opened read-only
byte stream. `StagedFile` paths are internal, never model-supplied.
Also expose `openDownload(conversationId: string, fileId: string): Promise<AnalysisInput>`
for Task 6, applying authoritative visible-history and ownership checks internally.
The active `turnId` is explicitly permitted by the server while in progress;
`visibleTurnIds` must otherwise come from stored live history, never request data.

- [ ] Write failing tests for atomic simultaneous reservations, exact count/byte boundaries, partial writes, interrupted commit recovery, foreign conversation IDs, path traversal, superseded turns, deleted conversation tombstones, and cancellation racing commit. Assert duplicate display names get independent opaque IDs.
- [ ] Add tests preserving a file referenced by surviving history, rejecting legacy upload ownership guesses, deleting only unreachable files, and refusing a reservation that would exceed 2 GiB globally or 200 MiB/100 files for a conversation.
- [ ] Run from `ts-backend/`: `node --import tsx --test tests/analysisFiles.test.ts`; confirm failures, then implement a private `analysis/` directory beneath `dataDir`, a single installation-wide lock, durable reservation journal, atomic manifest replacement and startup reconciliation. Use a process lock to reject unsupported multi-writer deployments rather than relying on in-process locking alone.
- [ ] Register completed files against stable turn IDs and immutable digests. Before commit, reread authoritative conversation/turn liveness under the lifecycle lock. All file APIs resolve manifest entries, not prefix scans. Copy legacy uploaded bytes only after exact ownership plus visible-attachment checks; importing consumes analysis quota.
- [ ] Re-run the focused test and `tests/chatDeletion.test.ts`; expected pass. Suggested commit: `feat(chat): add private analysis file ownership and quotas`.

### Task 5: End-to-end download and Python tools before UI integration

**Files:** Create `ts-backend/src/analysis/{runnerClient,tools}.ts`,
`ts-backend/tests/{runnerClient,analysisTools,analysisLive}.test.ts`,
`sandbox/tests/fixtures/{sales.csv,report.txt,README.md}`; generate small XLSX/PDF fixtures inside the guest for live tests.

**Interfaces:** Produce `RunnerClient.ready(): Promise<Readiness>` and
`RunnerClient.run(code: string, inputs: AnalysisInput[], signal: AbortSignal): Promise<RunnerResult>`.
The client handles creation, streaming uploads, start, bounded status polling,
output retrieval, and release in `finally`. `RunnerResult` is bounded status/logs
plus output byte streams; `buildAnalysisTools(ctx: AnalysisToolContext): Tool[]`
binds scope, signal, file store, transport, runner and `emit(AnalysisEvent)`.

- [ ] Write failing mock tests: model arguments cannot supply paths/scope/limits; malformed inputs rejected; missing readiness omits tools; readiness loss fails closed; fifth call permitted/sixth rejected; web-search-off omits downloads; Python exceptions are returned for correction. An aborted client must send DELETE and drain cleanup; broker disconnect reports unavailable without local execution.
- [ ] Run from `ts-backend/`: `node --import tsx --test tests/runnerClient.test.ts tests/analysisTools.test.ts`; confirm expected failures.
- [ ] Implement strict runtime argument validation in handlers, not just JSON schemas. Reserve 20 MiB before a download and 50 MiB/ten output slots before execution; settle actual usage and release unused quota. Clip and flag combined logs before sending them to the model/UI, and revalidate broker output counts/lengths before retention.
- [ ] Implement tool descriptions documenting fresh interpreters, `/inputs`, `/outputs`, available packages, limits and file provenance. Bind turn counters to the active assistant turn, not each reconstruction of the tool list. File-derived instructions never expand capabilities or change tool arguments automatically.
- [ ] Use public fixture download endpoints with pre-recorded expected hashes for the real transport test; use an injected byte stream for deterministic CSV aggregation tests. Assert `sales.csv` values 2 and 3 produce 5, an exported result can be read by a second fresh job, and the first job's variables are absent. Test malformed PDF/XLSX and expansion attacks only in the sandbox.
- [ ] Run `SAWOT_SANDBOX_LIVE=1 node --import tsx --test tests/analysisLive.test.ts` from `ts-backend/`. Pass requires the real broker, runsc isolation, actual bytes and expected aggregation; a fake runner cannot satisfy this gate. Missing prerequisites produce a reported failure.
- [ ] Re-run focused mocks. Suggested commit: `feat(chat): add protected file download and python tools`.

The first acceptance fixture must pin actual output, for example:

```ts
assert.equal(result.status, 'success');
assert.equal(result.stdout.trim(), '5');
assert.equal(result.files.length, 1);
assert.notEqual(secondExecutionJobId, firstExecutionJobId);
assert.equal(hostCanaryUnchanged, true);
```

These assertions exercise the tool/runner path; never implement a host-side CSV
calculation that could accidentally make the isolation test pass without Python.

### Task 6: Chat history, cancellation, and safe file routes

**Files:** Modify `ts-backend/src/{chat,chatRoutes,chatPrompt,index,config}.ts`,
`ts-backend/tests/{chatRoutes,chatDeletion,chatPrompt,config}.test.ts`;
create `ts-backend/src/analysis/routes.ts`, `ts-backend/tests/analysisRoutes.test.ts`.

**Interfaces:** Add optional runner/file-store dependencies to `ChatCtx`, stable
message/turn IDs, `analysis: AnalysisEvent[]` on assistant messages and SSE
`{ type: 'analysis', ...event }`. Produce
`registerAnalysisRoutes(app: FastifyInstance, store: AnalysisFileStore, chats: ChatStore): void`.
File route: `GET /api/chat/conversations/:cid/analysis-files/:fid`.

- [ ] Write failing route/history tests: persisted and reconnecting turns show analysis results; disconnect keeps jobs alive; stop/delete/shutdown cancel; regeneration cannot access discarded outputs; cleanup failures keep retryable state; late writes never recreate a deleted chat. Test failed/cancelled regeneration restores the correct previously visible history and references.
- [ ] Run from `ts-backend/`: `node --import tsx --test tests/analysisRoutes.test.ts tests/chatRoutes.test.ts tests/chatDeletion.test.ts`; confirm new failures.
- [ ] Add `SAWOT_RUNNER_SOCKET` as an optional operator configuration value, blank by default. Wire readiness into `/api/chat/tools` and per-turn tool assembly independently of HA configuration/provider names. Direct URL downloads require the conversation's web-search permission but do not require a Brave key if a URL is already known. Search itself retains its key requirement.
- [ ] Extend the existing tool loop with typed analysis events while keeping ordinary tool output and five-round final-answer behavior intact. Persist events and stable turn IDs as files become available, including partial successful tool outcomes before a later error. Use the lifecycle lock from Task 4 for delete/regenerate/commit. Do not prune original files until successful regeneration commits its replacement; aborted replacement files become unreachable and are reclaimed.
- [ ] Add a bounded available-file manifest to context (100 entries maximum, display names 160 characters, total 32 KiB). Files imported for analysis use metadata rather than full embedded content; ordinary existing attachment behavior stays compatible. Keep code/logs/file data as untrusted user/tool content, never splice them into the system instruction string.
- [ ] Serve only manifest-owned regular files with attachment disposition, `application/octet-stream`, `X-Content-Type-Options: nosniff`, restrictive CSP and no-store. Reject foreign/missing IDs; never forward guest media type as an executable inline response. Register analysis downloads separately from public upload routes.
- [ ] Run `node --import tsx --test tests/analysisRoutes.test.ts tests/chatRoutes.test.ts tests/chatDeletion.test.ts tests/chatPrompt.test.ts tests/toolBudget.test.ts tests/config.test.ts` and `npm run typecheck`; expected pass. Suggested commit: `feat(chat): integrate sandbox tools with conversation lifecycle`.

### Task 7: Compact progress, code details, and result attachments

**Files:** Create `web/src/lib/chatAnalysis.ts`,
`web/src/components/chat/AnalysisActivity.tsx`, `web/tests/chatAnalysis.test.ts`;
modify `web/src/{chatStore.ts,lib/chatApi.ts,components/chat/Message.tsx,components/chat/ChatView.tsx}` and `web/tests/chatHistory.test.ts`.

**Interfaces:** `normalizeAnalysisEvent(value: unknown): AnalysisEvent | null`
and `mergeAnalysisEvents(previous: AnalysisEvent[], event: AnalysisEvent): AnalysisEvent[]`
in the frontend helper; `AnalysisActivity({ conversationId, events })` renders
status, collapsed code/log details, source links and server-generated file links.

- [ ] Write failing reducer/render-data tests: duplicate/reordered events merge by ID, completion survives reconnect, a late start cannot replace completion, truncated logs are labelled, forged URLs/IDs are rejected, and HTML/ANSI/control text cannot become executable markup. Empty stdout on success must still show completion.
- [ ] Run from `ts-backend/`: `node --import tsx --test ../web/tests/chatAnalysis.test.ts ../web/tests/chatHistory.test.ts`; confirm failures, implement the helper/store wiring, then re-run for pass.
- [ ] Add compact activity rows with keyboard-accessible collapsed details; show `Downloading file`, `Running Python`, and clear terminal status. Render code/logs as escaped text, never raw HTML or auto-opened artifacts. Use only server-provided IDs for internal links. Download CSV/XLSX unchanged as untrusted files; never evaluate formulas in previews.
- [ ] Keep matplotlib outputs as downloads; feed existing chart rendering only through its validated JSON format. No voice UI changes. Preserve existing pending-message, edit/regenerate and chart behavior.
- [ ] Run frontend typecheck/build and check the browser at 390px/1280px: progress transitions, cancel, Python error, unavailable runner, reconnect, escaped hostile output, keyboard focus and file downloads. Use deterministic fixtures; no HA/model commands needed for the UI check.
- [ ] Suggested commit: `feat(chat): show sandbox activity and analysis files`.

### Task 8: Deployment, recovery, and release evidence

**Files:** Create `docs/python-sandbox.md`, `docker-compose.sandbox.yml`,
`sandbox/tests/test_live_recovery.py`, `sandbox/tests/test_contract_limits.py`,
`.github/workflows/sandbox.yml`; update `sandbox/systemd/sawot-runner.service`,
`README.md`, `docs/{installation,configuration,storage,development}.md` and `.gitignore` only where needed.

**Interfaces:** Operator setup installs the reviewed broker and digest-pinned image
on the Docker host, then exposes only its Unix socket directory to SAWOT. Runtime
data, job ledgers, downloads and generated fixtures stay ignored. The guide
documents host trust, runtime setup, quotas, supported platform evidence and removal.

- [ ] Write failing live recovery tests: terminate broker during staging/execution; independent deadlines kill the job; restart reconciles owned containers/mounts only; backend restart clears unfinished reservations; interrupted outputs are never served. Test real process and byte exhaustion against guest and host-observed limits.
- [ ] Add contract tests that compare backend and broker limit/schema fixtures; neither side may quietly accept a larger bound. Verify unit-only CI explicitly reports that live isolation was not tested.
- [ ] Prepare service and Compose override artifacts without installing them or restarting Docker. Broker service permissions must allow only the trusted operations required for disposable mounts/runtime/watchdog; the backend gets the broker socket, not Docker access. Runtime controls and effective service restrictions are tested together. Dedicated-VM deployment remains an optional future topology; do not claim this local socket setup provides a separate machine.
- [ ] Add sandbox CI units on ordinary runners and a manual/release live-isolation job on a disposable Linux runner with documented runsc/cgroup prerequisites. Live jobs fail for missing prerequisites. Never run untrusted PR code on a privileged persistent self-hosted machine.
- [ ] Run backend/frontend typecheck/build, `node --import tsx --test tests/*.test.ts ../web/tests/*.test.ts` from `ts-backend/`, broker unit tests, and the real isolation/recovery/analysis tests. Python speech code is unchanged; only run its suite if integration changes affect it. Use `git diff --check` and the repository's relevant CI commands.
- [ ] Record versions, image digest, platform, test counts and actual results in `docs/python-sandbox.md`, clearly separating unit mocks, real gVisor tests, browser fixtures and any live provider trial. Omit private host paths, addresses, secrets and real documents. If a control is unsupported, tools remain disabled and the missing acceptance check is reported.
- [ ] Review that generated Python is invoked only via the fixed guest entrypoint and that all readiness/error branches fail closed. Run the read-only oss-audit skill before any requested public push. Suggested commit: `docs(sandbox): document deployment and verified isolation`.

## Completion and handoff

Completion requires all task checks, real isolation/resource enforcement, file
lifecycle tests, and browser verification. A missing gVisor runtime cannot be
papered over by mocks or ordinary Docker. If host setup is unavailable, finish
reviewable code/configuration work while leaving execution disabled and identify
the exact unverified gate.

The plan is ready for review; no implementation or runtime setup has been done.
Select inline execution or subagent-driven execution after reviewing it. Inline
execution is recommended because broker, transport, storage and cancellation
contracts are tightly connected; use an independent security-focused review
before enabling the finished feature.

Runtime details to recheck during implementation against primary documentation:
[Docker resource limits](https://docs.docker.com/engine/containers/resource_constraints/),
[gVisor resource model](https://gvisor.dev/docs/architecture_guide/resources/), and
[gVisor Docker runtime verification](https://gvisor.dev/docs/user_guide/quick_start/docker/).


## Execution record — 2026-09-28

Implementation is present in the working tree; no commits or pushes were made.
Broker/runtime controls, the pinned image, public transport, file store, tools,
chat lifecycle integration and compact UI have unit/mocked regression coverage.
The image was built and desktop/mobile fixture rendering checked.

**Unfinished acceptance gate:** this host has no configured gVisor runtime and
isolation has not been verified. Execution remains disabled. The shipped operator
verifier includes 14 real tests and writes a readiness receipt only after all pass.
Host installation, service activation and live provider tests have not been done.
Unchecked live-test and deployment steps above remain unchecked intentionally.

Implementation rulings: preserve existing vision image inputs while registering
files for analysis; wait for active analysis operations on deletion without waiting
for a provider that ignores cancellation; use transient quota reservations with
single-writer process locking and orphan staging reconciliation rather than a
separate persistent reservation journal. Broker requests have an absolute deadline.
Readiness is bound to boot, image, source, runtime binary and effective Docker
runtime configuration. The initial CI workflow runs units and an optional image
build; live acceptance is an explicit prepared-host operator step.
