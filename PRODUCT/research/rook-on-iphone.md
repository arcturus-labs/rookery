# Can Rook Run on iPhone? An Engineering Research Document

**Audience:** John (Rook product owner) and Rook engineers
**Status:** Research / decision-grade. Recommendations, not commitments.
**Date:** 2026-06-16

---

## Executive summary

Rook can have a real, useful iPhone presence — but **not by porting the macOS app**. The macOS Rook is an *omniscient observer*: it watches which app is frontmost (`NSWorkspace`), reads other apps' windows, screenshots and OCRs the screen, and reaches the user from a persistent menu-bar item over a live WebSocket. **None of that observer model survives the iOS sandbox.** The honest answer to the owner's three questions:

1. **Can an iPhone app monitor the foreground/processes of other apps, like the macOS `NSWorkspace` monitor?** **No.** This is impossible on a normal App Store iPhone — and it is a *deliberate, load-bearing* property of the iOS sandbox, not a missing feature or an entitlement you can request. Apple's own engineers say plainly "there's no supported way to do this." The closest sanctioned signal ("the user just opened app X") comes only from a **user-built Shortcuts automation**, one app at a time, that the user wires up by hand.

2. **Could a Rook presence live in the Dynamic Island most of the time, like the Mac menu-bar presence?** **Partly — but not "most of the time."** A Live Activity (ActivityKit) is genuinely the closest analogue to the menu-bar item, and the server can update and even remotely *start* it. But Apple hard-caps a Live Activity at ~8 hours active (~12h including Lock-Screen linger) and its Human Interface Guidelines require it to model a *task with a defined beginning and end*. A literal always-on Dynamic Island resident is unsupported and an App Store rejection risk. The realistic UX is an **ephemeral, frequently re-summoned, session-scoped presence**, not a permanent fixture.

3. **How does the persistent-context / cross-device "triangulation" vision work — phone + other apps + back to the computer, with a hosted server holding all chats?** **Feasible, but it forces a concrete redesign of Rook's current architecture.** The phone cannot hold a live agent socket in your pocket (iOS suspends backgrounded apps; they do zero networking). The universal, proven pattern (ChatGPT, Claude, OpenClaw) is: **the hosted server is the always-on home of every chat and every live agent runtime; the iPhone is a thin, ephemeral client that connects only while open, and the server reaches it through APNs push otherwise.** Adopting this *reverses two current Rookery design decisions* (AS-BUILT §10 "Rookery is not the durable transcript store" and §5.2 "rooms idle-shut-down shortly after the last client disconnects") and adds APNs + cross-device identity.

**The one-line strategic takeaway:** stop trying to make the iPhone *watch the user's screen*. Make it **feel the user's world** (location, motion, calendar, what they share in) and **carry Rook in their pocket** (push-driven presence, notification approvals, a full chat when opened). The phone is a *context feeder and a pocket terminal*, not an omniscient observer.

---

## The iOS reality vs. macOS — why the sandbox changes everything

The macOS Rook leans on four capabilities that have **no App-Store-legal iOS equivalent**:

