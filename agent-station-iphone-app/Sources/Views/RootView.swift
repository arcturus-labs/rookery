import RookKit
import SwiftUI

struct RootView: View {
    @ObservedObject var model: RookModel

    var body: some View {
        ZStack {
            PanelBackground()
                .ignoresSafeArea()

            if model.currentSession != nil {
                ChatScreen(model: model)
            } else {
                AgentPickerScreen(model: model)
            }
        }
        .tint(PanelPalette.accent)
        .sheet(isPresented: Binding(
            get: { model.pendingOffer != nil },
            set: { if !$0 { model.clearOffer() } }
        )) {
            EnvironmentOfferSheet(model: model)
        }
    }
}

// MARK: - Identity bar (shared header)

struct RookHeader: View {
    @ObservedObject var model: RookModel
    var trailing: AnyView?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "bird.fill")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(PanelPalette.accent)
            Text("Rook")
                .font(.title3.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)
            Spacer(minLength: 0)
            if let trailing {
                trailing
            } else {
                HStack(spacing: 6) {
                    Text(model.serverStatusLabel)
                        .font(.caption)
                        .foregroundStyle(PanelPalette.textMuted)
                    StatusDot(tint: model.serverStatusTint)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
