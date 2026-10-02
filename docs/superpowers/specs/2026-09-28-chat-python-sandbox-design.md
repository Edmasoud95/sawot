# Flexible Python execution and web files in chat

Status: design approved on 2026-09-28; implementation has not started.

## Intent

The user wants flexible Python execution in chat, including downloading and
viewing files discovered through search results in a safe sandbox. A model should
be able to find a CSV, inspect its columns, calculate results, and explain or chart
them with a source link. Uploaded files use the same analysis path.

This is a new execution subsystem. The user approved flexible Python and the
strict sandbox design after clarification that generated code never runs in host
Python. The selected boundary is mandatory gVisor isolation, with no fallback.
A dedicated VM was discussed as optional stronger isolation and is not part of
the initial deployment described here. gVisor uses the host hardware; it does not
mean that code executes on a separate machine.

Success means a tool-capable model from any configured OpenAI-compatible provider
can run useful Python while runtime-enforced boundaries protect SAWOT credentials,
Home Assistant, the host, and other conversations. Isolation reduces risk; it is
not a guarantee against all vulnerabilities or misleading model answers.

## Existing integration points

- `ts-backend/src/chatRoutes.ts` assembles tools per conversation and owns turn
  cancellation. A browser disconnect currently leaves a turn running.
- `ts-backend/src/chat.ts` executes tools sequentially, has a five-round budget,
  and embeds up to 50,000 characters per text attachment in model context.
- `ts-backend/src/search.ts` provides search, page fetch, and find-in-page. Page
  fetch accepts HTML/plain text only. DNS validation and the actual fetch are
  separate, so the checked address is not pinned to the connection.
- Upload deletion already accounts for conversation ownership and shared files.
  This is a lifecycle pattern, not an authorization boundary: tool file access
  needs explicit conversation and visible-history checks.
- The current working tree includes chart rendering and chat lifecycle changes.
  Implementation must preserve and integrate with those changes.
- The main container combines speech and the backend and has application data
  and credentials. It must not execute model-generated Python.

## Chosen approach and alternatives

Use a separate local runner broker that launches a disposable Python container
under gVisor (`runsc`) for each execution. This supports normal Python libraries
and server-side work that continues when a browser disconnects. It requires an
additional Linux host runtime and runner service.

Fixed CSV operations do not meet the requested flexibility. Browser Python/Wasm
would need a separate origin and network policy, and would couple execution to
the browser session. Neither is the selected first implementation.

Use a controlled download service in the backend, followed by offline execution.
Python itself cannot fetch URLs. The model explicitly requests downloads through
`download_file`; multiple calls can gather several inputs before analysis.

## Tool contract

Tools use the existing provider-neutral function tool format. The server binds
the conversation ID, visible message history, and abort signal; the model cannot
select another conversation or pass host paths.

### `download_file(url)`

Accept a public HTTP/HTTPS URL from a search result, a link found on a result
page, or a user message. A search result is not evidence that a URL is safe.
Return an opaque file ID, a safe display name, byte count, declared media type,
original URL, final URL, and SHA-256 digest. Content type and name are untrusted
metadata, not proof of format. Do not parse the document in the backend.

The tool streams bytes to private temporary storage, then atomically registers
the complete file to the active conversation and turn. Failed, cancelled, or
oversized downloads leave no usable partial file. With web search disabled for
a conversation, omit this network-capable tool as well. Python remains available
for uploaded and previously acquired files.

### `run_python(code, file_ids)`

Accept Python source and explicit conversation-owned input IDs. Return bounded
stdout/stderr, status, exit code, duration, truncation flags, and registered output
file metadata. Structured statuses distinguish success, Python error, timeout,
resource limit, cancellation, unavailable runner, and policy rejection.

Each call starts a fresh interpreter. Inputs appear read-only under `/inputs/`
using server-generated names; the input manifest maps IDs to sandbox paths and
display names. `/work/` is scratch space. Files placed under `/outputs/` can be
retained and supplied as inputs to later calls. Variables and processes do not
survive between calls. Inputs are copied as bytes; no host path is accepted from
the model or exposed in results.

The image includes Python, pandas, NumPy, matplotlib with a headless backend,
openpyxl, and pypdf, with pinned dependency versions. CSV, JSON, text, XLSX, and
text-based PDF are supported workflows, not a restriction to predefined Python
operations. Other bytes may be downloaded and inspected with available libraries.
There is no automatic execution of downloaded scripts, macros, or installers,
and no runtime package installation. PDF OCR is outside the first version.

Python exceptions are normal tool results, allowing a correction within the
remaining tool budget. No retries bypass limits or silently repeat failed code.

