import Foundation

/// Detects a double tap of the Option key from a stream of keyboard events.
/// Pure logic (no AppKit) so it can be unit-tested with synthetic events.
///
/// Rules:
/// - a "tap" is Option pressed and released within `maxTapDuration`, alone;
/// - two taps whose releases are within `maxInterval` form a double tap;
/// - any other key, or ⌘/⌃ involved, cancels the sequence (so normal ⌥ shortcuts never trigger);
/// - Shift held during both taps means "deep".
struct TapDetector {
    enum Input {
        case optionDown(shift: Bool, otherModifiers: Bool)
        case optionUp(shift: Bool)
        case shiftChanged
        case otherKey
    }

    var maxTapDuration: TimeInterval = 0.30
    var maxInterval: TimeInterval = 0.45

    private var downAt: TimeInterval?
    private var downWithShift = false
    private var lastTap: (at: TimeInterval, shift: Bool)?

    /// Returns `true`/`false` (deep or not) when a double tap completes, otherwise nil.
    mutating func handle(_ input: Input, at time: TimeInterval) -> Bool? {
        switch input {
        case .otherKey:
            reset()
        case .shiftChanged:
            break // Shift may be pressed/released around the taps
        case let .optionDown(shift, otherModifiers):
            if otherModifiers { reset(); return nil }
            downAt = time
            downWithShift = shift
        case let .optionUp(shift):
            guard let start = downAt else { return nil }
            downAt = nil
            guard time - start <= maxTapDuration else { reset(); return nil }
            let tapShift = shift || downWithShift
            if let last = lastTap, time - last.at <= maxInterval {
                lastTap = nil
                return tapShift && last.shift
            }
            lastTap = (time, tapShift)
        }
        return nil
    }

    private mutating func reset() {
        downAt = nil
        lastTap = nil
    }
}
