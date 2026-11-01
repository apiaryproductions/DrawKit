// swift-tools-version: 5.9

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "DrawKit",
    platforms: [
        .iOS("16.0")
    ],
    products: [
        .iOSApplication(
            name: "DrawKit",
            targets: ["AppModule"],
            bundleIdentifier: "com.apiaryproductions.drawkit",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .bunny),
            accentColor: .presetColor(.orange),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ],
            appCategory: .productivity
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            resources: [
                .copy("Resources/webapp")
            ]
        )
    ]
)