## Download boundary

Create a shared public-URL transport for downloads and existing page fetching:

- Allow only HTTP/HTTPS on ports 80/443, without URL credentials. Send no cookies,
  authorization headers, application secrets, or caller-specified headers.
- Resolve and validate all A/AAAA answers. Reject non-global destinations,
  including loopback, private, link-local, multicast, unspecified, reserved,
  IPv4-mapped IPv6, and special-use/transition encodings that could bypass policy.
  Use a maintained address classifier with explicit regression fixtures.
- Pin a validated destination to the actual connection while preserving the
  original hostname for HTTP Host and TLS certificate verification. Disable
  environment proxy inheritance. Do not resolve again inside an unconstrained
  client after validation.
- Handle redirects manually, reapply all rules at every hop, allow at most five,
  reject HTTPS-to-HTTP downgrades, and close abandoned response bodies.
- Apply a single deadline across DNS, redirects, headers, and body streaming.
  Request identity encoding and reject non-identity content encoding in the first
  version, preventing transport decompression bombs. Never trust Content-Length
  as the sole size check.
- Generate storage names internally. Content-Disposition and URL basenames are
  display hints only. Strip control characters and limit display-name length.

The downloader transfers opaque bytes only. Parsing and archive inspection occur
inside the offline sandbox. Python may open archives, but extracted data remains
within sandbox filesystem and resource limits.

## Execution and broker boundary

The broker is a trusted, minimal host service, separate from the web/speech
container. It controls Docker with the required `runsc` runtime; only this broker
has runtime access. Neither SAWOT nor the sandbox receives the Docker socket.

Expose a permission-restricted Unix socket to the backend (also mountable into
the SAWOT container). Do not publish a TCP runner port. Its bounded protocol
accepts code and input bytes, starts a job, reports status/results, and cancels a
job. It never accepts arbitrary image names, commands, host paths, mounts,
environment variables, runtime flags, or resource-limit overrides. All job IDs
are generated by the broker. The image is fixed by trusted operator configuration
and pinned by digest; never pull images in response to a tool call.

Each job uses gVisor, an unprivileged UID, read-only root filesystem, no network,
no host namespaces or devices, no extra capabilities, no privilege escalation,
and a minimal environment. Only job-specific input bytes and capped scratch/output
storage are available. All writable locations, including caches and temporary
directories, must be in the bounded job storage. Resource enforcement is external
to the generated Python; monkey-patching or restricting Python builtins is not
the security boundary.

The broker independently enforces deadlines, kills the whole job on expiry, and
caps log capture. It stops all workload processes before collecting output files.
Output collection treats filesystem entries as hostile: accept only regular
files, reject links/devices/FIFOs, use descriptor-relative no-follow access, and
enforce file count, per-file size, and aggregate limits. No generic archive
extraction into the host is permitted for staging inputs or collecting outputs.

The broker is part of the trusted computing base because it controls the
container runtime. A compromise of the backend is not made harmless by this
design. The security target is malicious generated code and malicious documents,
not hostile administrators or an already compromised host.

## Initial enforced limits

| Resource | Limit |
| --- | --- |
| One download | 20 MiB, 30 seconds including DNS and redirects |
| Download URL / Python source | 8 KiB / 64 KiB |
| Downloads / executions per assistant turn | 5 / 5, also subject to existing five-round budget |
| Python job | 30 seconds from job creation through execution, 1 CPU, 512 MiB RAM, no swap |
| Job processes | 64; limit numerical library threads to avoid unnecessary fan-out |
| Writable scratch plus outputs | 128 MiB aggregate |
| Input files per job | 10 files, 100 MiB aggregate |
| Captured stdout plus stderr | 64 KiB; drain/discard excess and report truncation |
| Exported output | 10 files, 20 MiB each, 50 MiB aggregate |
| Retained analysis files | 100 files / 200 MiB per conversation; 2 GiB installation-wide |
| Active Python jobs | 1 per conversation; 2 installation-wide |

Reserve retained-file quota before writes and settle it atomically afterwards so
parallel conversations cannot exceed the installation limit. Busy runners return
a clear busy status rather than creating an unbounded queue. Broker admission
also caps staging bytes and concurrent requests. Limits are fixed defaults in
the first version; increasing them requires a reviewed operator configuration.

## Files, retention, and chat behavior

Store analysis files outside the publicly served upload directory, below the
configured application data directory. A server-owned manifest records IDs,
conversation/turn ownership, provenance, size, digest, and safe display metadata.
Never discover files by accepting a model-supplied path or filename prefix.

