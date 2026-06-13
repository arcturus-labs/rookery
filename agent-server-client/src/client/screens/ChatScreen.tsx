import type { AgentBackend, AgentSessionSummary } from "../agent";
import type { EnvironmentOfferAvailablePayload, EnvironmentOfferResolvedPayload } from "../../shared/environment";
import type { ParentMessagePoster } from "../parentMessageTool";
import { ChatPanel } from "../components/ChatPanel";

export interface ChatScreenProps {
  agentId: AgentBackend;
  session: AgentSessionSummary;
  showAcpSettings?: boolean;
  onParentMessage?: ParentMessagePoster | null;
  onEnvironmentOfferAvailable?: (payload: EnvironmentOfferAvailablePayload) => void;
  onEnvironmentOfferResolved?: (payload: EnvironmentOfferResolvedPayload) => void;
}

export function ChatScreen({
  agentId,
  session,
  showAcpSettings = false,
  onParentMessage,
  onEnvironmentOfferAvailable,
  onEnvironmentOfferResolved,
}: ChatScreenProps) {
  return (
    <ChatPanel
      agentBackend={agentId}
      initialSession={session}
      showAcpSettings={showAcpSettings}
      onParentMessage={onParentMessage}
      onEnvironmentOfferAvailable={onEnvironmentOfferAvailable}
      onEnvironmentOfferResolved={onEnvironmentOfferResolved}
    />
  );
}
