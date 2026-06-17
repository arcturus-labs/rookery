import Foundation

/// A user-defined geofenced place. `id` is the slug used to build the
/// environment id `place:<id>` and to resolve `environment-repository/place/<id>/`.
struct Place: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var latitude: Double
    var longitude: Double
    var radius: Double

    static func slugify(_ name: String) -> String {
        let lowered = name.lowercased()
        let mapped = lowered.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()
        return mapped.split(separator: "-").joined(separator: "-")
    }
}

/// Persisted set of places (UserDefaults-backed JSON). Seeds the geofences the
/// LocationProvider monitors and collects CLVisit auto-detect suggestions (Phase E).
@MainActor
final class PlaceStore: ObservableObject {
    @Published private(set) var places: [Place] = []

    private let defaultsKey = "RookPlaces"

    init() {
        load()
        seedFromEnvironmentIfNeeded()
    }

    /// Test hook: `ROOK_SEED_PLACE="Name,lat,lon,radius"` seeds a place on
    /// launch (used for simulator verification via SIMCTL_CHILD_ROOK_SEED_PLACE).
    private func seedFromEnvironmentIfNeeded() {
        guard let raw = ProcessInfo.processInfo.environment["ROOK_SEED_PLACE"] else {
            return
        }
        let parts = raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4,
              let lat = Double(parts[1]), let lon = Double(parts[2]), let r = Double(parts[3]) else {
            return
        }
        add(name: parts[0], latitude: lat, longitude: lon, radius: r)
    }

    func add(name: String, latitude: Double, longitude: Double, radius: Double) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return
        }
        var slug = Place.slugify(trimmed)
        if slug.isEmpty {
            slug = "place-\(places.count + 1)"
        }
        // Replace any existing place with the same slug.
        places.removeAll { $0.id == slug }
        places.append(Place(id: slug, name: trimmed, latitude: latitude, longitude: longitude, radius: radius))
        save()
    }

    func remove(_ place: Place) {
        places.removeAll { $0.id == place.id }
        save()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let decoded = try? JSONDecoder().decode([Place].self, from: data) else {
            return
        }
        places = decoded
    }

    private func save() {
        if let data = try? JSONEncoder().encode(places) {
            UserDefaults.standard.set(data, forKey: defaultsKey)
        }
    }
}
