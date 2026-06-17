import SwiftUI
#if canImport(AppKit)
import AppKit
#endif

/// Design tokens lifted from the web client (`clients/web-client/`) to keep
/// the native and web UIs visually consistent. Shared by the macOS menu-bar app
/// and the iOS app.
public enum PanelPalette {
    public static let accent = Color(red: 0.486, green: 0.227, blue: 0.929)        // #7c3aed
    public static let accentHover = Color(red: 0.545, green: 0.361, blue: 0.965)   // #8b5cf6
    public static let backgroundPrimary = Color(red: 0.098, green: 0.078, blue: 0.122)   // #19141f
    public static let backgroundSecondary = Color(red: 0.137, green: 0.110, blue: 0.176) // #231c2d
    public static let border = Color(red: 0.239, green: 0.192, blue: 0.302)        // #3d314d
    public static let hover = Color(red: 0.184, green: 0.149, blue: 0.231)         // #2f263b
    public static let textNormal = Color(red: 0.929, green: 0.914, blue: 0.961)    // #ede9f5
    public static let textMuted = Color(red: 0.710, green: 0.663, blue: 0.788)     // #b5a9c9

    public static let success = Color(red: 0.624, green: 0.941, blue: 0.706)       // #9ff0b4
    public static let warning = Color(red: 0.973, green: 0.831, blue: 0.467)       // #f8d477
    public static let danger = Color(red: 1.0, green: 0.612, blue: 0.639)          // #ff9ca3
    public static let info = accent
    public static let secondaryText = textMuted

    /// `color-mix(in srgb, accent 35%, background-primary)` — thinking bubble.
    public static let thinkingFill = Color(red: 0.234, green: 0.131, blue: 0.404)
}

/// The web client's body background: a 135° plum gradient with a violet
/// radial glow in the top-left corner.
public struct PanelBackground: View {
    public init() {}

    public var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.063, green: 0.051, blue: 0.086),  // #100d16
                    PanelPalette.backgroundPrimary,                 // #19141f
                    Color(red: 0.141, green: 0.106, blue: 0.196),  // #241b32
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [PanelPalette.accent.opacity(0.28), .clear],
                center: .topLeading,
                startRadius: 0,
                endRadius: 430
            )
        }
    }
}

public struct PanelCard<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            content
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(PanelPalette.backgroundSecondary.opacity(0.88))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.white.opacity(0.12))
        )
    }
}

public struct StatusGlyph: View {
    public var systemImage: String
    public var tint: Color
    public var size: CGFloat

    public init(systemImage: String, tint: Color, size: CGFloat = 38) {
        self.systemImage = systemImage
        self.tint = tint
        self.size = size
    }

    public var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: size * 0.52, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                Circle()
                    .fill(tint.gradient)
            )
    }
}

public struct StatusDot: View {
    public var tint: Color

    public init(tint: Color) {
        self.tint = tint
    }

    public var body: some View {
        Circle()
            .fill(tint)
            .frame(width: 7, height: 7)
    }
}

public enum CompactButtonProminence {
    case filled
    case subtle
}

public struct CompactActionButton: View {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    public var title: String
    public var systemImage: String
    public var tint: Color
    public var prominence: CompactButtonProminence
    public var helpText: String
    public var action: () -> Void

    public init(title: String, systemImage: String, tint: Color, prominence: CompactButtonProminence, helpText: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.prominence = prominence
        self.helpText = helpText
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(prominence == .filled ? .white : tint)
                    .frame(width: 24, height: 24)
                    .background(
                        Circle()
                            .fill(prominence == .filled ? Color.white.opacity(0.16).gradient : tint.opacity(0.16).gradient)
                    )

                Text(title)
                    .font(.callout)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 42)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(buttonFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(buttonStroke)
            )
            .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .help(helpText)
        .onHover { isHovering = $0 }
        .pointingHandOnHover()
    }

    private var buttonFill: Color {
        if prominence == .filled {
            return isHovering && isEnabled ? PanelPalette.accentHover : PanelPalette.accent
        }
        return isHovering && isEnabled ? PanelPalette.hover : PanelPalette.backgroundPrimary.opacity(0.55)
    }

    private var buttonStroke: Color {
        if prominence == .filled {
            return PanelPalette.accentHover.opacity(isHovering && isEnabled ? 0.9 : 0.5)
        }
        return PanelPalette.border
    }
}

public struct FooterIconButton: View {
    @Environment(\.isEnabled) private var isEnabled
    @State private var isHovering = false

    public var title: String
    public var systemImage: String
    public var action: () -> Void

    public init(title: String, systemImage: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PanelPalette.textNormal)
                .frame(width: 34, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isHovering && isEnabled ? PanelPalette.hover : PanelPalette.backgroundSecondary.opacity(0.85))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(isHovering && isEnabled ? PanelPalette.accentHover.opacity(0.6) : PanelPalette.border)
                )
                .opacity(isEnabled ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .help(title)
        .onHover { isHovering = $0 }
        .pointingHandOnHover()
    }
}

public struct PanelMessageView: View {
    public var systemImage: String
    public var tint: Color
    public var text: String

    public init(systemImage: String, tint: Color, text: String) {
        self.systemImage = systemImage
        self.tint = tint
        self.text = text
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 18)
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(5)
        }
    }
}

struct HoverRowBackground: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isHovering ? PanelPalette.hover : Color.clear)
            )
            .onHover { isHovering = $0 }
    }
}

public extension View {
    func hoverRowBackground() -> some View {
        modifier(HoverRowBackground())
    }
}

/// Pointing-hand cursor on hover (macOS only). On iOS this is a no-op so every
/// call site compiles unchanged across both apps.
struct PointingHandOnHover: ViewModifier {
    @State private var isHovering = false

    func body(content: Content) -> some View {
        #if os(macOS)
        content
            .onHover { hovering in
                if hovering && !isHovering {
                    NSCursor.pointingHand.push()
                } else if !hovering && isHovering {
                    NSCursor.pop()
                }
                isHovering = hovering
            }
            .onDisappear {
                if isHovering {
                    NSCursor.pop()
                    isHovering = false
                }
            }
        #else
        content
        #endif
    }
}

public extension View {
    func pointingHandOnHover() -> some View {
        modifier(PointingHandOnHover())
    }
}

/// Inline-markdown text helper for streamed agent output. Block-level
/// markdown is rendered as styled plain text per paragraph, which keeps
/// streaming cheap and never drops content.
public func inlineMarkdown(_ text: String) -> AttributedString {
    var options = AttributedString.MarkdownParsingOptions()
    options.interpretedSyntax = .inlineOnlyPreservingWhitespace
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
}
