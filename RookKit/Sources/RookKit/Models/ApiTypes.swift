import Foundation

public struct AgentDefinition: Codable, Equatable, Identifiable {
    public let id: String
    public let parentId: String?

    public init(id: String, parentId: String?) {
        self.id = id
        self.parentId = parentId
    }
}

/// Wraps the raw session record JSON so resume can send the record back to
/// `POST /api/agent/start` verbatim, including fields this app doesn't model.
public struct AgentSessionSummary: Equatable, Identifiable {
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
    }

    public var id: String { raw["id"]?.stringValue ?? "" }
    public var agent: String { raw["agent"]?.stringValue ?? "" }
    public var name: String { raw["name"]?.stringValue ?? "default" }
    public var running: Bool { raw["running"]?.boolValue ?? false }
    public var connectedClients: Int { Int(raw["connectedClients"]?.numberValue ?? 0) }

    public var createdAt: Date? {
        guard let iso = raw["createdAt"]?.stringValue else {
            return nil
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) {
            return date
        }
        return ISO8601DateFormatter().date(from: iso)
    }

    public var createdAtLabel: String {
        guard let date = createdAt else {
            return ""
        }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

public struct SkillPreview: Codable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let files: [String: String]

    public init(id: String, name: String, files: [String: String]) {
        self.id = id
        self.name = name
        self.files = files
    }

    public var sortedFilePaths: [String] {
        files.keys.sorted()
    }
}

public struct EnvironmentOffer: Equatable {
    public let environmentId: String
    public let sourceName: String?
    public let canonicalSourceUrl: String?

    public init(environmentId: String, sourceName: String?, canonicalSourceUrl: String?) {
        self.environmentId = environmentId
        self.sourceName = sourceName
        self.canonicalSourceUrl = canonicalSourceUrl
    }
}
