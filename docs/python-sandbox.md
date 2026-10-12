# Python analysis sandbox (optional, not enabled by default)

Chat can use `download_file` to acquire public files and `run_python` to analyse
selected files with Python, pandas, NumPy, matplotlib, openpyxl and pypdf. Each
execution starts a fresh interpreter. Select the required IDs in `file_ids` on every call. Selected inputs have stable
paths `/inputs/<file-id>`; `/inputs/manifest.json` maps their names and IDs to
paths. Empty `file_ids` means no input files. Numbered paths remain compatible
but depend on the selection order and should not be guessed. Save results
under `/outputs`. Completed files remain associated with their conversation.

The **Code execution** switch in **Chat tools** defaults to on. Each conversation saves its
choice; the browser also remembers the last choice for new chats. Turning it off
omits both `run_python` and `download_file` from subsequent responses. Existing
results remain available. An enabled preference never bypasses runner readiness.

**Current verification status (2026-09-29):** all 14 live isolation checks passed
on the development WSL2 host with systemd, local Docker and gVisor. The running
backend reports Python available. A public CSV download, pandas analysis and CSV
export passed through the actual tool handlers and broker. This is verification
of this host, image and boot; other deployments must run their own verifier.

## Isolation boundary

Generated Python and document parsing run only inside a mandatory gVisor container.
The trusted host broker launches it with an unprivileged user, read-only root,
no network, dropped capabilities and enforced resource limits. Only disposable
job input and scratch directories are mounted. SAWOT, provider credentials, Home
Assistant, host application directories and Docker sockets are absent from the
guest. Downloads happen through the backend's controlled, IP-pinned public HTTP
transport; Python cannot download files or install packages itself.

This uses the host's hardware and is not a separate VM. It reduces escape risk;
it does not prove that no runtime vulnerability exists. The root-owned broker is
part of the trusted host control plane. A compromised host administrator or
backend is outside the threat model. A separate runner VM would require additional
transport/deployment work; this version uses a local Unix socket.

SAWOT remains a trusted-LAN application without user authentication. Conversation
checks prevent model tools from reading another conversation's files; they do not
create separate authenticated household accounts. Printed data and results are
sent to the selected model provider. Locally running Python does not imply local
model inference.

## Host prerequisites and setup

Use a Linux host with systemd as PID 1, Docker on that same host, cgroup v2 with
memory/CPU/process controls, and gVisor configured as Docker's `runsc` runtime.
Docker Desktop/remote daemons are not supported by this local-path deployment.
WSL requires a systemd-enabled distribution with its own compatible Docker daemon.
This configuration passed the live checks on the development WSL2 host. The broker needs about 1 GiB for two guest memory
limits, additional runtime overhead, and bounded input/scratch storage.

