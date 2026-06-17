import Foundation

public enum ToolBlockStatus: Equatable {
    case pending
    case inputStreaming
    case ready
    case running
    case completed
    case failed
    case cancelled

    public var label: String {
        switch self {
        case .pending: return "Pending"
        case .inputStreaming: return "Preparing"
        case .ready: return "Ready"
        case .running: return "Running"
        case .completed: return "Done"
        case .failed: return "Failed"
        case .cancelled: return "Cancelled"
        }
    }

    public var isTerminal: Bool {
        switch self {
        case .completed, .failed, .cancelled:
            return true
        default:
            return false
        }
    }
}

public struct ToolBlockState: Equatable {
    public var toolCallId: String
    public var title: String
    public var kindLabel: String
    public var status: ToolBlockStatus
    public var arguments: String
    public var output: String

    public init(toolCallId: String, title: String, kindLabel: String, status: ToolBlockStatus, arguments: String, output: String) {
        self.toolCallId = toolCallId
        self.title = title
        self.kindLabel = kindLabel
        self.status = status
        self.arguments = arguments
        self.output = output
    }
}

public struct PlanEntry: Equatable, Identifiable {
    public let id: Int
    public var content: String
    public var priority: String
    public var status: String

    public init(id: Int, content: String, priority: String, status: String) {
        self.id = id
        self.content = content
        self.priority = priority
        self.status = status
    }
}

public enum ChatBlockKind: Equatable {
    case user(text: String)
    case assistantText(text: String, streaming: Bool)
    case thinking(text: String, streaming: Bool)
    case tool(ToolBlockState)
    case error(source: String, message: String)
    case system(text: String)
    case plan(entries: [PlanEntry])
}

public struct ChatBlock: Equatable, Identifiable {
    public let id: String
    public var kind: ChatBlockKind

    public init(id: String, kind: ChatBlockKind) {
        self.id = id
        self.kind = kind
    }
}

/// Flat client-side event union parsed off the ACP websocket — the Swift
/// counterpart of the React client's `AcpClientEvent`.
public enum AcpClientEvent {
    case agentMessageChunk(text: String)
    case agentThoughtChunk(text: String)
    case toolCallStarted(toolCallId: String, title: String, kind: String, status: String, rawInput: String?)
    case toolCallUpdate(toolCallId: String, status: String, toolName: String?, output: String?)
    case toolInputDelta(toolCallId: String, toolName: String?, delta: String)
    case toolCallReady(toolCallId: String, toolName: String?)
    case toolOutputDelta(toolCallId: String, toolName: String?, delta: String)
    case planUpdate(entries: [PlanEntry])
    case usageUpdate(used: Int, size: Int)
    case runCompleted(stopReason: String)
    case runFailed(message: String)
    case protocolError(message: String)
    case connectionError(message: String)
    case environmentOffered(EnvironmentOffer)
    case environmentOfferResolved(environmentId: String)
    case environmentEntered(environmentId: String)
    case environmentExited(environmentId: String, error: String?)
}
