import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpClientEvent } from "../acpClientTypes";
import { ChatPanel } from "./ChatPanel";

const remoteAgentMock = vi.hoisted(() => {
  const defaultRunImplementation = async (message: string) => {
    remoteAgentMock.lastOnAcpEvent?.({ type: "acp_user_message", text: message });
    remoteAgentMock.lastOnAcpEvent?.({ type: "acp_status_changed", status: "streaming", message: "Writing" });
    remoteAgentMock.lastOnAcpEvent?.({ type: "acp_agent_message_chunk", text: "Echo: " });
    remoteAgentMock.lastOnAcpEvent?.({ type: "acp_agent_message_chunk", text: message });
    remoteAgentMock.lastOnAcpEvent?.({ type: "acp_run_completed", stopReason: "end_turn" });
  };

  return {
    lastOnAcpEvent: null as ((event: AcpClientEvent) => void) | null,
    defaultRunImplementation,
    runMock: vi.fn(defaultRunImplementation),
    respondToPermissionRequestMock: vi.fn(async () => undefined),
    cancelMock: vi.fn(async () => undefined),
    sendSteeringMessageMock: vi.fn(async () => undefined),
    setModeMock: vi.fn(async () => undefined),
    setConfigOptionMock: vi.fn(async () => undefined),
  };
});

vi.mock("../remoteAgent", () => ({
  RemoteAgent: class {
    constructor(options?: { onAcpEvent?: (event: AcpClientEvent) => void }) {
      remoteAgentMock.lastOnAcpEvent = options?.onAcpEvent ?? null;
    }

    connect = vi.fn(async () => undefined);
    close = vi.fn();
    run = remoteAgentMock.runMock;
    respondToPermissionRequest = remoteAgentMock.respondToPermissionRequestMock;
    cancel = remoteAgentMock.cancelMock;
    sendSteeringMessage = remoteAgentMock.sendSteeringMessageMock;
    setMode = remoteAgentMock.setModeMock;
    setConfigOption = remoteAgentMock.setConfigOptionMock;
  },
}));

