/**
 * ACP-shaped client events that the ChatPanel reducer consumes directly.
 * Replaces the old SessionEvent translation layer.
 */
import type { AgentRunStatus } from "../shared/agent.js";
import type { AcpConfigOption, AcpPermissionOption, AcpPermissionToolCall, AcpPlanEntry, AcpSessionMode } from "../shared/acp.js";

export type AcpClientEvent =
  | AcpClientStatusChanged
  | AcpClientUserMessage
  | AcpClientUserMessageChunk
  | AcpClientAgentMessageChunk
  | AcpClientAgentThoughtChunk
  | AcpClientToolCallStarted
  | AcpClientToolCallUpdate
  | AcpClientToolInputDelta
  | AcpClientPermissionRequest
  | AcpClientPlanUpdate
  | AcpClientUsageUpdate
  | AcpClientModesState
  | AcpClientCurrentModeUpdate
  | AcpClientConfigOptionUpdate
  | AcpClientFinalizeBlocks
  | AcpClientRunCompleted
  | AcpClientRunFailed
  | AcpClientConnectionError
  | AcpClientEnvironmentEvent;

export interface AcpClientStatusChanged {
  type: "acp_status_changed";
  status: AgentRunStatus;
  message?: string;
}

export interface AcpClientUserMessage {
  type: "acp_user_message";
  text: string;
  messageId?: string;
}

export interface AcpClientUserMessageChunk {
  type: "acp_user_message_chunk";
  text: string;
  messageId?: string;
}

export interface AcpClientAgentMessageChunk {
  type: "acp_agent_message_chunk";
  text: string;
  messageId?: string;
}

export interface AcpClientAgentThoughtChunk {
  type: "acp_agent_thought_chunk";
  text: string;
  messageId?: string;
}

export interface AcpClientToolCallStarted {
  type: "acp_tool_call_started";
  toolCallId: string;
  title: string;
  kind: string;
  status: string;
  rawInput?: string;
}

export interface AcpClientToolCallUpdate {
  type: "acp_tool_call_update";
  toolCallId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  toolName?: string;
  /** Tool output text (for completed) or error message (for failed). */
  output?: string;
}

export interface AcpClientToolInputDelta {
  type: "acp_tool_input_delta";
  toolCallId: string;
  delta: string;
}

export interface AcpClientPermissionRequest {
  type: "acp_permission_request";
  requestId: string;
  toolCall: AcpPermissionToolCall;
  options: AcpPermissionOption[];
}

export interface AcpClientPlanUpdate {
  type: "acp_plan_update";
  entries: AcpPlanEntry[];
}

export interface AcpClientUsageUpdate {
  type: "acp_usage_update";
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
}

export interface AcpClientModesState {
  type: "acp_modes_state";
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpClientCurrentModeUpdate {
  type: "acp_current_mode_update";
  modeId: string;
}

export interface AcpClientConfigOptionUpdate {
  type: "acp_config_option_update";
  configOptions: AcpConfigOption[];
}

export interface AcpClientFinalizeBlocks {
  type: "acp_finalize_blocks";
}

export interface AcpClientRunCompleted {
  type: "acp_run_completed";
  stopReason: string;
}

export interface AcpClientRunFailed {
  type: "acp_run_failed";
  error: string;
}

export interface AcpClientConnectionError {
  type: "acp_connection_error";
  error: string;
}

export interface AcpClientEnvironmentEvent {
  type: "acp_environment_event";
  kind: string;
  payload?: unknown;
}
