import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionSummary } from "./agent";
import type { AcpClientEvent } from "./acpClientTypes";
import { fetchAgentDefinitions, fetchAgentSessions, fetchMostRecentSession, RemoteAgent } from "./remoteAgent";

const session: AgentSessionSummary = { id: "s1", agent: "PiAgent", createdAt: "now", restart: {} };

const websocketMock = vi.hoisted(() => {
  class MockWebSocket {
    static OPEN = 1;
    static instances: MockWebSocket[] = [];
    url: string;
    readyState = 0;
    sent: string[] = [];
    private listeners = new Map<string, Array<(event?: any) => void>>();

    constructor(url: string) {
      this.url = url;
      MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, listener: (event?: any) => void) {
      const existing = this.listeners.get(type) ?? [];
      existing.push(listener);
      this.listeners.set(type, existing);
    }

    send(payload: string) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = 3;
      this.emit("close", {});
    }

    emitOpen() {
      this.readyState = MockWebSocket.OPEN;
      this.emit("open", {});
    }

    emitMessage(data: unknown) {
      this.emit("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
    }

    emitError() {
      this.emit("error", {});
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
  }

  return { MockWebSocket };
});

async function waitForCondition(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  assertion();
}

describe("RemoteAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    websocketMock.MockWebSocket.instances.length = 0;
  });

  it("sends user messages over websocket and surfaces acp client events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ wsEndpoint: "/custom-ws", backend: "PiAgent", session, onAcpEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    expect(socket.url).toContain("/custom-ws");
    expect(socket.url).toContain("sessionId=s1");

    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      jsonrpc: "2.0",
      id: "prompt-1",
      method: "session/prompt",
      params: { sessionId: "s1", prompt: [{ type: "text", text: "hello" }] },
    });

    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        _meta: { rookery: { sequence: 1 } },
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
      },
    });
    socket.emitMessage({ jsonrpc: "2.0", id: "prompt-1", result: { stopReason: "end_turn" } });

    await runPromise;
    expect(events).toEqual([
      { type: "acp_user_message", text: "hello" },
      { type: "acp_status_changed", status: "busy", message: "Agent is working" },
      { type: "acp_agent_message_chunk", text: "Hi" },
      { type: "acp_run_completed", stopReason: "end_turn" },
    ]);
  });

  it("starts the selected remote agent and then connects with its returned session", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, agent: "PiAgent", session }));

    const agent = new RemoteAgent({ backend: "PiAgent", startEndpoint: "/start" });
    await expect(agent.start()).resolves.toEqual({ ok: true, agent: "PiAgent", session });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ jsonrpc: "2.0", id: "prompt-1", result: { stopReason: "end_turn" } });
    await runPromise;

    expect(fetchMock).toHaveBeenCalledWith("/start", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "PiAgent" }),
    }));
  });

  it("loads the most recent session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ session }));

    await expect(fetchMostRecentSession()).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledWith("/api/agent/session/recent");
  });

  it("reports start HTTP failures as connection_error events", async () => {
    const events: AcpClientEvent[] = [];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));

    await expect(new RemoteAgent({ onAcpEvent: (event) => events.push(event) }).start()).rejects.toThrow("HTTP 503");

    expect(events).toEqual([{ type: "acp_connection_error", error: "Remote agent start failed with HTTP 503" }]);
  });

  it("loads agent definitions and sessions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ agents: [{ id: "PiAgent", parentId: null }] }))
      .mockResolvedValueOnce(Response.json({ sessions: [session] }));

    await expect(fetchAgentDefinitions()).resolves.toEqual([{ id: "PiAgent", parentId: null }]);
    await expect(fetchAgentSessions("PiAgent")).resolves.toEqual([session]);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/agent/sessions?agent=PiAgent");
  });

  it("reports websocket error messages as connection_error events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ jsonrpc: "2.0", id: "prompt-1", error: { code: -32000, message: "Remote exploded" } });

    await expect(runPromise).rejects.toThrow("Remote exploded");
    expect(events).toContainEqual({ type: "acp_connection_error", error: "Remote exploded" });
  });

  it("reconnects to an existing session without requesting transcript replay", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const agent = new RemoteAgent({ session });

    void agent.connect();
    const firstSocket = websocketMock.MockWebSocket.instances[0]!;
    firstSocket.emitOpen();
    await Promise.resolve();
    firstSocket.close();

    void agent.connect();
    const secondSocket = websocketMock.MockWebSocket.instances[1]!;
    expect(secondSocket.url).toContain("sessionId=s1");
    expect(secondSocket.url).not.toContain("fromSequence=");
  });

  it("reports malformed websocket payloads as connection_error events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    socket.emitMessage("not-json");

    expect(events).toContainEqual(expect.objectContaining({ type: "acp_connection_error" }));
  });

  it("sends cancel and send-now messages over websocket", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const agent = new RemoteAgent({ session });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    await agent.cancel();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "s1" },
    });

    const sendNowPromise = agent.sendSteeringMessage("Please keep this in mind");
    await waitForCondition(() => expect(socket.sent).toHaveLength(2));
    const sendNow = JSON.parse(socket.sent[1]!);
    expect(sendNow).toEqual({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "_rookery/steering_prompt",
      params: { sessionId: "s1", text: "Please keep this in mind" },
    });
    socket.emitMessage({ jsonrpc: "2.0", id: "rpc-1", result: { accepted: true } });
    await sendNowPromise;
  });

  it("treats cancelled runs as clean run completions", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ jsonrpc: "2.0", id: "prompt-1", result: { stopReason: "cancelled" } });

    await runPromise;
    expect(events).toContainEqual({ type: "acp_run_completed", stopReason: "cancelled" });
    expect(events).not.toContainEqual({ type: "acp_run_failed", error: "Run cancelled" });
  });

  it("surfaces non-end-turn stop reasons", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    const runPromise = agent.run("hello");
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    socket.emitMessage({ jsonrpc: "2.0", id: "prompt-1", result: { stopReason: "refusal" } });

    await runPromise;
    expect(events).toContainEqual({ type: "acp_run_completed", stopReason: "refusal" });
  });

  it("extracts tool raw input/output and finalize-block events", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read File",
          kind: "read",
          status: "pending",
          rawInput: { path: "README.md" },
        },
      },
    });
    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
          rawOutput: { content: "# Title" },
        },
      },
    });
    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: { sessionUpdate: "_rookery_assistant_message_completed" } },
    });

    expect(events).toContainEqual({
      type: "acp_tool_call_started",
      toolCallId: "tool-1",
      title: "Read File",
      kind: "read",
      status: "pending",
      rawInput: '{\n  "path": "README.md"\n}',
    });
    expect(events).toContainEqual({
      type: "acp_tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      output: "# Title",
    });
    expect(events).toContainEqual({ type: "acp_finalize_blocks" });
  });

  it("surfaces permission requests and mode/config updates", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const events: AcpClientEvent[] = [];
    const agent = new RemoteAgent({ session, onAcpEvent: (event) => events.push(event) });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    socket.emitMessage({
      jsonrpc: "2.0",
      id: "perm-1",
      method: "session/request_permission",
      params: {
        sessionId: "s1",
        toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      },
    });
    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: { sessionUpdate: "plan", entries: [{ content: "Plan step", priority: "high", status: "pending" }] } },
    });
    socket.emitMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: { sessionUpdate: "usage_update", used: 10, size: 20 } },
    });

    expect(events).toContainEqual({
      type: "acp_permission_request",
      requestId: "perm-1",
      toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
      options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
    });
    expect(events).toContainEqual({ type: "acp_plan_update", entries: [{ content: "Plan step", priority: "high", status: "pending" }] });
    expect(events).toContainEqual({ type: "acp_usage_update", used: 10, size: 20 });
  });

  it("sends mode/config changes and permission responses over websocket", async () => {
    vi.stubGlobal("WebSocket", websocketMock.MockWebSocket);
    const agent = new RemoteAgent({ session });

    void agent.connect();
    const socket = websocketMock.MockWebSocket.instances[0]!;
    socket.emitOpen();
    await Promise.resolve();

    const setModePromise = agent.setMode("code");
    await waitForCondition(() => expect(socket.sent).toHaveLength(1));
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      jsonrpc: "2.0",
      id: "rpc-1",
      method: "session/set_mode",
      params: { sessionId: "s1", modeId: "code" },
    });
    socket.emitMessage({ jsonrpc: "2.0", id: "rpc-1", result: {} });
    await setModePromise;

    const setConfigPromise = agent.setConfigOption("model", "smart");
    await waitForCondition(() => expect(socket.sent).toHaveLength(2));
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      jsonrpc: "2.0",
      id: "rpc-2",
      method: "session/set_config_option",
      params: { sessionId: "s1", configId: "model", value: "smart" },
    });
    socket.emitMessage({ jsonrpc: "2.0", id: "rpc-2", result: { configOptions: [] } });
    await setConfigPromise;

    await agent.respondToPermissionRequest("perm-1", { outcome: "selected", optionId: "allow-once" });
    await waitForCondition(() => expect(socket.sent).toHaveLength(3));
    expect(JSON.parse(socket.sent[2]!)).toEqual({
      jsonrpc: "2.0",
      id: "perm-1",
      result: { outcome: { outcome: "selected", optionId: "allow-once" } },
    });
  });
});
