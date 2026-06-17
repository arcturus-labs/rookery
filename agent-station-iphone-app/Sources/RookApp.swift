import RookKit
import SwiftUI

@main
struct RookApp: App {
    @StateObject private var model = RookModel()

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .preferredColorScheme(.dark)
        }
    }
}
