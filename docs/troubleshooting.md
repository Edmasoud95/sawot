# Troubleshooting and limitations

[← Back to SAWOT](../README.md)

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Voice stays on Connecting | Set the exact browser origin in `SAWOT_ALLOWED_ORIGINS` or YAML; scheme, hostname, and port must match. Restart the backend. Proxies must preserve Origin and support WebSocket upgrades. |
| Phone microphone or camera is unavailable | Use HTTPS with a certificate trusted by the phone. See [phone access](installation.md#phone-access-and-https). |
| Uploads fail on a fresh install | Create `data/uploads` for native installs, or `data/data/uploads` on the host with the supplied Compose mount. |
| Home Assistant tools are unavailable | Save both the URL and token in Settings → Connections, then enable Home Assistant for the chat. Check server reachability if tools still fail. |
| Speech fails while the UI works | Check sidecar logs, download/select an STT model, and allow initial TTS loading to finish. Backend `/health` alone does not establish speech readiness. |
| First reply after an idle period is slow | Speech weights unload after ten idle minutes and reload for inference. |
| Context limit error | Start a new chat or select a model with a larger context window. `/status` is an estimate; it does not resize the model’s actual context. |
| New code appears unchanged | Rebuild both TypeScript packages and restart. `run.sh` only builds missing `dist/` directories. |
| Settings report a busy lock after a crash | Stop SAWOT before removing a stale `settings.json.lock` directory; then restart. |

Use **Settings → Advanced → Debug bar** for turn timings and errors. Debug
exports may contain conversation and device information; review them before
sharing. Report reproducible bugs through [GitHub issues](https://github.com/Edmasoud95/sawot/issues).

## Known limitations

| Area | Current limitation |
| --- | --- |
| Access control | No authentication, separate users, or per-user conversation isolation. Trusted LAN only; a Home Assistant add-on with ingress is not included. |
| Hands-free voice | Explicitly started sessions only; no wake word or spoken barge-in during replies. Tap the microphone to interrupt. Local sound-level detection uses a 1.4-second quiet interval and a 45-second turn limit; background sound or long thinking pauses can split turns. Noisy-room and real-device microphone behavior still need validation. |
| PDF support | Files are stored, but the TypeScript chat backend does not extract their text. Copy text into a supported text file instead. |
| Upload lifecycle | Chat deletion removes associated files. Unassociated legacy uploads and voice uploads have no automatic cleanup. Fresh installs must create the uploads directory; both documented installation paths include this step. |
| Setup wizard | `scripts/setup.py` parses successfully, but still asks for a Home Assistant URL and writes a config without a voice-origin allowlist. Use the documented installation steps, which include the required origin setup. |
| Model compatibility | Tool calling, image input, reasoning, and provider transports vary. The image-support hint uses model-name heuristics and can be wrong. |
| Memory/context | Chat sends the full saved message history; voice retains history for the current connection. For the built-in local provider, context metadata uses LM Studio’s native API when available (loaded context first, model maximum otherwise). Custom providers and unavailable metadata use an assumed 128,000-token capacity. The provider enforces its actual limit; context overflow displays an error. There is no automatic trimming or summarization. Text attachments are capped at 50,000 characters. |
| Web retrieval | Page downloads and extracted text are bounded; login-only pages, JavaScript-heavy pages, and unavailable sites may not yield useful content. |
| Speech performance | Speed, RAM/VRAM use, and language quality depend on the selected engines and hardware. Idle reloads add latency; optional Chatterbox requires extra dependencies. |
| Platforms | The published Docker image is CPU-only and `linux/amd64`; there is no native ARM image for Raspberry Pi or Apple Silicon. |
| Visual output | Freehand sketches depend on the model. An action shape indicates an attempted action, not confirmation that a device changed. |
| Frontend development | The current Vite config proxies `/ws` only. Full chat/settings development also needs `/api` and relevant audio routes proxied to the backend. The built UI served on port 8765 avoids this issue. |

## Response notifications

- Enable notifications inside Settings → Assistant on the device sending the
  message. Commands, errors, and stopped responses do not send notifications.
- If unavailable, check that the app uses HTTPS with a certificate trusted by
  the phone. On iPhone, launch the installed Home Screen app.
- If blocked or subscription fails in Brave on Android, check the site's
  notification permission, Brave's push messaging setting (if offered), and
  Android's notification permission for Brave/the installed app. Retry Enable
  after changing these settings; the app never prompts automatically on launch.
- If disabling fails while offline, new messages stop targeting that installation
  immediately. Reconnect and retry Disable to finish deleting its registration.
- Delivery can be delayed by browser/OS power policy or connectivity. Both the
  server and phone need internet access to the push service. A server restart
  can lose queued notifications; saved answers remain available in chat.
- Tapping away from your home network requires a private VPN or returning to the
  LAN. The requested conversation is retried when the app regains focus or goes
  online; you do not need to expose SAWOT publicly.
