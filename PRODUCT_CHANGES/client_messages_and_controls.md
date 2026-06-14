# Client messages and controls

## Status
Implemented in `agent-server-client`.

### As built
- pressing **Enter** always submits
- if the agent is already working, the message is **queued automatically**
- the compose control shows **Stop** instead of **Queue** while work is in flight
- each queued message can be **edited**, **sent now**, or **deleted**
- **Stop** maps to ACP `session/cancel`, so the current turn ends cleanly and the session stays alive
- **Send now** uses a separate websocket/runtime path (`_rookery/steering_prompt` → `SessionRoom.sendSteeringMessage` → runtime-specific handling)
- `PiAgent` now routes that through a `pi-acp` ACP extension and pi `streamingBehavior: "steer"`, so the steering message is actually heard during the active run
- other ACP-backed runtimes still use the generic fallback of applying the steering prompt at the **next safe point inside the active workflow** before ordinary queued next-turn messages resume draining

## Summary
Update `agent-server-client` so message handling matches the Cursor affordances the user called out:

- pressing **Enter** always submits
- if the agent is already working, the message is **queued automatically**
- the compose control shows **Stop** instead of **Queue** while work is in flight
- each queued message can be **edited**, **sent now**, or **deleted**
- **Send now** must behave like a **pi.dev steering message**: it should enter the active workflow without interrupting the current run
- provider-specific behavior must stay encapsulated inside `BaseAgent` subclasses

## Non-goals
Do **not** change:

- mode choice
- agent choice
- usage display
- attachments
- mic / voice affordances
- unrelated chat rendering

## Current state
### Client
`agent-server-client/src/client/components/ChatPanel.tsx`
- already has a **client-side queued message list**
- currently only supports **append-to-queue** and automatic dequeue after `run_completed`
- does **not** support edit / send-now / delete

`agent-server-client/src/client/components/ComposeBox.tsx`
- shows **Send** when idle
- shows **Queue** when busy
- has no **Stop** affordance

### Server/runtime
`agent-server-client/src/server/realtime/SessionRoom.ts`
- serializes prompts through a room queue
- already exposes `cancel()`

`agent-server-client/src/server/agents/BaseAgent.ts`
- already supports ACP `session/cancel`
- currently treats normal user messages as turn-based `session/prompt` calls
- has no first-class abstraction for **live steering / send-now** behavior

### Important architectural constraint
We should not leak provider quirks into the client or room layer. The room should ask for a semantic operation like:
- queue next turn
- cancel active turn
- inject steering / send-now message

…and each concrete agent should decide how to implement that.

## Proposed approach
## 1. Introduce an explicit message-control model
Define three user intents in the app architecture:

1. **Submit next-turn message**
   - default Enter behavior
   - if idle: start immediately
   - if busy: append to queue
2. **Stop active turn**
   - cancel current execution without tearing down the session
3. **Send-now steering message**
   - deliver a message into the active workflow without interrupting current work
   - if the active agent cannot truly steer in-place, the fallback behavior should be owned by that subclass, not by the client

This separates UI intent from provider mechanics.

## 2. Keep queue state richer than plain strings
Upgrade queued-message state to include at least:
- stable id
- text
- createdAt / order
- local edit state
- maybe `kind: "queued" | "editing"`

This supports Cursor-like controls cleanly and avoids encoding behavior in ad hoc UI state.

## 3. Add a subclass hook for live steering
Add a new runtime-level operation on `BaseAgent`, something conceptually like:
- `sendSteeringMessage(text)`
- or `injectLiveUserMessage(text)`

Expected behavior:
- `BaseAgent` provides the abstract semantic contract
- subclasses implement provider-specific delivery
- if a provider has no true mid-run steering primitive, that subclass chooses the closest safe approximation

The client and `SessionRoom` should not know whether Pi, Cursor, Claude, or generic ACP did something special.

## Work outline
## A. Research and design
1. Inspect how each agent currently behaves during active runs:
   - `PiAgent`
   - `CursorAgent`
   - `ClaudeAgent`
   - plain `BaseAgent` ACP bridge
