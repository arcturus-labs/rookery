# Cursor send-now investigation and repair notes

Date: 2026-06-14
Status: Investigation complete. Cancel+re-prompt approach is implementable (same architecture as Claude).

## Goal
Make Rookery's **send now** behavior for Cursor mean "stop current work and start this new message immediately."

## Approach: stop + new prompt contained in the agent subclass
The idea: `CursorAgent.sendSteeringMessage()` cancels the current ACP turn, then immediately queues a new `session/prompt` with the steering text. The client (ChatPanel) is not modified.

## Feasibility analysis

### What the agent subclass would do
```typescript
// CursorAgent.ts — proposed override
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

The architecture is identical to the ClaudeAgent approach because both inherit from `BaseAgent` and communicate via standard ACP.

### Direct Cursor ACP probe findings
I sent two concurrent `session/prompt` requests directly to Cursor's `agent acp` over stdio (bypassing Rookery):

- The first prompt (`sleep 20; echo first done`) resolved with `stopReason: "cancelled"` when the second prompt (`stop it`) arrived — Cursor ACP appears to cancel the first prompt when a second one is sent concurrently.
- The second prompt then ran in a confusing state (reasoning about the probe itself).
- This makes direct concurrent `session/prompt` look unsafe as a general implementation strategy.

Conclusion: the cancel+re-prompt approach (sequential via `runQueue`) is safer than attempting concurrent prompts against Cursor ACP.

### Client-visible effects
Identical to ClaudeAgent. The full client-side event sequence:

| Event | Source | ChatPanel effect |
|---|---|---|
| `acp_user_message` | `remoteAgent.sendSteeringMessage` emits it immediately | User message block appears |
| websocket `{ accepted: true }` | Server responds to `_rookery/steering_prompt` | `QUEUED_MESSAGE_SEND_NOW_FINISHED` dispatched |
| `acp_run_completed` stopReason `"cancelled"` | Original prompt resolves after cancel | Status briefly shows **"Stopped"** |
| `acp_status_changed` status `"busy"` | Adapter emits as new prompt starts | Status updates to **"Working"** |
| agent output chunks | New prompt streams | Agent response appears normally |
| `acp_run_completed` | New prompt completes | Status shows **"Ready"** |

### What stays unchanged
- `agent-profiles.json` — no changes needed
- Underlying CLI — still runs `agent acp`
- ChatPanel / client code — zero modifications
- Underlying assumption — still `agent` for CursorAgent

## Implementation plan
1. Add `sendSteeringMessage()` override in `CursorAgent`
2. Detect active workflow → cancel + fire-and-forget `run(trimmed)`
3. No changes to BaseAgent, ChatPanel, or profiles

## Known limitations
- Same status flicker as ClaudeAgent (brief "Stopped" before new prompt starts).
- Cursor ACP's behavior with concurrent prompts was observed to be unstable; the sequential cancel+re-prompt via `runQueue` avoids this.
- The `sendSteeringMessage` resolves quickly (after cancel, before new prompt completes) — the new prompt runs asynchronously. This matches PiAgent's timing characteristics (fast resolution).

## Decision
Implementable with the same pattern as ClaudeAgent. No profile or CLI changes needed.

## Next steps
- [ ] Implement `CursorAgent.sendSteeringMessage()` override
- [ ] Test with the looping-poem probe (see `send_message_now_analysis.md`)
- [ ] Verify Cursor ACP handles cancel+new-prompt without confusion
