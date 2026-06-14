# Send message now analysis for Claude and Cursor

Date: 2026-06-14

## Goal
Figure out why queued messages marked **"send now"** are not actually sent immediately for the Claude and Cursor agents.

## Probe setup
I used `scripts/interact-with-remote-agent.sh` in raw ACP mode so the test went through the same Rookery websocket/session path used by the app.

I added a few probe flags to make the test reproducible:
- `--mode <id>`
- `--cancel-after-ms <n>`

Test prompt:

```text
ls the rookery root directory
Write an original poem in the chat inspired by whatever you see (don't save a file)
ls again — if something new appeared, celebrate
If nothing new, write a different poem and ls again. Keep going with fresh poems each time
Stop immediately when I say "stop it" (or any clear stop). No more poems, no more listings.
```

### Claude probe
```bash
./scripts/interact-with-remote-agent.sh \
  --raw-acp \
  --agent PirateClaudeAgent \
  --mode bypassPermissions \
  --steer "stop it" \
  --steer-after-ms 5000 \
  --cancel-after-ms 15000 \
  "$PROMPT"
```

### Cursor probe
```bash
./scripts/interact-with-remote-agent.sh \
  --raw-acp \
  --agent CursorAutoAgent \
  --permission allow-always \
  --steer "stop it" \
  --steer-after-ms 5000 \
  --cancel-after-ms 15000 \
  "$PROMPT"
```

## What happened

### Claude
Observed behavior:
- Claude kept working on the original looping prompt.
- There was **no** `user_message_chunk` for `stop it` before the forced ACP cancel.
- The run only ended after `session/cancel` fired at 15s.
- The steering request came back with:
  - `ACP prompt was cancelled.`

Meaning:
- The "send now" message never reached the active Claude turn.
- It stayed queued until the original turn ended.
- Since the original turn did not end in time, the hard ACP cancel stopped it instead.

### Cursor
Observed behavior:
- Cursor continued looping for several rounds after the 5s "send now" request.
- It produced multiple poem/list cycles first.
- Much later, a `user_message_chunk` for `stop it` finally appeared.
- Then Cursor replied `Stopped. No more poems, no more listings.`
- But the overall run still ended with stop reason `cancelled`, because the forced ACP cancel landed while the queued stop prompt was being applied.
- Steering response error:
  - `ACP prompt was cancelled while applying a send-now message.`

Meaning:
- Cursor also did **not** receive the stop request immediately.
- The message was applied only after the original turn yielded back to Rookery.
- In practice this is queueing, not true send-now.

## Root cause in Rookery
The issue is in the generic ACP fallback path, not specifically in Claude or Cursor transport wiring.

### Relevant code
- `agent-server-client/src/server/agents/BaseAgent.ts:190`
- `agent-server-client/src/server/agents/BaseAgent.ts:276`
- `agent-server-client/src/server/agents/ClaudeAgent.ts:168`
- `agent-server-client/src/server/agents/CursorAgent.ts:28`
- `agent-server-client/src/server/agents/PiAgent.ts:95`

### What BaseAgent does
When a workflow is active, `BaseAgent.sendSteeringMessage()` does **not** send anything to the provider/runtime immediately. It only appends the message to `pendingSteeringMessages`.

Later, `runImpl()` drains that queue **only after** this finishes:

```ts
const initialStopReason = await this.executePromptTurn(userMessage);
```

So the effective behavior is:
1. current prompt runs to a provider-defined completion point
2. only then does Rookery send the queued "send now" prompt as a follow-up prompt

That is not immediate interruption/steering.

## Why Pi works but Claude/Cursor do not
`PiAgent` overrides `sendSteeringMessage()` and actually sends `_rookery/steering_prompt` into the active runtime while a workflow is in progress.

`ClaudeAgent` and `CursorAgent` do **not** override `sendSteeringMessage()`, so they inherit the generic BaseAgent queueing behavior.

So:
- **Pi** = true in-flight steering
- **Claude/Cursor** = deferred follow-up after current turn returns

## Conclusion
The queued message UI says **"send now"**, but for Claude and Cursor it is not really send-now.

It is currently:
- **queue until the active ACP prompt returns**, then
- **send as a new prompt**

That explains the observed behavior:
- Claude ignored the stop request until hard cancel.
- Cursor only acted on the stop after several more loop iterations.

## Implication
If we want real send-now for Claude or Cursor, they need provider/runtime-specific in-flight steering support similar to `PiAgent`, or some provider-specific interrupt/follow-up API that can be invoked during an active turn.

Without that, the current BaseAgent fallback should be thought of as:
- **deferred follow-up**, not
- **send now**.