describe("ChatPanel", () => {
  beforeEach(() => {
    remoteAgentMock.lastOnAcpEvent = null;
    remoteAgentMock.runMock.mockReset();
    remoteAgentMock.runMock.mockImplementation(remoteAgentMock.defaultRunImplementation);
    remoteAgentMock.respondToPermissionRequestMock.mockReset();
    remoteAgentMock.cancelMock.mockReset();
    remoteAgentMock.sendSteeringMessageMock.mockReset();
    remoteAgentMock.setModeMock.mockReset();
    remoteAgentMock.setConfigOptionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits a message through RemoteAgent and renders the streamed response", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} />);

    expect(screen.getByText("No messages yet.")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(remoteAgentMock.runMock).toHaveBeenCalledWith("Hello"));
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Echo: Hello")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("does not submit messages while disabled", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} disabled />);

    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Type a message...")).toBeDisabled();
    expect(remoteAgentMock.runMock).not.toHaveBeenCalled();
  });

  it("queues on enter while busy and exposes stop instead of queue", async () => {
    remoteAgentMock.runMock.mockImplementation(async (message: string) => {
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_user_message", text: message });
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_status_changed", status: "busy", message: "Agent is working" });
      await new Promise(() => undefined);
    });
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} />);

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "First{enter}");
    expect(remoteAgentMock.runMock).toHaveBeenCalledWith("First");

    await userEvent.type(screen.getByPlaceholderText("Agent is busy — message will be queued..."), "Second{enter}");
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(remoteAgentMock.cancelMock).toHaveBeenCalledTimes(1);
  });

  it("edits, sends now, and deletes queued messages", async () => {
    remoteAgentMock.runMock.mockImplementation(async (message: string) => {
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_user_message", text: message });
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_status_changed", status: "busy", message: "Agent is working" });
      await new Promise(() => undefined);
    });
    remoteAgentMock.sendSteeringMessageMock.mockResolvedValue(undefined);
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} />);

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "First{enter}");
    await userEvent.type(screen.getByPlaceholderText("Agent is busy — message will be queued..."), "Second{enter}");
    await userEvent.type(screen.getByPlaceholderText("Agent is busy — message will be queued..."), "Third{enter}");

    await userEvent.click(screen.getAllByRole("button", { name: "Edit queued message" })[0]!);
    const editBox = screen.getByLabelText(/Edit queued message queued-/);
    await userEvent.clear(editBox);
    await userEvent.type(editBox, "Second updated");
    await userEvent.click(screen.getByRole("button", { name: "Save queued message" }));
    expect(screen.getByText("Second updated")).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Send queued message now" })[0]!);
    expect(remoteAgentMock.sendSteeringMessageMock).toHaveBeenCalledWith("Second updated");
    await waitFor(() => expect(screen.queryByText("Second updated")).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete queued message" }));
    expect(screen.queryByText("Third")).not.toBeInTheDocument();
  });

  it("relays message_parent tool calls to the parent message target", async () => {
    const postMessage = vi.fn();
    remoteAgentMock.runMock.mockImplementationOnce(async () => {
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_tool_call_started", toolCallId: "tool-1", title: "message_parent", kind: "other", status: "pending", rawInput: "{\"message\":{\"kind\":\"ready\"}}" });
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_tool_call_update", toolCallId: "tool-1", status: "completed", toolName: "message_parent", output: "message sent" });
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_run_completed", stopReason: "end_turn" });
    });

    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        onParentMessage={(message) => postMessage(message, "https://parent.example")}
      />,
    );

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "notify");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith({ kind: "ready" }, "https://parent.example"));
  });

  it("rebuilds prior conversation from replayed session events", () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "acp_user_message", text: "Earlier question" },
          { type: "acp_agent_message_chunk", text: "Earlier answer" },
          { type: "acp_run_completed", stopReason: "end_turn" },
        ]}
      />,
    );

    expect(screen.getByText("Earlier question")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("rebuilds prior tool activity from replayed session events", async () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "acp_tool_call_started", toolCallId: "tool-1", title: "search_docs", kind: "other", status: "pending", rawInput: "{\"q\":\"agent\"}" },
          { type: "acp_tool_call_update", toolCallId: "tool-1", status: "completed", toolName: "search_docs", output: "Found docs" },
          { type: "acp_run_completed", stopReason: "end_turn" },
        ]}
      />,
    );

    expect(screen.getByText("search_docs")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();

    await userEvent.click(screen.getByText("search_docs"));
    expect(screen.getByText('{"q":"agent"}')).toBeInTheDocument();
    expect(screen.getByText("Found docs")).toBeInTheDocument();
  });
  it("ignores replayed environment session events without breaking chat replay", () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "acp_environment_event", kind: "environment_entered", payload: { environmentId: "browser" } },
          { type: "acp_user_message", text: "Earlier question" },
          { type: "acp_agent_message_chunk", text: "Earlier answer" },
          { type: "acp_run_completed", stopReason: "end_turn" },
        ]}
      />,
    );

    expect(screen.getByText("Earlier question")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
  });

  it("notifies when an environment offer is resolved on the session websocket", async () => {
    const onEnvironmentOfferResolved = vi.fn();
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        onEnvironmentOfferResolved={onEnvironmentOfferResolved}
      />,
    );

    await waitFor(() => expect(remoteAgentMock.lastOnAcpEvent).not.toBeNull());

    remoteAgentMock.lastOnAcpEvent?.({
      type: "acp_environment_event",
      kind: "environment_offer_resolved",
      payload: { environmentId: "web:wikipedia", decision: "dismissed" },
    });

    expect(onEnvironmentOfferResolved).toHaveBeenCalledWith({
      environmentId: "web:wikipedia",
      decision: "dismissed",
    });
  });

  it("notifies when an environment offer becomes available on the session websocket", async () => {
    const onEnvironmentOfferAvailable = vi.fn();
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        onEnvironmentOfferAvailable={onEnvironmentOfferAvailable}
      />,
    );

    await waitFor(() => expect(remoteAgentMock.lastOnAcpEvent).not.toBeNull());

    remoteAgentMock.lastOnAcpEvent?.({
      type: "acp_environment_event",
      kind: "environment_offer_available",
      payload: { environmentId: "web:wikipedia" },
    });

    expect(onEnvironmentOfferAvailable).toHaveBeenCalledWith({ environmentId: "web:wikipedia" });
  });

  it("renders run failures as error blocks", async () => {
    remoteAgentMock.runMock.mockImplementationOnce(async (message: string) => {
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_user_message", text: message });
      remoteAgentMock.lastOnAcpEvent?.({ type: "acp_run_failed", error: "Network down" });
    });
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} />);

    await userEvent.type(screen.getByPlaceholderText("Type a message..."), "Hello");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("run error")).toBeInTheDocument();
    expect(screen.getAllByText("Network down")).toHaveLength(2);
  });

  it("renders ACP plan and usage state without stop reason UI", () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "acp_plan_update", entries: [{ content: "Inspect files", priority: "high", status: "in_progress" }] },
          { type: "acp_usage_update", used: 1000, size: 4000, cost: { amount: 0.012, currency: "USD" } },
          { type: "acp_run_completed", stopReason: "max_tokens" },
        ]}
      />,
    );

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Inspect files")).toBeInTheDocument();
    expect(screen.getByText(/1,000 \/ 4,000 tokens/)).toBeInTheDocument();
    expect(screen.queryByText(/Stop:/)).not.toBeInTheDocument();
  });

  it("replays mode/config state into visible controls", () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        showAcpSettings
        replayEvents={[
          { type: "acp_modes_state", currentModeId: "ask", availableModes: [{ id: "ask", name: "Ask" }, { id: "code", name: "Code" }] },
          { type: "acp_config_option_update", configOptions: [{ id: "model", name: "Model", type: "select", currentValue: "fast", options: [{ value: "fast", name: "Fast" }] }] },
        ]}
      />,
    );

    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });

  it("finalizes replayed thinking/message blocks once the restored assistant message is complete", async () => {
    render(
      <ChatPanel
        agentBackend="PiAgent"
        initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }}
        replayEvents={[
          { type: "acp_agent_thought_chunk", text: "Reading the README.\n" },
          { type: "acp_agent_message_chunk", text: "Done." },
          { type: "acp_finalize_blocks" },
        ]}
      />,
    );

    expect(document.querySelectorAll(".cwa-cursor")).toHaveLength(0);
  });

  it("responds to permission requests and renders mode/config controls", async () => {
    render(<ChatPanel agentBackend="PiAgent" initialSession={{ id: "s1", agent: "PiAgent", createdAt: "now", restart: {} }} showAcpSettings />);

    await waitFor(() => expect(remoteAgentMock.lastOnAcpEvent).not.toBeNull());

    await act(async () => {
      remoteAgentMock.lastOnAcpEvent?.({
        type: "acp_modes_state",
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "code", name: "Code" },
        ],
      });
      remoteAgentMock.lastOnAcpEvent?.({
        type: "acp_config_option_update",
        configOptions: [{
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "fast",
          options: [
            { value: "fast", name: "Fast" },
            { value: "smart", name: "Smart" },
          ],
        }],
      });
      remoteAgentMock.lastOnAcpEvent?.({
        type: "acp_permission_request",
        requestId: "perm-1",
        toolCall: { toolCallId: "tool-1", title: "Write file", kind: "edit", status: "pending" },
        options: [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }],
      });
    });

    await userEvent.selectOptions(screen.getByLabelText("Mode"), "code");
    expect(remoteAgentMock.setModeMock).toHaveBeenCalledWith("code");

    await userEvent.selectOptions(screen.getByLabelText("Model"), "smart");
    expect(remoteAgentMock.setConfigOptionMock).toHaveBeenCalledWith("model", "smart");

    await userEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(remoteAgentMock.respondToPermissionRequestMock).toHaveBeenCalledWith("perm-1", { outcome: "selected", optionId: "allow-once" });
  });
});
