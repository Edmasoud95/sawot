# Private memories implementation

Approved behavior: providers explicitly opt into private memory access. Users and agents may mark a memory private; only users may remove privacy. Non-private providers receive no private memory data. Conversations that save or recall private memories become permanently private, including branches. Private conversations cannot use non-private model or speech providers. Web search stays enabled.

Defaults: missing provider trust means false; existing memories stay non-private. Built-in model provider needs explicit trust too. Local speech synthesis stays on-device; remote speech providers need explicit trust. Privacy does not retract content already submitted to any service, and search queries may still disclose content.

Implementation tasks:
- [x] Persist provider trust and expose Settings control, including built-in provider.
- [x] Add memory privacy flags and store-level read/write enforcement; hidden facts must not leak via collisions or idempotency.
- [x] Persist conversation privacy before private results reach inference; guard sends, model changes, regeneration, branching, titles and speech.
- [x] Revalidate provider trust and memory state during active turns.
- [x] Add memory editor privacy controls, private chat notice, compatible model filtering, and speech conversation context.
- [x] Test privacy boundaries, migration/defaults, browser UI, typechecks/builds, and runtime.

Work in the existing checkout; preserve the uncommitted active-search query work. No commit or push requested.

Verification: 506 TypeScript regression tests passed; backend and frontend typechecks and production builds passed. Browser checks against the production build with mocked records verified provider toggles, memory privacy editing, restricted model choices, fresh-chat reset, and mobile layout at 390px. Restarted runtime returned HTTP 200 from `/health`. No live model or speech inference was used for privacy verification.
