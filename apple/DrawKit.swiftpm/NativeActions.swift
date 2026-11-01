import Foundation
import UIKit
import UserNotifications

/// The native side of flow actions (see web/flow.js). Each function gets the
/// action's parameters and returns the step's output.
@MainActor
enum NativeActions {
    struct ActionError: LocalizedError {
        let errorDescription: String?
        init(_ message: String) { errorDescription = message }
    }

    static func perform(_ name: String, _ params: [String: Any]) async throws -> Any? {
        func string(_ key: String) -> String { params[key] as? String ?? "" }

        switch name {
        case "notify":
            try await notify(title: string("title"), body: string("body"))
            return nil
        case "copy":
            UIPasteboard.general.string = string("text")
            return nil
        case "paste":
            return UIPasteboard.general.string ?? ""
        case "openURL":
            try await open(string("url"))
            return nil
        case "runShortcut":
            return try await runShortcut(name: string("name"), input: string("input"),
                                         waitForClipboard: string("result") != "Do not wait")
        case "http":
            return try await http(url: string("url"), method: string("method"),
                                  headers: string("headers"), body: string("body"))
        default:
            throw ActionError("Unknown native action \"\(name)\"")
        }
    }

    // MARK: - Notifications

    static func notify(title: String, body: String) async throws {
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound])

        guard granted else {
            throw ActionError("Notifications are turned off for this app in Settings")
        }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        try await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }

    // MARK: - URLs

    static func open(_ string: String) async throws {
        guard let url = URL(string: string), url.scheme != nil else {
            throw ActionError("Not a valid URL: \(string)")
        }

        let opened = await UIApplication.shared.open(url)

        if !opened {
            throw ActionError("No app could open \(string)")
        }
    }

    // MARK: - Shortcuts

    /// Runs a shortcut through the Shortcuts URL scheme. Apps built in Swift
    /// Playgrounds cannot register their own URL scheme, so the shortcut's
    /// output comes back through the clipboard: the shortcut copies its
    /// result and switches back to this app.
    static func runShortcut(name: String, input: String, waitForClipboard: Bool) async throws -> String {
        guard !name.isEmpty else {
            throw ActionError("Enter the name of the shortcut to run")
        }

        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "run-shortcut"
        components.queryItems = [URLQueryItem(name: "name", value: name)]

        if !input.isEmpty {
            components.queryItems? += [URLQueryItem(name: "input", value: "text"),
                                       URLQueryItem(name: "text", value: input)]
        }

        guard let url = components.url else {
            throw ActionError("Could not build the link for shortcut \"\(name)\"")
        }

        let changeCount = UIPasteboard.general.changeCount

        guard await UIApplication.shared.open(url) else {
            throw ActionError("Could not open the Shortcuts app")
        }

        guard waitForClipboard else {
            return input
        }

        // Waits until the shortcut has copied something and the app is back
        // in front (up to 10 minutes).
        let deadline = Date().addingTimeInterval(600)

        while Date() < deadline {
            try await Task.sleep(nanoseconds: 300_000_000)

            if UIApplication.shared.applicationState == .active,
               UIPasteboard.general.changeCount != changeCount {
                return UIPasteboard.general.string ?? ""
            }
        }

        throw ActionError("Timed out waiting for shortcut \"\(name)\" to copy its result")
    }

    // MARK: - Web requests

    static func http(url: String, method: String, headers: String, body: String) async throws -> String {
        guard let requestURL = URL(string: url), requestURL.scheme == "http" || requestURL.scheme == "https" else {
            throw ActionError("Not a valid web address: \(url)")
        }

        var request = URLRequest(url: requestURL)
        request.httpMethod = method.isEmpty ? "GET" : method

        if let data = headers.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            for (key, value) in object {
                request.setValue("\(value)", forHTTPHeaderField: key)
            }
        }

        if !body.isEmpty && request.httpMethod != "GET" {
            request.httpBody = body.data(using: .utf8)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        let text = String(data: data, encoding: .utf8) ?? data.base64EncodedString()

        if let status = (response as? HTTPURLResponse)?.statusCode, !(200..<300).contains(status) {
            throw ActionError("Request failed with status \(status): \(text.prefix(200))")
        }

        return text
    }
}
