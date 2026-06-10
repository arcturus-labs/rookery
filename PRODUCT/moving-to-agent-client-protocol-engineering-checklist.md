# Moving to Agent Client Protocol — Engineering Checklist

This is a high-level implementation checklist for the ACP migration.

It is intentionally more concrete for near-term steps and less prescriptive for later steps. As we get further into the migration, we should reevaluate based on what we learn from real traces, replay behavior, and actual agent integrations.

Primary non-UI validation harness during this work:

- `scripts/interact-with-remote-agent.sh`

Use it early and often before validating changes in the browser UI.

---

## Phase 0 — mapping and target definition

### Goals

- define the exact cutover target for the server/client boundary
- identify all current custom protocol concepts that must be mapped or deleted
- decide what replay/storage should persist in the ACP world

### Likely files to inspect/update

- `agent-server-client/src/shared/realtime.ts`
- `agent-server-client/src/shared/agent.ts`
- `agent-server-client/src/server/agents/BaseAgent.ts`
- `agent-server-client/src/server/agents/PiAgent.ts`
- `agent-server-client/src/server/agents/MockAgent.ts`
- `agent-server-client/src/server/realtime/*`
- `agent-server-client/src/server/routes/*`
- `agent-server-client/src/client/remoteAgent.ts`
- `agent-server-client/src/client/components/ChatPanel.tsx`
- `PRODUCT/moving-to-agent-client-protocol.md`

### Outputs

- mapping of current custom events -> ACP methods/notifications
- list of ACP concepts currently missing from product/runtime
- decision on interim replay format

### Validation

- doc review
- compare against real ACP traces from Cursor / sample harnesses

---

## Phase 1 — ACP-shaped boundary on server/client interaction

### Goals

- replace the old custom wire vocabulary with ACP-shaped messages at the boundary
- keep the app functional through one temporary compatibility layer only

### Likely server-side areas

- `agent-server-client/src/server/routes/*`
  - shape request/response behavior around ACP concepts where appropriate
- `agent-server-client/src/server/realtime/*`
  - adjust stream publication/replay format
- `agent-server-client/src/server/agents/*`
  - emit enough information to produce ACP-consistent outbound messages

### Likely shared contract areas

- `agent-server-client/src/shared/realtime.ts`
  - likely becomes obsolete or gets replaced by ACP-oriented types
- possible new shared ACP contract/types file(s)
  - likely under `src/shared/`

### Likely client transport areas

- `agent-server-client/src/client/remoteAgent.ts`
  - change from `session_event` envelope handling to ACP JSON-RPC message handling
  - keep a temporary adapter into the existing reducer if needed

### Validation

- `scripts/interact-with-remote-agent.sh`
- targeted transport tests
- manual trace inspection

### Exit criteria

- boundary traffic is ACP-shaped
- chat still works
- replay/reconnect still work at a basic level
- no permanent dual wire protocol remains

---

## Phase 2 — ACP-native replay and storage

### Goals

- stop persisting old custom `SessionEvent` records
- make replay/resume work from ACP-native stored data

### Likely files/areas

- `agent-server-client/src/server/realtime/RoomEventStream.ts`
- `agent-server-client/src/server/realtime/SessionRoom.ts`
- `agent-server-client/src/server/realtime/SessionRoomManager.ts`
- `agent-server-client/src/server/sessionEvents.ts`
- `agent-server-client/src/server/agents/sessionLog.ts`
- websocket replay logic in server route/bootstrap files

### Questions to answer during implementation

- do we store raw ACP messages, normalized ACP updates, or a narrowed internal ACP log?
- what should be replayed as notifications vs reconstructed as state?
- do prompt completion responses need special persistence treatment?

### Validation

- `scripts/interact-with-remote-agent.sh --replay`
- reconnect tests
- restart-existing tests
- compare fresh session vs replayed session behavior

### Exit criteria

- replay no longer depends on legacy `SessionEvent`
- restart/rejoin flows are stable enough to continue

### Reevaluation note

After this phase, pause and reassess before reshaping the UI reducer. By then we should know more about what an ACP-friendly client state really needs.

---

## Phase 3 — ACP-friendly client state and reducer

### Goals

- remove the temporary ACP -> old reducer adapter
- reshape client state around ACP concepts while preserving good rendering behavior

### Likely files/areas

- `agent-server-client/src/client/components/ChatPanel.tsx`
- `agent-server-client/src/client/types.ts`
- `agent-server-client/src/client/remoteAgent.ts`
- `agent-server-client/src/client/components/*`
- client tests in `src/client/**/*.test.tsx`

### Likely state changes

- move away from old custom event-name-driven reducer actions
- add first-class handling for:
  - prompt completion / stop reasons
  - message chunk grouping
  - tool call state
  - permission request state
  - plan state
  - usage state
  - config/mode state

### Validation

- component/reducer tests
- replay hydration tests
- manual browser testing
- compare reducer behavior with captured ACP traces

### Reevaluation note

Before finalizing the client state shape, reevaluate based on:

- actual ACP traces observed so far
- replay complexity
- permission-flow needs
- whether some ACP details should remain transport-layer concerns instead of UI state

---

## Phase 4 — remove legacy protocol code

### Goals

- delete the old custom protocol types, envelopes, and compatibility logic
- ensure there is only one active protocol model at the boundary

### Likely files/areas

- `agent-server-client/src/shared/realtime.ts`
- `agent-server-client/src/client/remoteAgent.ts`
- server realtime/replay code still referencing `SessionEvent`
- tests built only around old custom event names
- any docs/scripts referencing the old custom wire protocol

### Validation

- full test suite
- `scripts/interact-with-remote-agent.sh`
- manual browser smoke test

### Exit criteria

- no runtime path depends on the legacy wire protocol
- docs reflect ACP as the boundary protocol

---

## Phase 5 — richer ACP-native UI/UX

### Goals

- expose ACP concepts as real product features, not just transport details

### Candidate product areas

- permission prompts
- plans
- usage/cost/context window display
- mode controls
- config option controls
- clearer stop-reason handling

### Important note

When we get here, we should have a dedicated conversation about UI/UX rather than precommitting too much now. By that point we should have learned enough from real ACP traffic and the migrated client state to make better product decisions.

### Validation

- product walkthroughs
- manual interaction tests
- targeted user scenarios

### Reevaluation note

Do not lock the UI plan too early. Reevaluate after the protocol migration is complete and after we see how permission, plan, and config flows actually feel in the product.

---

## Cross-cutting concerns to keep checking

Throughout all phases, keep checking:

- replay correctness
- reconnect behavior
- session restart behavior
- error handling semantics
- MockAgent parity for tests
- PiAgent parity for real usage
- whether the browser client still needs any legacy concepts
- whether docs and debug scripts still describe reality

---

## Practical workflow reminder

For near-term implementation work, prefer this loop:

1. change server/client boundary code
2. validate with `scripts/interact-with-remote-agent.sh`
3. inspect traces
4. add/update tests
5. verify browser behavior

That should keep us from mixing protocol and UI problems too early.
