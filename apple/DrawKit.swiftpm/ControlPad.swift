import SwiftUI
import UIKit

/// A touch zone in the sidebar for the hand that isn't holding the Pencil.
/// It counts the fingers on it (Finger 1, 2 or 3): holding changes what the
/// Pencil does, and sliding pans, zooms or rotates. What each does is set in
/// the editor's Gestures settings (see web/input.js).
struct ControlPad: View {
    @State private var count = 0

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20)
                .fill(count > 0 ? Color.accentColor.opacity(0.35) : Color.secondary.opacity(0.12))

            VStack(spacing: 6) {
                Image(systemName: "hand.raised")
                    .font(.title2)
                Text(count > 0 ? "Finger \(min(count, 3))" : "Control pad")
                    .font(.headline)
            }
            .foregroundStyle(.secondary)
            .allowsHitTesting(false)

            MultiTouchArea(
                onCount: { newCount in
                    count = newCount
                    EditorController.current?.sendPad("count", CGFloat(newCount))
                },
                onMove: { dx, dy in
                    EditorController.current?.sendPad("move", dx, dy)
                }
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(12)
        .accessibilityLabel("Control pad")
    }
}

/// Reports how many fingers touch it and how their centre moves
private struct MultiTouchArea: UIViewRepresentable {
    let onCount: (Int) -> Void
    let onMove: (CGFloat, CGFloat) -> Void

    func makeUIView(context: Context) -> TouchView {
        let view = TouchView()
        view.onCount = onCount
        view.onMove = onMove
        return view
    }

    func updateUIView(_ view: TouchView, context: Context) {
        view.onCount = onCount
        view.onMove = onMove
    }

    final class TouchView: UIView {
        var onCount: ((Int) -> Void)?
        var onMove: ((CGFloat, CGFloat) -> Void)?
        private var fingers = Set<UITouch>()
        private var lastCentre: CGPoint?

        override init(frame: CGRect) {
            super.init(frame: frame)
            isMultipleTouchEnabled = true
            backgroundColor = .clear
        }

        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not used")
        }

        private func centre() -> CGPoint? {
            guard !fingers.isEmpty else {
                return nil
            }

            let points = fingers.map { $0.location(in: self) }
            return CGPoint(x: points.map(\.x).reduce(0, +) / CGFloat(points.count),
                           y: points.map(\.y).reduce(0, +) / CGFloat(points.count))
        }

        // The Pencil on the pad doesn't count as a finger
        private func fingerTouches(_ touches: Set<UITouch>) -> Set<UITouch> {
            touches.filter { $0.type != .pencil }
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            fingers.formUnion(fingerTouches(touches))
            lastCentre = centre()
            onCount?(fingers.count)
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let current = centre(), let last = lastCentre else {
                return
            }

            onMove?(current.x - last.x, current.y - last.y)
            lastCentre = current
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            fingers.subtract(touches)
            lastCentre = centre()
            onCount?(fingers.count)
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            touchesEnded(touches, with: event)
        }
    }
}
