import SwiftUI
import WebKit

struct EditorScreen: View {
    @EnvironmentObject private var library: FlowLibrary
    @StateObject private var editor = EditorController()
    let flow: FlowLibrary.Flow

    var body: some View {
        WebView(webView: editor.webView)
            .ignoresSafeArea(.container, edges: .bottom)
            .navigationTitle(flow.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        editor.call("editAction")
                    } label: {
                        Label("Action", systemImage: "bolt")
                    }

                    if editor.isRunning {
                        Button {
                            editor.call("stop")
                        } label: {
                            Label("Stop", systemImage: "stop.fill")
                        }
                    } else {
                        Button {
                            editor.call("run")
                        } label: {
                            Label("Run", systemImage: "play.fill")
                        }
                    }
                }
            }
            .onAppear {
                editor.open(flow, in: library)
            }
    }
}

private struct WebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Owns the web view that runs the editor, and answers its requests
/// (load/save the flow, native actions, alerts and prompts).
@MainActor
final class EditorController: NSObject, ObservableObject, WKUIDelegate {
    @Published private(set) var isRunning = false
    let webView: WKWebView
    private var flow: FlowLibrary.Flow?
    private weak var library: FlowLibrary?

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(WebAppSchemeHandler(), forURLScheme: WebAppSchemeHandler.scheme)
        let messages = MessageHandler()
        configuration.userContentController.addScriptMessageHandler(messages, contentWorld: .page, name: "drawkit")
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        messages.controller = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        if #available(iOS 16.4, *) {
            // Allows Safari's Web Inspector on a Mac to debug the editor
            webView.isInspectable = true
        }
    }

    func open(_ flow: FlowLibrary.Flow, in library: FlowLibrary) {
        guard self.flow == nil else {
            return
        }

        self.flow = flow
        self.library = library
        webView.load(URLRequest(url: WebAppSchemeHandler.startURL))
    }

    /// Calls run(), stop() or editAction() on DrawKitHost in host.html
    func call(_ function: String) {
        webView.evaluateJavaScript("DrawKitHost.\(function)()", completionHandler: nil)
    }

    fileprivate func handle(_ name: String, _ params: [String: Any]) async throws -> Any? {
        switch name {
        case "getDocument":
            guard let flow, let library else { return "" }
            return library.read(flow)
        case "saveDocument":
            if let flow, let library, let xml = params["xml"] as? String {
                library.write(xml, to: flow)
            }
            return nil
        case "flowEvent":
            let type = params["type"] as? String ?? ""

            if type == "start" {
                isRunning = true
            } else if ["done", "error", "stopped"].contains(type) {
                isRunning = false
            }

            return nil
        default:
            return try await NativeActions.perform(name, params)
        }
    }

    // MARK: - Alerts, confirmations and prompts from the editor and flows

    private var presenter: UIViewController? {
        var controller = webView.window?.rootViewController

        while let presented = controller?.presentedViewController {
            controller = presented
        }

        return controller
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, otherwise: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, otherwise: { completionHandler(false) })
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text ?? "")
        })
        present(alert, otherwise: { completionHandler(nil) })
    }

    private func present(_ alert: UIAlertController, otherwise fallback: () -> Void) {
        guard let presenter else {
            fallback()
            return
        }

        presenter.present(alert, animated: true)
    }
}

/// Receives window.webkit.messageHandlers.drawkit.postMessage({name, params})
/// and replies to the returned Promise. Holds the controller weakly because
/// the web view configuration keeps its message handlers alive.
@MainActor
private final class MessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var controller: EditorController?

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let name = body["name"] as? String else {
            replyHandler(nil, "Invalid message")
            return
        }

        let params = body["params"] as? [String: Any] ?? [:]

        Task { @MainActor in
            guard let controller = self.controller else {
                replyHandler(nil, "Editor closed")
                return
            }

            do {
                replyHandler(try await controller.handle(name, params), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }
}
