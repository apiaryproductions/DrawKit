import Foundation

/// Stores flows as .drawio files in the app's Documents/Flows folder.
@MainActor
final class FlowLibrary: ObservableObject {
    struct Flow: Identifiable, Hashable {
        let url: URL
        var id: URL { url }
        var name: String { url.deletingPathExtension().lastPathComponent }
    }

    @Published private(set) var flows: [Flow] = []
    let folder: URL

    init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        folder = documents.appendingPathComponent("Flows", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        reload()
    }

    func reload() {
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        flows = urls
            .filter { $0.pathExtension == "drawio" }
            .map { Flow(url: $0) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    @discardableResult
    func create(named base: String = "New Flow") -> Flow {
        let url = uniqueURL(for: base)
        try? Data().write(to: url)
        reload()
        return Flow(url: url)
    }

    func delete(_ flow: Flow) {
        try? FileManager.default.removeItem(at: flow.url)
        reload()
    }

    @discardableResult
    func rename(_ flow: Flow, to newName: String) -> Flow {
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-")

        guard !trimmed.isEmpty, trimmed != flow.name else {
            return flow
        }

        let url = uniqueURL(for: trimmed)
        try? FileManager.default.moveItem(at: flow.url, to: url)
        reload()
        return Flow(url: url)
    }

    func read(_ flow: Flow) -> String {
        (try? String(contentsOf: flow.url, encoding: .utf8)) ?? ""
    }

    func write(_ xml: String, to flow: Flow) {
        try? xml.write(to: flow.url, atomically: true, encoding: .utf8)
    }

    private func uniqueURL(for base: String) -> URL {
        var url = folder.appendingPathComponent(base).appendingPathExtension("drawio")
        var counter = 2

        while FileManager.default.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent("\(base) \(counter)").appendingPathExtension("drawio")
            counter += 1
        }

        return url
    }
}