| macOS capability | iOS reality |
| --- | --- |
| Foreground-app detection (`NSWorkspace.frontmostApplication`, `runningApplications`, `didActivateApplicationNotification`) | **No equivalent.** AppKit-only; no UIKit counterpart; sandbox-forbidden. ([forum 70629](https://developer.apple.com/forums/thread/70629), [NSWorkspace docs](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)) |
| Reading other apps' Accessibility tree / window titles | **No equivalent.** iOS accessibility exposes only the app's *own* UI. |
| Arbitrary screenshot + OCR of the whole screen / other apps | **No equivalent.** Capture only via a *user-initiated* ReplayKit broadcast with a visible indicator. Silent ambient capture reads as spyware. |
| AppleScript / CGEvent control of other apps | **No equivalent.** No cross-app automation or input synthesis; the sanctioned surface is App Intents / URL schemes for *your own* app. |
| Persistent menu-bar item + always-on WebSocket | **No equivalent.** Backgrounded apps are suspended and do zero networking; presence is a time-boxed Live Activity driven by server push, not a resident process. |

The root cause is the iOS process sandbox. Apple states a third-party app may access information other than its own **"only by using services explicitly provided by iOS"** ([Security guide](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web)). The rationale Apple gives for the foreground-app prohibition specifically is privacy: *"you wouldn't want one app to be able to monitor how often you use their competitor's app"* ([forum 70629](https://developer.apple.com/forums/thread/70629)).

`UIApplication` lifecycle notifications (`willEnterForeground`, `didEnterBackground`, `applicationState`) report **only Rook's own** state — never another app's ([UIApplication.state](https://developer.apple.com/documentation/uikit/uiapplication/state)).

**What this means for product:** the iPhone Rook cannot be the screen-reading controller it is on Mac. Its environment awareness must be rebuilt on signals iOS *does* give: physical world (location, motion, calendar), the user's own in-app context, what the user explicitly shares or routes in, and Focus mode.

---

## Q1 — Can the iPhone monitor other apps' foreground/processes?

**Blunt answer: No.** There is no `NSWorkspace` equivalent and no entitlement unlocks one. This was the single most over-claimable area in the research, and adversarial verification **confirmed** the negative: a sandboxed app cannot enumerate other apps, read the frontmost app's bundle id / name, or be notified of foreground switches by identity. Heuristic workarounds (comparing process names via `sysctl()`, excessive `-canOpenURL:` probing, private APIs) are App-Store-rejected and increasingly sandbox-blocked — Apple's guidelines explicitly forbid using `canOpenURL:` to infer installed apps.

So the question becomes: **what adjacent signals exist, and what do they actually give you?** Here is the honest map.

### The adjacent-signal table

| Mechanism | What it gives Rook | Hard limit / why it's not `NSWorkspace` | Entitlement | Review risk |
| --- | --- | --- | --- | --- |
| **Direct foreground-app enumeration** | — | **Impossible.** Sandbox-forbidden, no entitlement, jailbreak-only. | none exists | **Blocked** |
| **Screen Time: FamilyControls + FamilyActivityPicker** | The *user* picks apps; Rook gets **opaque, non-reversible tokens** (`ApplicationToken`) | Tokens **cannot** be converted to bundle id / name (`bundleIdentifier` is `nil` *by design*); user-driven, not programmatic; not real-time foreground | `com.apple.developer.family-controls` (gated, manual approval, ~3 weeks, per bundle id) | **High** |
| **DeviceActivityMonitor extension** | Callback when a user-selected app crosses a **cumulative-usage threshold** | **Not an app-launch event** — threshold/accumulation based; documented as *imprecise/buggy across iOS 17–26* (fires early, duplicated, sometimes not at all); extension holds only opaque tokens; ~5–6 MB memory ceiling, killed quickly | `com.apple.developer.family-controls` | **High** |
| **DeviceActivityReport extension** | The **only** place app identities resolve to names | **Cannot exfiltrate anything** — no network, no App Group, no files, no notifications. Render-only inside the report UI. Kills any "send which-app to the server" design. | `com.apple.developer.family-controls` | **High** |
| **Shortcuts "App ▸ Is Opened" personal automation** | **"User just opened app X"** — the *only* sanctioned identity-bearing signal | **User must hand-build one automation per app.** Rook can't enumerate apps or auto-register triggers. Event-driven, not "what's frontmost now." | none (uses Shortcuts + your App Intents) | **Low** |
| **Focus filters (`SetFocusFilterIntent`)** | Current Focus *mode* (Work / Personal / Sleep) | Mode, never frontmost app. Only fires reliably when Rook is active; user-configured; two identical filters indistinguishable. | none (App Intents) | **Low** |
| **NetworkExtension DNS proxy / content filter** | Visited *domains* system-wide | **MDM / supervised devices only** — non-starter for consumer App Store. Also identifies domains, not the originating app. | `networkextension` + supervision | **High** |
| **Physical-world + in-app context** | Location, geofences, motion, calendar, NFC/beacons, Share Sheet, voice, App Intents | Scoped to Rook's own authorized context. "Environment = another app/website" stays impossible. **But this is the genuine iOS strength.** | standard usage-description keys | **Low** |

### Important corrections to the research (where it was loose)

- **"Make Shortcuts the primary bridge via App Intents + AppShortcutsProvider"** — directionally right, but the research conflated two mechanisms. **The detection signal comes from the user's *personal automation*, not from App Intents.** `AppShortcutsProvider` only *exposes Rook's own actions* (e.g. a "Notify Rook" intent) so the user can drop them into an automation they build by hand. App Intents supply the *action the automation calls*; the user-created "App ▸ Is Opened" trigger supplies the *signal*. There is **no API** for Rook to register "notify me when app X opens." The real constraint is UX (manual per-app setup), not the platform. The silent headless POST does work: "Get Contents of URL" with Background Request can fire a POST without foregrounding Rook ([Shortcuts automation](https://support.apple.com/guide/shortcuts/intro-to-personal-automation-apd690170742/ios), [run-immediately](https://matthewcassinelli.com/automations-run-immediately-shortcuts-notifications/)).

- **"No entitlement unlocks it"** — true *for `NSWorkspace`-style frontmost identity*. The Family Controls entitlement unlocks only *opaque, consented, threshold-based* usage monitoring that is **not** an `NSWorkspace` equivalent and does not serve Rook's use case. Don't conflate the two.

- **Family Controls is real and ships** (one sec, Opal, the open-source `kingstinct/react-native-device-activity` library) — so it's *not* rejected on principle. But the entitlement is granted case-by-case to genuine parental-control / digital-wellbeing apps; an app requesting it to build a general "which app is the user in" monitor is at **high risk of the entitlement request being denied**, independent of normal binary review.

**Recommendation for Q1:** Treat foreground-app monitoring as **impossible, not deferred.** Do **not** architect around knowing the frontmost app. If a coarse "user opened app X" signal genuinely matters, ship App Intents + a guided onboarding that helps the user build Shortcuts automations — accept it only covers apps the user wires up. Otherwise, pivot environment-awareness entirely to physical/in-app signals (Q3).

---

## Q2 — Can a Rook presence live in the Dynamic Island "most of the time"?

**Blunt answer: A Rook presence *can* live in the Dynamic Island and Lock Screen via ActivityKit Live Activities — but "most of the time" / "always-on like the menu bar" is not supported.** The honest framing is **session-scoped and re-summonable**, not permanent.

### What's genuinely possible (confirmed)

- **Live Activity + Dynamic Island.** A WidgetKit widget renders Rook in the Dynamic Island (compact leading/trailing, minimal, expanded) and as a Lock Screen / StandBy card. Started in-app via `Activity.request(attributes:content:pushType:)`. **No special signing entitlement** — only the Info.plist key `NSSupportsLiveActivities = YES`. ([request docs](https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:)), [HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities/)) *(Note: any reference to a `com.apple.developer.liveactivity.permission` entitlement is a hallucination — it does not exist.)*

- **Remote updates from the hosted Rook server over APNs** (`apns-push-type: liveactivity`). The server pushes status/message/progress; the *system* renders it without waking Rook's process. The app obtains per-activity tokens via `Activity.pushTokenUpdates` (which can rotate — handle ongoing, not one-shot). **Token-based (.p8) APNs auth is mandatory**; certificate auth does not work for this push type. ([ActivityKit push docs](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications), [WWDC23 10185](https://developer.apple.com/videos/play/wwdc2023/10185/))

- **Push-to-start (iOS 17.2+).** The server can *start* a fresh Live Activity remotely so Rook re-appears even when the app isn't running — registered via `Activity<T>.pushToStartTokenUpdates`, server sends payload with `event: "start"`. This is how you make presence feel "mostly there" despite the time cap. ([pushToStart docs](https://developer.apple.com/documentation/activitykit/activity/pushtostarttokenupdates)) *(Caveat: the user must have opened the app at least once to mint the push-to-start token.)*

- **Tap interactivity via App Intents (iOS 17+).** Buttons/toggles run a `LiveActivityIntent.perform()` in-process without fully launching the app — perfect for "Approve" a Rook permission, "Stop" the agent, "Send" a canned reply. **No free-text input** from the island; real typing requires opening the app. HIG prefers a *single* control. ([HIG](https://developer.apple.com/design/human-interface-guidelines/live-activities/))

### The hard constraints (and corrections to the research)

- **The ~8-hour cap is a soft ceiling, not a contract.** Apple says a Live Activity can be active **up to eight hours**, then the system auto-ends it and removes it from the Dynamic Island *immediately*; it lingers on the Lock Screen up to **four more hours** (~12h total) before removal. The research's "~12h total" arithmetic is *folklore-ish* — treat 8h as the design ceiling, not a guaranteed lifetime.

- **HIG requires a task "with a defined beginning and end"** and forbids tasks exceeding eight hours. **A literal always-on Rook avatar is off-label use and a plausible Guideline 4.x / HIG-misuse rejection.** Repeatedly auto-re-summoning an activity purely to fake ambient persistence can read as the spammy churn the guidelines discourage.

- **`relevanceScore` is *not* a 0–100 scale.** The research claimed "0–100"; Apple documents it as a `Double` with **no stated range**, whose only role is ordering multiple simultaneous activities. Don't design around a 0–100 contract.

- **Update budget is real.** High-priority (`apns-priority: 10`) updates are throttled when over budget (recovery can take **up to 24h**); low-priority (`5`) are opportunistic/unlimited but may be delayed — **unsuitable for token-by-token streaming.** `NSSupportsLiveActivitiesFrequentUpdates` (a *widget-extension Info.plist key, not an entitlement*) raises the budget, but the **user can disable it** (`ActivityAuthorizationInfo.frequentPushesEnabled`).

- **`Activity.request()` only works in the foreground.** Background/geofence triggers can't directly call it (throws `ActivityAuthorizationError.visibility`); use push-to-start instead. **The widget extension only renders UI — it runs no agent code, has no network, no location, a 4 KB payload cap.** Real work is server-side.

- **Review risk is *low* when used idiomatically** (Uber, food delivery, sports, flights all ship this), and *medium-to-elevated* only if framed as a permanent ambient presence. The research's "medium" baseline was slightly pessimistic for correct usage and slightly optimistic for the "mostly-present" framing.

### A realistic "Rook in the island" UX

Frame the presence as **session/task-scoped**, which is exactly what Apple wants and what genuinely works:

- **Start** a Live Activity when there's an active Rook context: a live conversation, a running agent job, an entered location/event. End it cleanly when idle (`end(using:dismissalPolicy:)`).
- **Drive content from the server** via APNs: priority-5 for routine status (always set `staleDate` so a quiet agent doesn't show stale info), reserve priority-10 + frequent-updates for time-sensitive moments ("agent needs approval," "job finished").
- **Re-summon via push-to-start** on a new conversation, an inbound agent message, geofence arrival, or calendar event — delivering the "goes everywhere with you" feeling within the 8h-per-activity reality.
- **One primary control + deep-link tap:** a single "Approve / Stop" `LiveActivityIntent` (mirroring Rook's existing ACP permission-relay and `steering_prompt` flows), with the body tap opening the full chat.

**Set expectations in product docs:** the iPhone Rook is a *recurring, context-triggered presence*, not a permanent Dynamic Island resident. Design good empty/dismissed states and fast re-entry rather than fighting the platform for permanence.

---

## Q3 — Persistent cross-device context and "deep triangulation"

**Blunt answer: Feasible — but not by porting Rookery's current ACP-over-WebSocket client model to the phone.** The vision (Rook follows you from computer to pocket to physical world, with a hosted server holding all chats) is sound and matches how every comparable product is built. But it forces concrete changes to Rookery's current design.

### The one hard fact that forces the redesign

**iOS does not permit long-lived background WebSockets.** A foregrounded app's socket is fine — Apple DTS: *"the key factor here is not foreground/background but running/suspended. If your app is running, the system won't nix its network connections"* ([forum 716118](https://developer.apple.com/forums/thread/716118)). But on backgrounding you get **~30 seconds** (`UIApplication.beginBackgroundTask`, used only to close cleanly), then the app is **suspended and does zero networking**. There is no App-Store-legal way to keep an always-on socket in your pocket. (`WebSocket tasks are not supported in background `URLSession`s either.)

So the phone's socket is **foreground-only**, and "agent can reach me in my pocket" must come from **push**, not a socket.

### The available signal & background-execution stack

| Mechanism | Role | Reliability | Review risk |
| --- | --- | --- | --- |
| **Foreground ACP WebSocket** (`GET /api/ws`, same as Mac/browser) | Live streaming, prompts, permission relay — *only while app is open* | Reliable while foregrounded; **treat every background transition as a disconnect** | **Low** |
| **APNs alert push** (`apns-push-type: alert`, `priority: 10`) | **The primary "agent initiates" channel.** Visible push; user taps → app foregrounds → reconnects → `session/load` restores the stream | Reliable & on-demand. The push is a *doorbell, not a tunnel* — the **app**, not the push, reconnects | **Low** (Guideline 4.5.4: push must not be required for core function, no marketing/sensitive payload) |
| **Notification Actions** (`UNNotificationCategory` + `UNTextInputNotificationAction`) | **Reply / approve from the lock screen** without opening the app — directly serves agent-initiated + permission-relay (cf. Claude Code [issue #29438](https://github.com/anthropics/claude-code/issues/29438)) | Background handler runs ~30s; must call `completionHandler()` promptly | **Low** |
| **Silent / content-available push** (`priority: 5`) | *Opportunistic* wake to reconnect & prefetch | **Best-effort, never guaranteed** — throttled ~2–3/hour (often zero), suppressed in Low Power Mode, withheld if app not launched recently. **Cannot be the delivery path for agent messages.** | **Medium** |
| **BGAppRefreshTask / BGProcessingTask** | Scheduled reconnect/sync | System-scheduled, unpredictable, short windows | **Low** |
| **BGContinuedProcessingTask (iOS 26)** | User-started long agent job keeps running with a system progress UI | Must be user-initiated, report progress, cancellable | **Low** |
| **Core Location SLC / region / `CLVisit`** | **Sanctioned background wake** → reconnect → let server decide to push | **Region monitoring** is the dependable relaunch path; **significant-change is *not* guaranteed** to relaunch after force-quit; both need **Always** auth; iOS 18 added foreground-only session requirements (`CLServiceSession`/`CLBackgroundActivitySession`) | **Medium** (Guideline 2.5.4 — needs genuine user-facing location feature) |
| **Sign in with Apple + per-device tokens** | Cross-device identity replacing localhost trust | — | **Low** (4.8: required if any social login offered) |
| **PushToTalk / VoIP-PushKit for always-on voice** | — | **Blocked.** PTT entitlement is restricted to genuine walkie-talkie apps; VoIP pushes that don't immediately post a CallKit call get the **app killed and the token revoked**. | **Blocked** |

### Corrections to the research (Q3)

- **"Core Location is the strongest pillar … bg under When-In-Use"** — the research **conflated two mechanisms**. Terminated-app relaunch via SLC/region/`CLVisit` **requires Always authorization**; When-In-Use will *not* relaunch a terminated app. `CLBackgroundActivitySession` (iOS 17+) only keeps an *already-running* app alive (with a visible blue indicator) and does **not** relaunch a dead app. And iOS 18 made Always *only effective while you hold a session you can only start in the foreground*. So passive relaunch is an **Always-only, region-monitoring-most-reliable** capability — not a free "When-In-Use background feed."

- **"Context-feeder: phone pushes signal events to server"** — the *transport* (HTTPS POST) is trivially fine; the **signal source is the real constraint.** The only cross-app usage signal is Screen Time (opaque tokens, gated entitlement, can't exfiltrate identities). First-party signals the phone *can* legitimately push (its own foreground/launch, location-if-justified, calendar-if-authorized, shared content, voice) are fine. Background delivery is **opportunistic, not a guaranteed live feed.** Treat it as "opportunistic, sandbox-limited, entitlement-gated event push," not "phone observes other apps and streams context."

- **CLVisit** is real but **coarse and latency-prone** — don't treat it as a precise real-time feed.

### The required architecture change for Rookery

The push-driven thin-client model (ChatGPT / Claude / **OpenClaw**, a near-exact open-source exemplar) is the right target. Adopting it **reverses two current Rookery decisions** and adds two systems:

1. **Server must own the durable transcript store again.** AS-BUILT **§10** says *"Rookery is not the primary durable transcript store"* and relies on ACP `session/load` from a *local* runtime. That breaks for mobile: the runtime can't live on a suspendable phone, and a phone backgrounded for hours must `session/load` full history from the server.

2. **Replace SessionRoom idle-shutdown with server-side session persistence.** AS-BUILT **§5.2**: *"when the last client disconnects, the room waits for a short idle timeout and then stops the runtime."* When the *only* client is a suspendable phone, the agent must keep running / stay resumable while no client is connected — a persisted-session + warm/cold runtime policy.

3. **Add an APNs push service + device-token registry** (per-account, handling token rotation), so the server can reach the phone when it's backgrounded.

4. **Move from localhost trust (`127.0.0.1:3000`) to real cross-device identity/auth** — Sign in with Apple + per-device session tokens, TLS-fronted server, authenticated WebSocket upgrade, per-session authorization.

**What does *not* change: ACP stays the wire protocol on both boundaries.** The Mac and browser keep their richer foreground capabilities; the phone is a peer of the same server-side session. What changes is **lifecycle + persistence**, not the protocol.

**Sync model:** custom **server-authoritative delta sync** (not CloudKit as the backbone — CloudKit can't host the agent runtime and isn't reachable by a non-Apple server). Queue outbound user messages locally when offline; reconcile on reconnect. CloudKit/`CKSyncEngine`/SwiftData only optionally as a local device cache.

---

## What Rook becomes on iPhone — recommended phased approach

The iPhone Rook is **the inverse of the macOS Rook**: drop omniscient observation, lean into pocket-presence and physical-world awareness.

**Drop entirely (treat as impossible, not deferred):**
- Foreground-app monitoring / `NSWorkspace` model.
- Cross-app Accessibility reading, ambient screenshot+OCR of other apps, AppleScript/CGEvent control.
- Always-on voice presence via PushToTalk/VoIP (blocked + app-kill risk; phone voice is foreground-only / best-effort).
- A permanent Dynamic Island resident.

**Play to the phone's real strengths:**
- **Pocket presence** via push (alert push + notification actions for approvals/replies) and a session-scoped Live Activity.
- **Physical-world awareness** (Core Location region monitoring + `CLVisit`, Core Motion, EventKit calendar, NFC/beacons) — *this becomes the iPhone differentiator* for the "goes everywhere / aware of where you are" vision.
- **User-routed context** via the Share Sheet, App Intents, voice, and Shortcuts automations — the user pushes content *into* Rook instead of Rook reaching out.
- **Focus mode** as a coarse Work/Personal/Sleep adapter.

**Phasing:**

- **Phase 1 — Foreground parity.** iOS client over the *existing* ACP WebSocket against a TLS-fronted hosted server. Proves parity with the web client. *(Low risk, no new server work beyond TLS/auth surface.)*
- **Phase 2 — Agent-initiated reachability.** APNs **alert** push + notification actions (approve/deny, quick reply) for agent-initiated messages and permission relay. Directly answers Claude Code issue #29438.
- **Phase 3 — Durable server + identity.** Reverse AS-BUILT §10 (server owns durable transcripts) and §5.2 (persisted/warm sessions instead of idle-shutdown); add Sign in with Apple + per-device tokens. This is the heavy lift and the unlock for true cross-device continuity.
- **Phase 4 — Presence + physical context.** Session-scoped Live Activity with server push + push-to-start; Core Location region-monitoring-triggered presence; best-effort silent-push reconnect. *(Defer until 1–3 prove out; highest review scrutiny.)*

---

## Risks & App Store review

| What gets rejected / blocked | Why | How comparable apps handle it |
| --- | --- | --- |
| Inferring frontmost / installed apps (`sysctl`, `canOpenURL:` probing, private APIs) | Sandbox violation; explicitly forbidden | They don't — they use Shortcuts automations or skip it |
| Family Controls for general "context awareness" | Entitlement reserved for parental-control/wellbeing; opaque tokens; can't exfiltrate | one sec, Opal use it *as their core wellbeing purpose* |
| Always-on Live Activity with no active task | HIG requires a bounded task; spam/churn risk | Uber/sports/flights tie it to a real ongoing event |
| Background location with no user-facing feature | Guideline 2.5.4 (the "employee tracking" pattern) | Day One, Reflectd ship a *visible* location feature |
| VoIP/PushKit or PTT to fake always-on voice | App killed, token revoked; PTT entitlement restricted | Only genuine walkie-talkie apps (Zello) use PTT |
| NetworkExtension DNS proxy on consumer devices | MDM/supervised-only | Enterprise/MDM products only |
| Push as required-for-function or marketing payload | Guideline 4.5.4 | Transactional "approval needed" pushes are the *intended* use |

**Net:** the *low-risk, proven precedent* is a server-backed agent + session-scoped Live Activity + location-aware context + voice in/out + cross-device sync via your own server (the [vp0.com AI-agent Live Activity](https://vp0.com/blogs/ios-dynamic-island-live-activities-ai-agent) pattern is an almost-exact precedent). The *novel/risky-to-blocked* set is exactly the macOS-style cross-app observation — which we are dropping.

---

## Open questions for the owner

1. **Is the iPhone Rook a context feeder + pocket terminal, or does it need to *replace* the Mac's observation?** If the latter, the answer is "it can't" — the product framing has to shift to physical-world awareness. Confirm we're aligned on that pivot.
2. **Are we willing to take on the server redesign in Phase 3** (durable transcript store + warm/resumable sessions + cross-device auth)? This reverses two current AS-BUILT decisions and is the real cost of mobile, independent of any UI work.
3. **How important is the "knows what app/site you're in" capability to Rook's value prop?** On iPhone it shrinks to "apps the user manually wired via Shortcuts." If that capability is load-bearing, the phone story is materially weaker than the Mac story and we should say so.
4. **What's the acceptable presence model** — are we comfortable telling users "Rook appears during active sessions and re-appears on context," vs. a (impossible) permanent island fixture?
5. **Do we want a future enterprise/MDM edition?** That's the only path to DNS-level/system-wide visibility — never consumer App Store.
6. **Voice scope:** is foreground-only / best-effort voice acceptable, or is always-listening a hard requirement? (If the latter, that's blocked.)

---

## Adversarial findings summary

| Claim checked | Verdict | Correction (if any) |
| --- | --- | --- |
| No `NSWorkspace` equivalent; can't read frontmost app | **Confirmed** | "No entitlement unlocks it" → precise: no entitlement unlocks *frontmost identity*; Family Controls gives only opaque consented usage monitoring |
| FamilyControls picker returns opaque, non-reversible tokens | **Confirmed** | Ships in real apps; friction is the gated distribution entitlement, not principle |
| DeviceActivityMonitor gives near-real-time "app in use" | **Needs nuance** | It's a *cumulative threshold*, not a launch event; documented as imprecise/buggy; entitlement likely *denied* for a foreground-monitor use case |
| Drop the foreground-monitor model entirely | **Needs nuance** | Correct directive; nuance only that a narrow opaque Screen-Time path exists and must not be conflated with frontmost detection |
| Shortcuts as the primary app-context bridge via App Intents | **Needs nuance** | The *signal* is the user's personal automation, not App Intents; App Intents only supply the *action*; manual per-app setup is the real limit |
| Live Activity = Dynamic Island presence, no special entitlement | **Needs nuance** | `relevanceScore` is *not* 0–100; `request()` is foreground-only; not a permanent menu-bar analogue |
| Server updates Live Activity over APNs (`pushTokenUpdates`) | **Confirmed** | Token-based .p8 auth is *mandatory*; tokens rotate (handle ongoing) |
| Push-to-start re-summons presence remotely (iOS 17.2+) | **Needs nuance** | Real; but `NSSupportsLiveActivities` is an Info.plist key not an entitlement; persistence is best-effort, not guaranteed |
| Frame presence as session/task-scoped | **Confirmed** | This is exactly Apple's prescribed lifecycle; the compliant pattern |
| Drive content via APNs priority-5/10 + frequent-updates | **Needs nuance** | Frequent-updates is an Info.plist key (not entitlement); priority-10 still throttled (budget recovery up to 24h); not for permanent presence |
| Core Location SLC/region/CLVisit as the "strongest pillar" | **Needs nuance** | Terminated relaunch is **Always-only**, region-monitoring-most-reliable; SLC not guaranteed after force-quit; "bg under When-In-Use" conflation is wrong |
| Context-feeder: phone pushes events to server | **Needs nuance** | Transport is fine; the *signal source* is the constraint; background delivery is opportunistic, not a live feed |
| Foreground ACP WebSocket, foreground-only | **Confirmed** | Conservative and correct; reaching the pocket needs APNs, not the socket |
| APNs alert push as the primary "agent initiates" channel | **Confirmed** | The *app* (not the push) reconnects; honor Guideline 4.5.4 |
| Notification actions for reply/approve from lock screen | **Confirmed** | Actions need no entitlement; remote delivery needs Push Notifications capability |

---

## Sources

**Sandbox / foreground-app prohibition**
- https://developer.apple.com/forums/thread/70629 (Apple DTS: "no supported way to do this")
- https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web
- https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication (macOS-only)
- https://developer.apple.com/documentation/uikit/uiapplication/state
- https://developer.apple.com/documentation/security/protecting-user-data-with-app-sandbox

**Screen Time / Family Controls / DeviceActivity**
- https://developer.apple.com/videos/play/wwdc2021/10123/ (Meet the Screen Time API)
- https://developer.apple.com/documentation/familycontrols/requesting-the-family-controls-entitlement
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.family-controls
- https://developer.apple.com/documentation/managedsettings/applicationtoken
- https://developer.apple.com/documentation/deviceactivity/deviceactivitymonitor
- https://developer.apple.com/documentation/deviceactivity/deviceactivityreportextension
- https://github.com/kingstinct/react-native-device-activity
- https://riedel.wtf/state-of-the-screen-time-api-2024/

**Shortcuts / App Intents / Focus**
- https://support.apple.com/guide/shortcuts/intro-to-personal-automation-apd690170742/ios
- https://support.apple.com/guide/shortcuts/setting-triggers-apde31e9638b/ios
- https://matthewcassinelli.com/automations-run-immediately-shortcuts-notifications/
- https://developer.apple.com/documentation/appintents/appshortcutsprovider
- https://developer.apple.com/documentation/appintents/setfocusfilterintent

**ActivityKit / Live Activities / Dynamic Island**
- https://developer.apple.com/design/human-interface-guidelines/live-activities/
- https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
- https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:)
- https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
- https://developer.apple.com/documentation/activitykit/activity/pushtokenupdates-swift.property
- https://developer.apple.com/documentation/activitykit/activity/pushtostarttokenupdates
- https://developer.apple.com/documentation/AppIntents/LiveActivityIntent
- https://developer.apple.com/videos/play/wwdc2023/10185/ , /10184/ , /10194/
- https://developer.apple.com/forums/thread/731715 (priority-10 throttling, 24h budget recovery)
- https://vp0.com/blogs/ios-dynamic-island-live-activities-ai-agent (near-exact precedent)

**Push / notifications / background execution / WebSockets**
- https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- https://developer.apple.com/documentation/usernotifications/untextinputnotificationaction
- https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/foreground
- https://developer.apple.com/forums/thread/716118 (running vs suspended; no background WebSocket sessions)
- https://developer.apple.com/forums/thread/85066 (~30s background task window)
- https://developer.apple.com/documentation/backgroundtasks
- https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask
- https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.push-to-talk (PTT restricted)
- https://github.com/swift-server-community/APNSwift
- https://github.com/anthropics/claude-code/issues/29438 (agent-permission push request)
- https://docs.openclaw.ai/platforms/ios (exemplar architecture)

**Core Location / sensors**
- https://developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoringsignificantlocationchanges()
- https://developer.apple.com/documentation/corelocation/clbackgroundactivitysession-3mzv3
- https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background
- https://developer.apple.com/videos/play/wwdc2024/10212/ (iOS 18 location authorization changes)
- https://developer.apple.com/documentation/technotes/tn3153-adopting-api-changes-for-eventkit (EventKit full vs write-only)

**NetworkExtension (MDM-only)**
- https://developer.apple.com/documentation/networkextension/nednsproxyprovider
- https://developer.apple.com/forums/thread/795564

**App Store review**
- https://developer.apple.com/app-store/review/guidelines/ (2.5.4 background location, 4.5.3/4.5.4 push & Live Activities, 4.8 Sign in with Apple)

**Rookery internal (decisions this port changes)**
- `PRODUCT/AS-BUILT-ARCHITECTURE.md` §5.2 (SessionRoom idle-shutdown), §10 (Rookery not the durable transcript store), §9.2 (WebSocket `GET /api/ws`)
