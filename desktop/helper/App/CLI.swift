import AppKit

// Command-line entry points of the helper executable (no menu bar item):
//   PromptRefinerHotkey --hud <progress|success|error|info> <título> [detalhe]
//       Shows a HUD. Used by dist/refine.mjs (macOS Services). If the menu bar helper is running,
//       it is asked to show it (distributed notification); otherwise this process shows it itself.
//   PromptRefinerHotkey --selftest-endpoint <url> [--selftest-timeout <s>]
//       Calls the backend with a fixed sample text and prints the outcome (debug; no UI).

enum CLI {
    static let bundleId = "com.promptrefiner.hotkey"

    /// Handles the CLI modes; returns only when the app should start normally.
    static func handle(_ args: [String]) {
        if let i = args.firstIndex(of: "--selftest-endpoint") {
            let timeout = args.firstIndex(of: "--selftest-timeout").flatMap { args.indices.contains($0 + 1) ? TimeInterval(args[$0 + 1]) : nil }
            selfTest(endpoint: args.indices.contains(i + 1) ? args[i + 1] : nil, timeout: timeout)
        }
        if let i = args.firstIndex(of: "--hud") {
            let rest = Array(args[(i + 1)...])
            hud(style: rest.first.flatMap(HUDStyle.init(rawValue:)) ?? .info,
                title: rest.count > 1 ? rest[1] : "",
                detail: rest.count > 2 ? rest[2] : nil)
        }
    }

    static func userInfo(style: HUDStyle, title: String, detail: String?) -> [String: String] {
        var info = ["style": style.rawValue, "title": String(title.prefix(200))]
        if let detail { info["detail"] = String(detail.prefix(400)) }
        return info
    }

    private static func hud(style: HUDStyle, title: String, detail: String?) -> Never {
        guard !title.isEmpty else { exit(64) }
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
            .contains { $0.processIdentifier != getpid() && !$0.isTerminated }
        if running {
            DistributedNotificationCenter.default().postNotificationName(
                HUD.notificationName, object: nil, userInfo: userInfo(style: style, title: title, detail: detail), deliverImmediately: true)
            exit(0)
        }
        // Helper not running: show it from this process (skip transient progress messages).
        guard let duration = style.duration else { exit(0) }
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let view = HUD()
        DispatchQueue.main.async { view.show(style, title, detail: detail) }
        DispatchQueue.main.asyncAfter(deadline: .now() + duration + 0.5) { exit(0) }
        app.run()
        exit(0)
    }

    private static func selfTest(endpoint raw: String?, timeout: TimeInterval?) -> Never {
        let endpoint = RefineCore.normalizedEndpoint(raw)
        let client = RefineClient(endpoint: endpoint, timeout: timeout ?? RefineCore.requestTimeout)
        let done = DispatchSemaphore(value: 0)
        var outcome: Result<String, RefineFailure> = .failure(.invalidResponse)
        client.refine(text: "Explique fotossíntese para uma criança de 10 anos.", target: .generic, depth: .balanced,
                      language: Locale.preferredLanguages.first) { result in
            outcome = result
            done.signal()
        }
        done.wait()
        switch outcome {
        case let .success(prompt):
            print("OK: prompt refinado (\(prompt.count) caracteres) via \(endpoint)")
            exit(0)
        case let .failure(failure):
            print("FALHA [\(failure)]: \(failure.title) \(failure.detail(endpoint: endpoint) ?? "")")
            exit(2)
        }
    }
}
