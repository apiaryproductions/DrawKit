import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled draw.io editor at drawkit-app://app/... so that the
/// editor's own file requests (stencils, translations, templates) work as
/// they would on a web server.
final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "drawkit-app"
    static let startURL = URL(string: "\(scheme)://app/host.html")!

    private let root: URL

    override init() {
        root = WebAppSchemeHandler.findWebApp().standardizedFileURL
        super.init()
    }

    /// Finds the bundled webapp folder, which is either in the app bundle or
    /// in a resource bundle inside it (depending on how the app was built).
    private static func findWebApp() -> URL {
        if let url = Bundle.main.url(forResource: "webapp", withExtension: nil) {
            return url
        }

        let bundles = Bundle.main.urls(forResourcesWithExtension: "bundle", subdirectory: nil) ?? []

        for bundleURL in bundles {
            if let url = Bundle(url: bundleURL)?.url(forResource: "webapp", withExtension: nil) {
                return url
            }
        }

        return Bundle.main.bundleURL.appendingPathComponent("webapp")
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        let path = url.path.isEmpty || url.path == "/" ? "host.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL

        // Only files inside the bundled webapp folder
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        var mimeType = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"

        if mimeType.hasPrefix("text/") || mimeType.hasSuffix("javascript") || mimeType.hasSuffix("xml") {
            mimeType += "; charset=utf-8"
        }

        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mimeType,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache"
        ])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Responses are sent synchronously, nothing to cancel
    }
}
