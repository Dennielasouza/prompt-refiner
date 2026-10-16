import AppKit

enum HUDStyle: String {
    case progress, success, error, info

    var duration: TimeInterval? {
        switch self {
        case .progress: return nil // stays until replaced
        case .success: return 3
        case .info: return 3.5
        case .error: return 5
        }
    }
}

/// Small floating message at the bottom center of the screen with the mouse. It is a
/// non-activating panel that ignores the mouse, so it never takes focus from the app being edited.
/// Needs no notification permission.
final class HUD {
    static let notificationName = Notification.Name("com.promptrefiner.hud")

    private var panel: NSPanel?
    private var generation = 0

    func show(_ style: HUDStyle, _ title: String, detail: String? = nil, duration: TimeInterval? = nil) {
        generation += 1
        let current = generation
        let panel = self.panel ?? makePanel()
        self.panel = panel

        let content = makeContent(style, title, detail)
        let size = content.fittingSize
        content.frame = NSRect(origin: .zero, size: size)
        panel.contentView = content
        panel.setFrame(frame(for: size), display: true)

        if !panel.isVisible {
            panel.alphaValue = 0
            panel.orderFrontRegardless()
        }
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.15
            panel.animator().alphaValue = 1
        }
        if let seconds = duration ?? style.duration {
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
                guard let self, self.generation == current else { return }
                self.hide()
            }
        }
    }

    func hide() {
        guard let panel, panel.isVisible else { return }
        let current = generation
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.25
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.generation == current else { return }
            panel.orderOut(nil)
        })
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 300, height: 48),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        return panel
    }

    private func frame(for size: NSSize) -> NSRect {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSRect(x: (area.midX - size.width / 2).rounded(), y: area.minY + 72, width: size.width, height: size.height)
    }

    private func makeContent(_ style: HUDStyle, _ title: String, _ detail: String?) -> NSView {
        let radius: CGFloat = 14
        let background = NSVisualEffectView()
        background.material = .hudWindow // adapts to light/dark
        background.blendingMode = .behindWindow
        background.state = .active
        background.maskImage = Self.roundedMask(radius: radius)

        var labels = [Self.label(title, font: .systemFont(ofSize: 13, weight: .semibold),
                                 color: style == .error ? .systemRed : .labelColor)]
        if let detail, !detail.isEmpty {
            labels.append(Self.label(detail, font: .systemFont(ofSize: 12), color: .labelColor))
        }
        let iconView = icon(for: style)
        iconView.translatesAutoresizingMaskIntoConstraints = false

        if style == .error {
            // Red tint + border so failures are unmistakable.
            let tint = NSView()
            tint.wantsLayer = true
            tint.layer?.backgroundColor = NSColor.systemRed.withAlphaComponent(0.14).cgColor
            tint.layer?.borderColor = NSColor.systemRed.withAlphaComponent(0.55).cgColor
            tint.layer?.borderWidth = 1
            tint.layer?.cornerRadius = radius
            tint.translatesAutoresizingMaskIntoConstraints = false
            background.addSubview(tint)
            NSLayoutConstraint.activate([
                tint.leadingAnchor.constraint(equalTo: background.leadingAnchor),
                tint.trailingAnchor.constraint(equalTo: background.trailingAnchor),
                tint.topAnchor.constraint(equalTo: background.topAnchor),
                tint.bottomAnchor.constraint(equalTo: background.bottomAnchor),
            ])
        }
        // Explicit constraints (stack views do not enforce perpendicular insets in fittingSize).
        background.addSubview(iconView)
        var constraints = [
            iconView.leadingAnchor.constraint(equalTo: background.leadingAnchor, constant: 14),
            iconView.centerYAnchor.constraint(equalTo: background.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 20),
            iconView.heightAnchor.constraint(equalToConstant: 20),
            background.widthAnchor.constraint(greaterThanOrEqualToConstant: 220),
        ]
        var previous: NSLayoutYAxisAnchor = background.topAnchor
        for (i, label) in labels.enumerated() {
            label.translatesAutoresizingMaskIntoConstraints = false
            background.addSubview(label)
            constraints += [
                label.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 10),
                label.trailingAnchor.constraint(lessThanOrEqualTo: background.trailingAnchor, constant: -18),
                label.topAnchor.constraint(equalTo: previous, constant: i == 0 ? 12 : 2),
            ]
            previous = label.bottomAnchor
        }
        constraints.append(previous.constraint(equalTo: background.bottomAnchor, constant: -12))
        NSLayoutConstraint.activate(constraints)
        return background
    }

    private func icon(for style: HUDStyle) -> NSView {
        if style == .progress {
            let spinner = NSProgressIndicator()
            spinner.style = .spinning
            spinner.controlSize = .small
            spinner.isIndeterminate = true
            spinner.startAnimation(nil)
            return spinner
        }
        let (name, color): (String, NSColor) = switch style {
        case .success: ("checkmark.circle.fill", .systemGreen)
        case .error: ("xmark.octagon.fill", .systemRed)
        default: ("exclamationmark.circle.fill", .systemOrange)
        }
        let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 18, weight: .semibold))
        let view = NSImageView(image: image ?? NSImage())
        view.contentTintColor = color
        return view
    }

    /// Wrapping label with an explicit size (single-line width capped at 380 pt, height of the
    /// wrapped text), so the panel's fitting size accounts for every line.
    private static func label(_ text: String, font: NSFont, color: NSColor) -> NSTextField {
        let maxWidth: CGFloat = 380
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = font
        label.textColor = color
        label.isSelectable = false
        let single = (text as NSString).size(withAttributes: [.font: font]).width
        let width = min(ceil(single) + 4, maxWidth)
        label.preferredMaxLayoutWidth = width
        let height = label.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: 10_000)).height ?? font.pointSize * 1.4
        label.widthAnchor.constraint(equalToConstant: width).isActive = true
        label.heightAnchor.constraint(equalToConstant: ceil(height)).isActive = true
        return label
    }

    private static func roundedMask(radius: CGFloat) -> NSImage {
        let edge = radius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }
}
