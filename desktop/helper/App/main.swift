// Prompt Refiner hotkey helper (menu bar app, no Dock icon).
// Double tap ⌥ → refines the selection of the frontmost app (balanced).
// ⇧ held + double tap ⌥ → deep refinement.
// The whole flow runs here (see RefineFlow.swift): copy selection, call the local backend, paste
// the result only on success. Feedback is a non-activating HUD (HUD.swift).
//
// Privacy: it only reacts to modifier changes and to the fact that some other key was pressed
// (to cancel a sequence). It never reads, stores or sends which keys were typed, and never logs
// the selected text or the refined prompt.
import AppKit
import ApplicationServices

private let optionKeyCodes: Set<UInt16> = [58, 61] // left/right ⌥
private let shiftKeyCodes: Set<UInt16> = [56, 60]

CLI.handle(CommandLine.arguments)

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var detector = TapDetector()
    private var monitors: [Any] = []
    private var statusItem: NSStatusItem!
    private var paused = false
    private var trustTimer: Timer?
    private let hud = HUD()
    private lazy var flow = RefineFlow(hud: hud)

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "✦"
        statusItem.button?.toolTip = "Prompt Refiner"
        rebuildMenu()

        // HUD requests from dist/refine.mjs (macOS Services), via `PromptRefinerHotkey --hud …`.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(showRequestedHUD(_:)), name: HUD.notificationName, object: nil,
            suspensionBehavior: .deliverImmediately)

        let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary)
        log.notice("launched; accessibility trusted: \(trusted, privacy: .public)")
        if trusted {
            startMonitoring()
        } else {
            // Wait until the user grants Accessibility in System Settings.
            trustTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
                guard AXIsProcessTrusted() else { return }
                timer.invalidate()
                self?.startMonitoring()
                self?.rebuildMenu()
            }
        }
    }

    @objc private func showRequestedHUD(_ note: Notification) {
        guard let info = note.userInfo, let title = info["title"] as? String, !title.isEmpty else { return }
        let style = (info["style"] as? String).flatMap(HUDStyle.init(rawValue:)) ?? .info
        log.notice("HUD requested by a Service: \(style.rawValue, privacy: .public)")
        hud.show(style, String(title.prefix(200)), detail: (info["detail"] as? String).map { String($0.prefix(400)) })
    }

    private func startMonitoring() {
        guard monitors.isEmpty else { return }
        if let m = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged, .keyDown], handler: { [weak self] in self?.handle($0) }) {
            monitors.append(m)
        }
    }

    private func handle(_ event: NSEvent) {
        guard !paused else { return }
        let input: TapDetector.Input
        if event.type == .keyDown {
            input = .otherKey
        } else if optionKeyCodes.contains(event.keyCode) {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let shift = flags.contains(.shift)
            if flags.contains(.option) {
                input = .optionDown(shift: shift, otherModifiers: !flags.isDisjoint(with: [.command, .control]))
            } else {
                input = .optionUp(shift: shift)
            }
        } else if shiftKeyCodes.contains(event.keyCode) {
            input = .shiftChanged
        } else {
            input = .otherKey // ⌘, ⌃, fn, caps lock…
        }
        if let deep = detector.handle(input, at: event.timestamp) {
            // Let the physical ⌥ release settle before sending ⌘C.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in self?.flow.start(deep: deep) }
        }
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let header = NSMenuItem(title: "Prompt Refiner", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        for line in ["⌥⌥  refinar (equilibrado)", "⇧ + ⌥⌥  refinar (profundo)"] {
            let item = NSMenuItem(title: line, action: nil, keyEquivalent: "")
            item.isEnabled = false
            menu.addItem(item)
        }
        menu.addItem(.separator())
        if !AXIsProcessTrusted() {
            menu.addItem(NSMenuItem(title: "Permitir em Acessibilidade…", action: #selector(openAccessibility), keyEquivalent: ""))
        }
        menu.addItem(NSMenuItem(title: paused ? "Retomar" : "Pausar", action: #selector(togglePause), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Sair", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        for item in menu.items where item.action != nil && item.action != #selector(NSApplication.terminate(_:)) {
            item.target = self
        }
        statusItem.menu = menu
        statusItem.button?.appearsDisabled = paused || !AXIsProcessTrusted()
    }

    @objc private func togglePause() {
        paused.toggle()
        rebuildMenu()
    }

    @objc private func openAccessibility() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
