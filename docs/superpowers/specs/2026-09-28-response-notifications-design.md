# Response-completion notifications

## Intent and current state

The user wants a phone notification when a chat answer finishes, including while
SAWOT is backgrounded or closed. The primary target is an installed SAWOT PWA in
Brave on Android. Notifications must work with the existing trusted-LAN setup.

Chat generation now survives browser disconnects. `chatRoutes.ts` saves completed
answers and exposes running snapshots through the conversation GET endpoint.
The frontend can recover those snapshots without resending the model request.
SAWOT has a web app manifest but no service worker or push subscriptions.

The user approved the notification feature scope. This document records the
proposed implementation design; notification code is not implemented yet.

## User experience

- Add a device-local notification control in Settings → Assistant. It reports
  unsupported, disabled, enabled, or browser-blocked permission states.
- Enabling notifications requires a deliberate button click. Request browser
  permission and subscribe this installation; never prompt on application launch.
- Notify the installation that submitted the chat turn, provided it opted in.
  Other household devices do not receive that conversation's notification.
- The lock screen shows **SAWOT — Your response is ready.** Do not include the
  prompt, answer, conversation title, search results, or home-device information.
- Tapping opens the matching conversation, reusing a SAWOT window when possible.
  Drafts in another conversation are saved through the existing navigation flow.
- Disabling unsubscribes this installation and removes its backend registration.
- Notify completed normal and regenerated replies. Do not notify commands,
  failed turns, explicitly stopped turns, or deleted conversations.
- In this first version, opting in permits a notification for every completed
  turn initiated on that installation, including when the app is visible.
  Foreground suppression and account-wide cross-device delivery are out of scope.

## Architecture and data flow

Use standard Web Push, with a small backend module and the maintained `web-push`
package. This avoids requiring Home Assistant Companion, a native SAWOT app, or
a separate hosted notification application.

1. The browser registers a same-origin service worker at `/sw.js`, scoped to `/`.
   This worker handles push and notification clicks only. It does not intercept
   fetches or cache HTML/assets, avoiding a new stale-frontend/offline-cache path.
2. The backend supplies its VAPID public key. The browser creates a subscription
   and registers its endpoint and encryption keys with SAWOT.
3. The backend returns an opaque, cryptographically random device capability.
   The browser stores it locally and includes it in subsequent message and
   regeneration requests. Never accept a raw push endpoint in a message request.
4. A turn captures its notification recipient when it starts. After the answer
   is saved, queue a notification for that recipient with a unique turn ID.
5. Push delivery has its own short timeout and cannot roll back the answer,
   change its successful status, delay the final chat event, or hold the turn
   lock. Catch delivery errors separately from model-generation errors.
6. The worker displays the generic notification. A stable tag per turn replaces
   duplicate deliveries, and its click handler opens the associated conversation.

Use a stable VAPID key pair generated once and persisted under the existing data
directory. Store subscriptions and device capabilities in the same private data
area using atomic writes and restrictive file permissions. Keep these separate
from shared user settings and provider credentials. The public settings API must
not expose the private key, subscriptions, or device capabilities.

## API and integration boundaries

- A public-key endpoint returns the VAPID public key and feature availability.
- Registration accepts a bounded, validated browser subscription and returns its
  opaque device capability. It can refresh an existing installation registration.
- Unregistration requires that installation's capability. Do not expose an
  endpoint that lists household subscriptions or sends arbitrary notifications.
- Message and regeneration requests accept an optional registered device
  capability. Missing, invalid, expired, or removed capabilities do not prevent
  ordinary chat from working; they simply do not receive notifications.
- Extend the chat context with a completion callback implemented by the push
  module. Trigger it only after successful persistence and only once per turn.
- Notification navigation uses `/?chat=<validated conversation id>` for a cold
  start and a service-worker message for an existing window. Respect this target
  before the mobile chat view's default new-conversation behavior.
- Use a project HTTPS contact URL for the VAPID subject, with an optional operator
  override. No developer email address or household hostname is baked into code.

## Delivery, privacy, and failure handling

The backend sends outbound HTTPS requests to the browser's push service. The
service delivers to the phone; SAWOT does not need an inbound public endpoint.
Both the sender and phone need internet access. Opening the actual conversation
still requires access to SAWOT over the home network or an existing private VPN.

Validate push-service URLs against supported vendor endpoint hosts and HTTPS,
reject credentials and arbitrary destinations, and validate subscription key
sizes. Apply request-size and registration-count limits. Mutating subscription
routes must reject untrusted cross-origin requests. These controls preserve the
current trusted-LAN model; they do not introduce user authentication.

Delete expired subscriptions on push-service 404/410 responses. Use bounded retry
for transient delivery failures, with the same turn tag to limit visible
duplicates. Log only a delivery outcome/status and turn identifier, never a
subscription URL, capability, key, or response text.

The initial implementation does not introduce a durable notification queue.
A backend restart after saving a reply but before sending its notification may
lose that notification. Saved conversations remain intact. Device/browser policy
can also delay delivery; immediate delivery is not guaranteed.

## Compatibility and validation

The application requires a secure context with a certificate trusted by the
phone. Check APIs before showing an enabled state. Brave's push settings and
Android notification permissions may affect delivery; show actionable failure
text and keep chat functional if subscription fails. On iPhone, web push requires
an installed Home Screen web app and notification permission.

Automated coverage must prove:

- persistence and registration validation; private material excluded from public
  responses and logs;
- exactly one completion callback after a saved answer, including after browser
  disconnect and regeneration;
- no notification after cancellation, failure, deletion, or chat commands;
- a push failure cannot fail the chat or leave its lock held;
- expiry cleanup, bounded retries, and duplicate notification tags;
- device-specific targeting, permission denial, unsubscribe, and startup recovery;
- notification click navigation with both an existing window and cold start,
  without discarding drafts or creating an unwanted new chat;
- no service-worker fetch interception or stale application caching.

Browser checks cover permission UI, notification handling, and click navigation
at mobile and desktop widths using controlled fixtures. Final delivery validation
requires the user's Android Brave PWA with permission granted, testing app-open,
background, and closed cases. Mocked browser tests are not proof of phone delivery.

## Reference behavior

- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [MDN notification clicks](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event)
- [WebKit iOS Home Screen push requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Brave notification troubleshooting](https://support.brave.com/hc/en-us/articles/360058972091-Push-Notification-Test)
