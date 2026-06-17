#if os(iOS)
import ActivityKit
import Foundation

/// Shared Live Activity attributes — imported by both the iOS app (which starts
/// and updates the activity) and the widget extension (which renders it in the
/// Dynamic Island and on the Lock Screen). ActivityKit is iOS-only, so this
/// whole file is excluded on macOS.
public struct RookActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var placeName: String?
        public var skillsActive: Bool
        public var agentStatus: String   // "Idle", "Thinking…", "Responding…", "Needs approval", etc.
        public var running: Bool

        public init(placeName: String?, skillsActive: Bool, agentStatus: String, running: Bool) {
            self.placeName = placeName
            self.skillsActive = skillsActive
            self.agentStatus = agentStatus
            self.running = running
        }
    }

    public var agentName: String

    public init(agentName: String) {
        self.agentName = agentName
    }
}
#endif
