import ApplicationServices
import Foundation

/// Tier 1 perception: reading another app's focused-window title needs the
/// Accessibility (AX) permission. App *identity* (NSWorkspace) does not — only
/// reading inside another process does.
enum AXReader {
    static func isTrusted(promptIfNeeded: Bool = false) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [key: promptIfNeeded] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Title of the focused (or main) window of the app owning `pid`, or nil if
    /// AX isn't trusted / the app exposes no titled window.
    static func focusedWindowTitle(pid: pid_t) -> String? {
        guard isTrusted() else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(pid)
        var windowRef: AnyObject?
        if AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowRef) != .success {
            if AXUIElementCopyAttributeValue(appElement, kAXMainWindowAttribute as CFString, &windowRef) != .success {
                return nil
            }
        }
        guard let windowRef else {
            return nil
        }
        let window = windowRef as! AXUIElement
        var titleRef: AnyObject?
        guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &titleRef) == .success else {
            return nil
        }
        let title = titleRef as? String
        return (title?.isEmpty == false) ? title : nil
    }
}
