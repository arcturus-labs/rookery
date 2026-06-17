import RookKit
import SwiftUI

struct AgentPickerScreen: View {
    @ObservedObject var model: RookModel
    @State private var showingServerField = false
    @State private var serverDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            RookHeader(model: model, trailing: AnyView(
                Button {
                    serverDraft = model.baseURLString
                    showingServerField = true
                } label: {
                    Image(systemName: "gearshape")
                        .foregroundStyle(PanelPalette.textMuted)
                }
            ))

            if model.serverState == .offline {
                offlineCard
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text("CHAT WITH")
                        .font(.system(size: 11, weight: .semibold))
                        .kerning(0.6)
                        .foregroundStyle(PanelPalette.textMuted)
                        .padding(.horizontal, 4)

                    if model.agents.isEmpty {
                        Text(model.serverState == .online ? "No agents registered" : "Waiting for the server…")
                            .font(.callout)
                            .foregroundStyle(PanelPalette.textMuted)
                            .frame(maxWidth: .infinity, minHeight: 80)
                    } else {
                        PanelCard {
                            ForEach(Array(model.agentTree.enumerated()), id: \.element.agent.id) { index, entry in
                                Button {
                                    model.startNewSession(agentId: entry.agent.id, name: "")
                                } label: {
                                    AgentRow(agent: entry.agent, depth: entry.depth)
                                }
                                .buttonStyle(.plain)
                                .disabled(model.startingSession)

                                if index < model.agentTree.count - 1 {
                                    Divider().overlay(PanelPalette.border).opacity(0.5)
                                }
                            }
                        }
                    }

                    if !model.agentsError.isEmpty {
                        PanelMessageView(systemImage: "exclamationmark.triangle.fill", tint: PanelPalette.warning, text: model.agentsError)
                    }
                }
                .padding(16)
            }
        }
        .alert("Server address", isPresented: $showingServerField) {
            TextField("http://127.0.0.1:3000", text: $serverDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Save") { model.setBaseURL(serverDraft) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("On a device, use your Mac's LAN address. The simulator reaches localhost directly.")
        }
    }

    private var offlineCard: some View {
        PanelMessageView(
            systemImage: "bolt.slash.fill",
            tint: PanelPalette.danger,
            text: "Server unreachable at \(model.baseURLString). Run `npm run dev` on the Mac; tap the gear to change the address."
        )
        .padding(16)
    }
}

private struct AgentRow: View {
    var agent: AgentDefinition
    var depth: Int

    var body: some View {
        HStack(spacing: 9) {
            if depth > 0 {
                Image(systemName: "arrow.turn.down.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(PanelPalette.textMuted)
                    .padding(.leading, CGFloat(depth) * 14)
            }
            Image(systemName: depth > 0 ? "person.crop.square" : "sparkle")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.info)
                .frame(width: 24, height: 24)
                .background(Circle().fill(PanelPalette.info.opacity(0.14)))
            Text(agent.id)
                .font(.body)
                .fontWeight(.medium)
                .foregroundStyle(PanelPalette.textNormal)
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(PanelPalette.textMuted)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}
