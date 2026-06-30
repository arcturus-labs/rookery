// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RookKit",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "RookKit", targets: ["RookKit"]),
    ],
    dependencies: [
        .package(url: "https://github.com/LiYanan2004/MarkdownView.git", branch: "main"),
    ],
    targets: [
        .target(
            name: "RookKit",
            dependencies: [
                .product(name: "MarkdownView", package: "MarkdownView"),
            ]
        ),
        .testTarget(
            name: "RookKitTests",
            dependencies: ["RookKit"]
        ),
    ]
)