2. Determine whether each provider supports any of:
   - same-session steering / follow-up during an active turn
   - append-to-conversation while current work continues
   - cancellation-only fallback
3. Define the subclass contract for:
   - `cancelActiveTurn()`
   - `sendSteeringMessage()`
   - default queue behavior when steering is unsupported

### Deliverable
A short internal matrix documenting, per agent type:
- true live steering supported? yes/no
- transport used
- fallback behavior
- user-visible semantics

## B. Server/runtime changes
1. Add room-level support for the new semantic action:
   - `SessionRoom.sendSteeringMessage(text)` or equivalent
2. Add matching agent-level hook on `BaseAgent`
3. Keep current queued-turn serialization for normal prompts
4. Ensure steering messages do **not** accidentally enter the normal next-turn queue unless that is the subclass-owned fallback
5. Preserve existing `cancel()` behavior for Stop

### Notes
- `run()` remains the abstraction for normal turns
- steering should be a separate path from `run()`
- session eventing may need a new event kind if we want the UI to distinguish a steering injection from a normal queued turn

## C. Client UI changes
### Compose box
Update `agent-server-client/src/client/components/ComposeBox.tsx` so that:
- **Enter** always submits
- while idle, primary action is **Send**
- while busy, primary action becomes **Stop**
- typed text remains submittable via Enter even while busy; that submission queues automatically

This likely means the button and the submit behavior can no longer be the same single action.

### Queued message list
Update `agent-server-client/src/client/components/ChatPanel.tsx` so each queued message has:
- **Edit**
- **Send now**
- **Delete**

Likely UX:
- **Edit**: inline edit or move text back into a local editable state
- **Send now**: call the new steering pathway
- **Delete**: remove from queue

### Queue semantics
- normal queued items remain FIFO
- `Send now` does **not** just move the message to the front of the queued next-turn list; it uses the live-steering path
- after a successful `Send now`, remove that item from the queued list
- if steering fails, decide whether to restore the item to the queue or surface retry UI

## D. Event/state handling
Add client state transitions for:
- stop requested
- steering message requested
- queued message editing
- send-now success/failure

Potentially useful additions:
- temporary “Sending now…” UI state for a queued item
- explicit handling so stop/cancel failures do not duplicate error blocks

## E. Tests
### Client tests
Update/add tests around:
- Enter while busy queues message automatically
- busy compose button shows **Stop**, not **Queue**
- queued message can be edited
- queued message can be deleted
- queued message **Send now** uses the steering API, not normal queue replay
- queued FIFO still works for ordinary queued items

### Server/runtime tests
Add tests for:
- `SessionRoom` steering delegation
- provider fallback isolation inside subclasses
- cancel keeps session alive for subsequent prompts
- failed steering does not corrupt queue order

## F. Documentation updates after implementation
When implementation is done, update:
- `agent-server-client/README.md`
- root `README.md` if workflow semantics become important there
- relevant PRODUCT docs if this changes the intended interaction model for live agent steering
- `PRODUCT_CHANGES/docs/AS-BUILT-ARCHITECTURE.md` if queue/cancel behavior changes materially

## Suggested implementation order
1. Research agent-specific steering/cancel capabilities
2. Define the `BaseAgent` semantic hook(s)
3. Implement room/server plumbing
4. Implement client queue-item controls
5. Replace busy-state **Queue** button with **Stop**
6. Add/update tests
7. Update docs

## Acceptance criteria
- Pressing Enter always submits the current text
- If the agent is idle, the message starts immediately
- If the agent is busy, the message is added to the queued list automatically
- The compose box shows **Stop** while the agent is running
- Stop cancels the active execution without destroying the session
- Each queued message can be edited, sent now, or deleted
- Send-now behavior is provider-specific but exposed through one uniform app-level semantic API
- Provider-specific details remain contained within agent subclasses

## Main risk
The biggest risk is assuming all providers can support Cursor-like live steering the same way. They probably cannot. The design should therefore standardize the **intent** at the room/client boundary while allowing each subclass to own the exact implementation and fallback behavior.