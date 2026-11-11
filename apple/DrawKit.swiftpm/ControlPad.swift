import SwiftUI

/// Two touch zones in the sidebar for the hand that isn't holding the
/// Pencil. Holding a zone changes what the Pencil does, and sliding in a
/// zone pans, zooms or rotates. What each does is set in the editor's
/// Gestures settings (see web/input.js).
struct ControlPad: View {
    var body: some View {
        VStack(spacing: 10) {
            PadZone(zone: "fingers", title: "Fingers", systemImage: "hand.raised")
            PadZone(zone: "thumb", title: "Thumb", systemImage: "hand.thumbsup")
        }
        .padding(12)
    }
}

private struct PadZone: View {
    let zone: String
    let title: String
    let systemImage: String
    @State private var last: CGPoint?

    var body: some View {
        RoundedRectangle(cornerRadius: 20)
            .fill(last != nil ? Color.accentColor.opacity(0.35) : Color.secondary.opacity(0.12))
            .overlay {
                Label(title, systemImage: systemImage)
                    .font(.headline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 150)
            .contentShape(RoundedRectangle(cornerRadius: 20))
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if let last {
                            EditorController.current?.sendPad(zone, "move",
                                                             dx: value.location.x - last.x,
                                                             dy: value.location.y - last.y)
                        } else {
                            EditorController.current?.sendPad(zone, "down")
                        }

                        last = value.location
                    }
                    .onEnded { _ in
                        last = nil
                        EditorController.current?.sendPad(zone, "up")
                    }
            )
            .accessibilityLabel("\(title) zone")
    }
}