Review the [gVisor Docker setup](https://gvisor.dev/docs/user_guide/quick_start/docker/)
and [Docker resource controls](https://docs.docker.com/engine/containers/resource_constraints/).
Configure an **absolute** path to the trusted `runsc` executable in Docker's
runtime configuration. Runtime installation or Docker restarts are operator steps,
not performed by SAWOT.

1. Build the pinned guest image with `docker build -t sawot-python sandbox/image`.
   Record `docker image inspect sawot-python --format '{{.Id}}'` as its immutable
   `sha256:...` image ID. Never use a mutable tag in runner configuration.
2. Install the repository's `sandbox/` directory under `/opt/sawot-sandbox/sandbox`,
   owned by root and not writable by the backend or guest. Include tests and service
   definitions; readiness fingerprints them. Create the `sawot-runner` system group.
3. Create `/etc/sawot-runner.json`, root-owned mode 0600, containing exactly
   `{"image":"sha256:<image-id>","runscSha256":"<sha256-of-runsc-binary>"}`.
   These are operator-selected digests; compute the runtime hash with `sha256sum`
   against the absolute executable configured in Docker. Do not use the example
   placeholders literally.
4. Install `sandbox/systemd/sawot-job@.service` and `sawot-runner.service` into
   `/etc/systemd/system/`, then run `systemctl daemon-reload`. Review both units
   before installation. The broker requires host mount/Docker/systemd privileges;
   arbitrary hardening overrides can break its enforced controls.
5. Stop the broker if it is already running. From `/opt/sawot-sandbox`, run
   `sudo python3 -m sandbox.runner.verify`. This launches **real isolated jobs**;
   it does not execute their Python source on the host. Any missing prerequisite,
   failed test, or skipped live test rejects verification. It takes at least
   30 seconds because the independent watchdog is tested with an infinite loop.
6. Only after verification passes, start `sawot-runner.service`. The unit runs
   `sandbox.runner.verify --if-needed` before starting the broker: it reuses a
   valid receipt or runs all live checks if verification is stale. A root-owned
   verification receipt is tied to the code, image, runsc hash and host boot.
   Re-run verification after upgrades or reboot. No override enables a failed
   runtime, and no ordinary-container/host-Python fallback exists.
7. For native SAWOT, give its service user access to the `sawot-runner` group and
   set `SAWOT_RUNNER_SOCKET=/run/sawot-runner/runner.sock`. For Docker deployment,
   use `docker compose -f docker-compose.yml -f docker-compose.sandbox.yml up -d`
   after building/recreating the SAWOT image with this feature. The overlay mounts
   only the broker socket directory. Match group permissions if running SAWOT as
   a custom non-root UID.

For an installed native runner, `./run.sh` now starts the configured local service
automatically in the background after the app becomes reachable. The interface
is usable during verification; an open Chat tools dialog refreshes availability
every three seconds and shows Available when the runner is ready, without a
page reload. It requests sudo when the service needs to
start; after reboot or sandbox updates, isolation checks take about 45 seconds.
An already ready runner needs neither sudo nor another live test run. With no
runner socket configured, startup is unchanged. Custom sockets are checked but
their services must be started separately. If startup or verification fails,
SAWOT continues with code execution unavailable. The runner remains a separate
systemd service when SAWOT exits.

Existing installations must update the root-owned `sandbox/runner/verify.py` and
`sandbox/systemd/sawot-runner.service` under `/opt/sawot-sandbox`, install the new
service unit in `/etc/systemd/system/`, and run `sudo systemctl daemon-reload`.
Do this while the broker is stopped and no jobs are outstanding. The changed
files invalidate the old receipt, so the next service start verifies isolation.

From the repository root, with the broker stopped and jobs released:

```sh
sudo install -o root -g root -m 0644 sandbox/runner/verify.py /opt/sawot-sandbox/sandbox/runner/verify.py
sudo install -o root -g root -m 0644 sandbox/systemd/sawot-runner.service /opt/sawot-sandbox/sandbox/systemd/sawot-runner.service
sudo install -o root -g root -m 0644 sandbox/systemd/sawot-runner.service /etc/systemd/system/sawot-runner.service
sudo systemctl daemon-reload
./run.sh
```

The broker socket is a powerful local capability. Do not expose it over TCP or
mount it into generated-code containers. The broker does not listen on a network
port. Docker access belongs only to the trusted broker, not SAWOT or the guest.

## Limits and operation

| Resource | Limit |
| --- | --- |
| Download | 20 MiB, 30 seconds, five redirects |
| URL / Python source | 8 KiB / 64 KiB |
| Python execution | 30 seconds including staging, 1 CPU, 512 MiB, no swap |
| Guest process count | 64; actual enforcement is a live-verification gate |
| Host tasks per container | 256, including gVisor runtime threads |
| Inputs | 10 files, 100 MiB total |
| Writable job space | 128 MiB, inode-capped |
| Stdout + stderr | 64 KiB retained; excess discarded |
| Outputs | 10 files, 20 MiB each, 50 MiB total |
| Retained files | 100 files / 200 MiB per conversation, 2 GiB total |
| Concurrent jobs | 1 per conversation, 2 overall |

Tools retain the existing five-round model budget, with at most five downloads
and five Python calls per turn. No runtime package installation, OCR, authenticated
file downloads, private-network URLs, custom ports, or compressed HTTP response
bodies. CSV/XLSX contents are not evaluated in the UI. Downloaded content can still
contain malicious instructions: sandboxing does not remove prompt injection risks
against the model or separately enabled tools.

Run Python again with retained file IDs to continue an analysis; variables do not
persist. Failed code reports an error so the model can correct it within the
remaining budget. With web search disabled, download tools are omitted while
Python can use existing files. Known public URLs can be downloaded without a
Brave search key. Generated files are served as attachments, never active HTML.

Stop and delete cancel active analysis. Closing a browser does not cancel the
server-side turn. A per-job systemd deadline terminates the guest independently of
the broker. Broker startup reconciles abandoned job mounts. Completed job results
are released after retrieval, or within 90 seconds of job creation. Analysis files
live in `analysis/` below `SAWOT_DATA_DIR`, outside public uploads; deletion and
successful regeneration remove files that no surviving history references.

Disable by unsetting `SAWOT_RUNNER_SOCKET` and restarting SAWOT. To remove the
runner, stop its broker and job services before removing units, images or data.
Do not delete mounts while a job is running. Generated builds, downloaded files,
verification receipts and credentials must never enter Git.

## Verification commands

From the repository root:

```sh
python3 -m unittest discover -s sandbox/tests -v
```

This intentionally skips live tests without a prepared host. On the prepared
runner, `python3 -m sandbox.runner.verify` is the enablement gate. Setting
`SAWOT_SANDBOX_LIVE=1` for a direct test invocation makes missing prerequisites
fail rather than skip; it does not grant readiness or bypass the verifier.

From `ts-backend/`:

```sh
node --import tsx --test tests/publicFetch.test.ts tests/analysisFiles.test.ts tests/analysisTools.test.ts tests/analysisRoutes.test.ts ../web/tests/chatAnalysis.test.ts
npm run typecheck
npm run build
```

Frontend typecheck/build and browser checks use the normal project commands.
The sandbox CI workflow runs ordinary unit checks and can manually build the
image. It deliberately does not claim live isolation on an unprepared CI runner.
Never run untrusted PR code on a privileged persistent self-hosted runner.

### Development evidence (2026-09-28)

- Guest image built successfully from the pinned base and hash-locked wheels.
  Built image ID: `sha256:b77c2ad41e091a8f4ad6a14984fc119a63985f9f236104ce7fb1e26c13ca9dc5`.
- Backend and frontend typecheck/build passed; the full TypeScript regression
  suite passed 392 tests. These checks are separate from real isolation verification.
- Broker unit checks pass; all 14 live-isolation checks are explicitly skipped
  without the prepared host. An explicitly requested live run fails prerequisites.
- Browser fixture checks at 390px and 1280px passed for progress, code/output,
  escaped script-like text, attachment links and unavailable-runner rendering.
  No real model, document download or Home Assistant action was used in that UI check.
- Independent code review findings were addressed with focused regressions.
  None of these checks establishes real gVisor isolation on this development host.

### Runtime setup evidence (2026-09-29)

- Installed runtime reports `release-20260921.0`; Docker registers `/usr/bin/runsc`.
- A real startup check exposed an incompatible `/tmp` symlink. The image now has
  a directory there, and the runner bind-mounts the same job scratch subdirectory
  at `/tmp`; this does not allocate a separate writable storage budget.
- Rebuilt image: `sha256:25b777ed4959f1b89cbec52b0b1b0493e48b189a1f4a1767d6fc1f231613f8ab`.
- Real gVisor execution with the runner's restricted arguments read a synthetic
  CSV, computed 5, and verified that `/tmp` and `/work/tmp` share storage.
- Nine unit tests pass. Fourteen privileged live checks remain unrun; the smoke
  check does not verify the watchdog or all enforced limits. Broker installation
  still requires local administrator authentication.

- The privileged verification run reported a process-limit failure. A focused
  reproduction exited with code 2 at a 128-host-task cap, while a 256-host-task cap
  allowed the unchanged guest limit to reject fork after 63 children. The runner
  now allows 256 host tasks for runtime overhead; guest processes remain capped
  at 64. Live verification additionally checks Docker and cgroup `pids.max`.
  The complete privileged suite must pass again before enabling execution.

### Successful live enablement (2026-09-29)

- The installed privileged verifier passed all 14 checks in 47.198 seconds,
  including the unchanged 64-guest-process limit and 256-host-task cgroup limit.
- The broker reports ready with the rebuilt image above. The native backend was
  restarted with runner-group access and `SAWOT_RUNNER_SOCKET`; its live
  `/api/chat/tools` response reports `python: true`. Backend and sidecar health pass.
- Actual `download_file` and `run_python` handlers downloaded the public seaborn
  iris CSV, verified 150 rows with pandas inside gVisor, and retained a five-row
  CSV export. Test files used disposable storage and were removed. This check
  exercised the real download/storage/broker path without calling a model or HA.
- Backend/frontend builds and frontend typecheck passed. The broker was started
  for this boot; verification and broker startup are still required after reboot.

### Stable file interface update (verified 2026-09-29)

The broker now validates file IDs and provides stable read-only aliases for each
selected input. The backend requires the `stable-v1` input-path capability before
offering analysis tools. Upgrading requires installing the updated broker and
re-running all 15 live checks, including reordered selections and read-only aliases.
Previous execution outputs and errors are retained in bounded model history.
Available-file metadata is supplied as labelled application context before the
latest user question, rather than appended as a user message.

The updated host verifier passed all 15 checks in 46.857 seconds. The running
broker advertises `inputPaths: stable-v1` and the backend reports code execution
available. A real tool-handler check downloaded a public CSV, read its stable
path in gVisor, exported a five-row preview, and reused both retained files in
reversed selection order on a follow-up turn. Compiled history formatting kept
both actual outputs and the latest user question last. No model or Home Assistant
call was used for this verification; disposable test files were removed.