Existing uploads enter the sandbox only after verifying that they belong to the
active conversation and are attached within its visible history. Legacy uploads
without provable ownership require reattachment. Files from regenerated-away
turns are unavailable to the new branch of history. Persist provenance and tool
outcomes on the assistant turn, including partial outcomes on cancellation, so a
reload preserves legitimate later access. Add a bounded available-file manifest
to subsequent model context instead of embedding whole analysis files.

Keep completed inputs/outputs until conversation deletion, within quotas. On
deletion, cancel jobs before cleanup and prevent late results from recreating
records. Remove unreachable files after regeneration; preserve files still
referenced by surviving turns. Ordinary uploaded-file cleanup retains its
existing shared-reference rules. Startup reconciliation removes incomplete
staging and orphaned jobs/files; completed referenced files are preserved.

Expose files through a conversation-scoped endpoint that validates ownership.
Use attachment disposition and `nosniff`; do not serve untrusted HTML/SVG or
generated scripts inline. Render textual previews as escaped text. Initial charts
can use the existing validated chart JSON renderer; matplotlib images are
downloadable attachments initially, avoiding a new untrusted inline image path.

Chat shows compact download/analysis progress and file links, with optional code
and output details. No new voice-screen controls. Stop, conversation deletion,
and backend shutdown cancel downloads and jobs; a viewer disconnect does not.
Restore persisted activity/results after reconnect, following the existing chat
lifecycle. Preserve source links for downloads and record input provenance for
derived files. Cite original sources in model answers.

Documents and execution output are untrusted tool data. Prompt instructions
must not promote file text to system instructions or authorize unrelated actions.
Sandboxing does not eliminate prompt injection against other tools; existing
Home Assistant tool policy remains independent. Python cannot directly call HA.
Returned previews and calculation results are sent to the selected model provider
as normal tool results; local execution does not imply local model inference.

## Deployment and availability

Support an optional Linux runner deployment with Docker, gVisor, and enforceable
cgroup limits. Add a broker service definition, sandbox image, setup guide, and
Unix-socket mount example for both native SAWOT and the existing container.
The default voice/chat deployment remains usable without the optional runner.

Readiness must verify configured runtime identity from the trusted host side,
image availability, required resource controls, and an isolation smoke test.
Never trust a string printed by the guest as proof of gVisor isolation. Advertise
Python/download tools only while readiness succeeds; return a clear unavailable
error if readiness changes during a turn. Never fall back to host Python, the
speech sidecar, or an ordinary unrestricted container.

This checkout has a Docker executable, but `runsc` was not found on the current
shell PATH. That does not establish the Docker daemon's runtime configuration.
Live runtime feasibility and WSL compatibility must be verified before enabling
the feature; no runtime installation or daemon changes have been performed.

## Verification and acceptance

1. Unit tests cover file ownership, history/regeneration, output selection,
   truncation, quota races, URL parsing, IPv4/IPv6 special ranges, redirects, DNS
   rebinding, deadlines, misleading headers, failed downloads, and cancellation.
2. Broker contract tests reject arbitrary mounts/images/options, malformed input,
   oversized requests, forged IDs, unsafe output entries, and unavailable runtime.
3. Real sandbox tests attempt host secret reads, cross-conversation reads, network
   and metadata access, symlink escapes, subprocess survival, memory/process/disk
   exhaustion, infinite loops, and log flooding. Check host cleanup afterwards.
4. With fixture files and deterministic tool calls, download a CSV, inspect it,
   calculate a known aggregation, export a result, and use it in a later call.
   Repeat for XLSX and text-based PDF, including malformed and compressed inputs.
5. Exercise stop/delete/regenerate/reconnect and backend/broker restart during
   jobs. No stale process, late conversation recreation, or partial-file exposure.
6. Browser checks at desktop/mobile widths cover compact progress, errors, file
   links, escaped malicious output, existing charts, and reconnect behavior.
7. Run affected backend/frontend checks and focused regression tests. Report
   mocked tool tests separately from real gVisor and live model-provider tests.

Do not enable the feature based only on mocked tests. Live isolation and resource
enforcement checks are release gates. A hostile-file test passing is evidence for
that case, not proof against all sandbox escapes.

## Sources and next stage

The runtime choice and network design were checked against:

- [gVisor security model](https://gvisor.dev/docs/architecture_guide/security/)
- [gVisor Docker setup and runtime verification caveat](https://gvisor.dev/docs/user_guide/quick_start/docker/)
- [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)

After review of this design, write an implementation plan with a first vertical
slice that proves real isolated execution and protected downloading before adding
chat integration. No product code, dependency installation, runtime configuration,
or deployment is authorized by the existence of this document alone.
