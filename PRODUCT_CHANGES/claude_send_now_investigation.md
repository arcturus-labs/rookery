# Claude send-now investigation and repair notes

Date: 2026-06-14
Status: Investigation complete. Cancel+re-prompt approach is implementable with minor client-visible tradeoffs.

## Goal
Make Rookery's **send now** behavior for Claude mean "stop current work and start this new message immediately."

## Approach: stop + new prompt contained in the agent subclass
The idea: `ClaudeAgent.sendSteeringMessage()` cancels the current ACP turn, then immediately queues a new `session/prompt` with the steering text. The client (ChatPanel) is not modified.

## Feasibility analysis

### What the agent subclass would do
```typescript
// ClaudeAgent.ts — proposed override
override async sendSteeringMessage(userMessage: string): Promise<void> {
    await this.ensureStarted();
    const trimmed = userMessage.trim();
    if (!trimmed) return;

    if (!this.hasActiveWorkflow || !this.sessionId) {
      await this.run(trimmed);  // no active turn — just run
      return;
    }

    await this.cancel();                    // send session/cancel, non-blocking
    this.run(trimmed).catch(() => {});      // enqueue new prompt, fire-and-forget
}
```

### How BaseAgent internals serialize this correctly
- `cancel()` sends `session/cancel` notification → adapter interrupts → original prompt resolves with `stopReason: "cancelled"` → `runImpl()` returns → `workflowActive = false`
- `run()` chains on `runQueue`. The current turn (being cancelled) is the active queue item. The new run enqueues after it and executes once the cancelled turn fully resolves.
- No races: `runQueue` serializes everything.

### Client-visible effects
The ChatPanel is NOT modified. The full client-side event sequence becomes:

| Event | Source | ChatPanel effect |
|---|---|---|
| `acp_user_message` | `remoteAgent.sendSteeringMessage` emits it immediately | User message block appears |
| websocket `{ accepted: true }` | Server responds to `_rookery/steering_prompt` | `QUEUED_MESSAGE_SEND_NOW_FINISHED` dispatched |
| `acp_run_completed` stopReason `"cancelled"` | Original prompt resolves after cancel | Status briefly shows **"Stopped"**; `handleRunCompletion` runs; no queued messages to dequeue |
| `acp_status_changed` status `"busy"` | Adapter emits as new prompt starts | Status updates to **"Working"** |
| agent output chunks | New prompt streams | Agent response appears normally |
| `acp_run_completed` | New prompt completes | Status shows **"Ready"** |

### Client-visible tradeoff
- The status bar briefly flashes **"Stopped"** between the cancellation and the new prompt's first status update. This is the only visible artifact of the internal cancel+re-prompt.
- Output streaming is continuous — the user sees the new response appear.
- If no `acp_status_changed` event fires before the new prompt's output, the status may remain "Stopped" until the new prompt completes.

### What stays unchanged
- `agent-profiles.json` — no changes needed
- Underlying CLI — still runs `claude` via the ACP adapter
- ChatPanel / client code — zero modifications

## Comparison with PiAgent
| | PiAgent | Proposed ClaudeAgent |
|---|---|---|
| Mechanism | Custom extension `_rookery/steering_prompt` piped into active pi turn | ACP `session/cancel` + new `session/prompt` |
| Client sees stop? | No | Brief status flicker ("Stopped" → "Working") |
| General steering? | Yes (any message) | Yes (any message) |
| Provider-specific API? | Yes (pi-acp) | No (standard ACP cancel + prompt) |

## Implementation plan
1. Add `sendSteeringMessage()` override in `ClaudeAgent`
2. Detect active workflow → cancel + fire-and-forget `run(trimmed)`
3. No changes to BaseAgent, ChatPanel, or profiles

## Known limitations
- The brief "Stopped" status flicker is inherent — the ACP protocol requires the cancelled turn to resolve before the new turn begins, and the client sees that resolution.
- Error handling: if the new prompt's `run()` fails, the error fires `_rookery_run_failed` which the client displays. If we want more control, we could `await` the new prompt and handle errors explicitly, but that would make `sendSteeringMessage` block until the new prompt completes (changing the websocket response timing).

## Decision
Implementable. The status flicker is the only client-visible compromise. No profile or CLI changes needed.

## Next steps
- [ ] Implement `ClaudeAgent.sendSteeringMessage()` override
- [ ] Test with the looping-poem probe (see `send_message_now_analysis.md`)
- [ ] Verify the status flicker is acceptable in the UI
