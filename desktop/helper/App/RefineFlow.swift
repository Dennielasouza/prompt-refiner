import AppKit
import os

let log = Logger(subsystem: "com.promptrefiner.hotkey", category: "refine")

/// ⌥⌥ flow, entirely in the helper (no macOS Service involved):
/// ⌘C → read selection → restore clipboard → backend → ⌘V (only on success, only into the same
/// app) → restore clipboard again. On any failure the text is left untouched and the HUD says why.
/// Never logs or stores the selected text or the refined prompt.
final class RefineFlow {
    private let hud: HUD
    private var busy = false
    private var progressText = ""
    private var pasteSource: PasteSource?

    /// How long to wait for the app to put the selection on the pasteboard after ⌘C.
    private let copyTimeout: TimeInterval = 0.5
    /// Clipboard restore after ⌘V: as soon as the app has read the pasted text (+ grace), never
    /// before `minRestoreDelay`, and at the latest after `maxRestoreDelay`.
    private let readGrace: TimeInterval = 0.25
    private let minRestoreDelay: TimeInterval = 0.5
    private let maxRestoreDelay: TimeInterval = 2.0

    init(hud: HUD) {
        self.hud = hud
    }

    private var endpoint: String {
        RefineCore.normalizedEndpoint(UserDefaults.standard.string(forKey: "endpoint"))
    }

    func start(deep: Bool) {
        if busy {
            hud.show(.progress, progressText.isEmpty ? "Refinando prompt..." : progressText, detail: "Já estou refinando… aguarde.")
            return
        }
        guard let app = NSWorkspace.shared.frontmostApplication, app.processIdentifier != getpid() else { return }
        busy = true
        let pid = app.processIdentifier
        let target = RefineCore.target(forBundleId: app.bundleIdentifier)
        let depth: RefineDepth = deep ? .deep : .balanced
        let pasteboard = NSPasteboard.general
        let snapshot = PasteboardSnapshot(pasteboard)
        let before = pasteboard.changeCount

        Keys.postCommand(Keys.c)
        waitForCopy(pasteboard, since: before, until: Date().addingTimeInterval(copyTimeout)) { [self] text in
            // The user's clipboard goes back right away; it is not needed during the request.
            if pasteboard.changeCount != before { snapshot.restore(to: pasteboard) }
            if let problem = RefineCore.problem(withSelection: text) {
                fail(problem)
                return
            }
            let original = text ?? ""
            let endpoint = self.endpoint
            progressText = RefineCore.progressMessage(target: target, depth: depth)
            hud.show(.progress, progressText)
            log.notice("refine started target=\(target.rawValue, privacy: .public) depth=\(depth.rawValue, privacy: .public)")
            RefineClient(endpoint: endpoint).refine(text: original, target: target, depth: depth, language: Locale.preferredLanguages.first) { result in
                DispatchQueue.main.async {
                    switch result {
                    case let .success(refined):
                        self.deliver(RefineCore.finalText(refined: refined, original: original), to: pid, target: target, depth: depth)
                    case let .failure(failure):
                        self.fail(failure, endpoint: endpoint)
                    }
                }
            }
        }
    }

    private func waitForCopy(_ pasteboard: NSPasteboard, since before: Int, until deadline: Date, then: @escaping (String?) -> Void) {
        let changed = pasteboard.changeCount != before
        let text = changed ? pasteboard.string(forType: .string) : nil
        if text != nil || Date() >= deadline {
            then(text)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.015) { [self] in
            waitForCopy(pasteboard, since: before, until: deadline, then: then)
        }
    }

    private func fail(_ failure: RefineFailure, endpoint: String? = nil) {
        log.notice("refine failed: \(String(describing: failure), privacy: .public)")
        let endpoint = endpoint ?? self.endpoint
        hud.show(failure == .emptySelection ? .info : .error, failure.title, detail: failure.detail(endpoint: endpoint))
        busy = false
    }

    private func deliver(_ text: String, to pid: pid_t, target: RefineTarget, depth: RefineDepth) {
        let pasteboard = NSPasteboard.general
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid else {
            // Never paste into another app. Keep the (paid-for) result on the clipboard instead.
            log.notice("refine done but frontmost app changed; not pasting")
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
            hud.show(.info, "O app mudou durante o refinamento; nada foi alterado.",
                     detail: "O prompt refinado foi copiado — cole com ⌘V onde quiser.", duration: 6)
            busy = false
            return
        }

        let snapshot = PasteboardSnapshot(pasteboard)
        let source = PasteSource(text: text)
        pasteSource = source
        let written = source.write(to: pasteboard)
        let pastedAt = Date()
        var restored = false
        let restore = { [self] in
            guard !restored else { return }
            restored = true
            // Only if nobody (e.g. the user) put something else on the clipboard meanwhile.
            if pasteboard.changeCount == written { snapshot.restore(to: pasteboard) }
            log.notice("refine pasted; clipboard restored (read by app: \(source.firstReadAt != nil, privacy: .public))")
            pasteSource = nil
            busy = false
        }
        source.onFirstRead = { [self] in
            let elapsed = Date().timeIntervalSince(pastedAt)
            DispatchQueue.main.asyncAfter(deadline: .now() + max(readGrace, minRestoreDelay - elapsed)) { restore() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + maxRestoreDelay) { restore() }

        Keys.postCommand(Keys.v)
        hud.show(.success, RefineCore.successMessage(target: target, depth: depth))
    }
}
