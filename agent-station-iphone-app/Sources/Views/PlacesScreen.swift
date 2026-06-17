import CoreLocation
import RookKit
import SwiftUI

struct PlacesScreen: View {
    @ObservedObject var model: RookModel
    @State private var newName = ""
    @State private var radius: Double = 150

    var body: some View {
        NavigationStack {
            ZStack {
                PanelBackground().ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !model.locationProvider.isAuthorized {
                            enableCard
                        } else {
                            addCard
                        }
                        placesList
                        Text("Define a place here, and create a matching skill bundle on the server at environment-repository/place/<slug>/. When you arrive, Rook offers that place's skills.")
                            .font(.caption2)
                            .foregroundStyle(PanelPalette.textMuted)
                            .padding(.horizontal, 4)
                    }
                    .padding(16)
                }
            }
            .navigationTitle("Places")
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(PanelPalette.accent)
        .onAppear {
            if model.locationProvider.isAuthorized {
                model.locationProvider.requestCurrentLocation()
            }
        }
    }

    private var enableCard: some View {
        PanelCard {
            Label("Location", systemImage: "location.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)
            Text("Rook uses your location to load a place's skills when you arrive — including in the background. Grant \u{201C}Always\u{201D} for the full experience.")
                .font(.caption)
                .foregroundStyle(PanelPalette.textMuted)
            CompactActionButton(title: "Enable location", systemImage: "location", tint: PanelPalette.accent, prominence: .filled, helpText: "") {
                model.enableLocation()
            }
        }
    }

    private var addCard: some View {
        PanelCard {
            Label("Save a place", systemImage: "mappin.and.ellipse")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(PanelPalette.textNormal)

            TextField("Name (e.g. Office)", text: $newName)
                .textInputAutocapitalization(.words)
                .foregroundStyle(PanelPalette.textNormal)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 8).fill(PanelPalette.backgroundPrimary.opacity(0.8)))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(PanelPalette.border))

            HStack {
                Text("Radius")
                    .font(.caption)
                    .foregroundStyle(PanelPalette.textMuted)
                Slider(value: $radius, in: 50...500, step: 10)
                Text("\(Int(radius)) m")
                    .font(.caption.monospaced())
                    .foregroundStyle(PanelPalette.textMuted)
            }

            if let loc = model.locationProvider.currentLocation {
                Text(String(format: "Here: %.4f, %.4f", loc.coordinate.latitude, loc.coordinate.longitude))
                    .font(.caption2.monospaced())
                    .foregroundStyle(PanelPalette.textMuted)
            }

            CompactActionButton(
                title: "Save current location as \u{201C}\(newName.isEmpty ? "place" : newName)\u{201D}",
                systemImage: "plus",
                tint: PanelPalette.accent,
                prominence: .filled,
                helpText: ""
            ) {
                saveCurrent()
            }
        }
    }

    private var placesList: some View {
        Group {
            if model.placeStore.places.isEmpty {
                EmptyView()
            } else {
                PanelCard {
                    Text("YOUR PLACES")
                        .font(.system(size: 10, weight: .semibold))
                        .kerning(0.6)
                        .foregroundStyle(PanelPalette.textMuted)
                    ForEach(model.placeStore.places) { place in
                        HStack(spacing: 10) {
                            Image(systemName: "mappin.circle.fill")
                                .foregroundStyle(model.currentPlaceName == place.name ? PanelPalette.success : PanelPalette.accentHover)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(place.name)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(PanelPalette.textNormal)
                                Text("place:\(place.id) · \(Int(place.radius)) m")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(PanelPalette.textMuted)
                            }
                            Spacer()
                            Button {
                                model.placeStore.remove(place)
                                model.refreshMonitoredPlaces()
                            } label: {
                                Image(systemName: "trash")
                                    .foregroundStyle(PanelPalette.danger)
                            }
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
        }
    }

    private func saveCurrent() {
        guard let loc = model.locationProvider.currentLocation else {
            model.locationProvider.requestCurrentLocation()
            return
        }
        model.placeStore.add(
            name: newName,
            latitude: loc.coordinate.latitude,
            longitude: loc.coordinate.longitude,
            radius: radius
        )
        model.refreshMonitoredPlaces()
        newName = ""
    }
}
