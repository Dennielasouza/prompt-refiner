import Foundation

// Pure logic of the ⌥⌥ refinement (no AppKit) so it can be unit-tested: target mapping, input
// validation, request body, response parsing and error → message mapping (pt-BR).
// Mirrors shared/api.ts (contract), desktop/src/apps.ts (app → target) and
// desktop/src/messages.ts (error texts). Keep them in sync; Tests/main.swift checks the first two.

enum RefineTarget: String, CaseIterable {
    case generic, chatgpt, claude, gemini, codex
    case claudeCode = "claude-code"

    /// Display name (shared/api.ts TARGET_LABELS); nil for the generic target.
    var label: String? {
        switch self {
        case .generic: return nil
        case .chatgpt: return "ChatGPT"
        case .claude: return "Claude"
        case .gemini: return "Gemini"
        case .codex: return "Codex"
        case .claudeCode: return "Claude Code"
        }
    }
}

enum RefineDepth: String {
    case balanced, deep
}

/// Why a refinement did not happen. The user's text is never touched in any of these cases.
enum RefineFailure: Error, Equatable {
    case emptySelection
    case tooLong(Int)
    case unavailable          // nothing listening at the endpoint
    case timedOut             // no answer within RefineCore.requestTimeout
    case network(String)      // other transport error (description from URLError)
    case backend(code: String?, status: Int)
    case invalidResponse

    /// HUD title.
    var title: String {
        self == .emptySelection ? "Selecione o prompt que deseja refinar." : "Não foi possível refinar o prompt."
    }

    /// HUD second line (nil when the title says it all).
    func detail(endpoint: String) -> String? {
        switch self {
        case .emptySelection:
            return nil
        case let .tooLong(count):
            return "A seleção tem \(RefineCore.formatCount(count)) caracteres; o limite é \(RefineCore.formatCount(RefineCore.maxInputChars))."
        case .unavailable:
            return "Backend indisponível em \(endpoint)."
        case .timedOut:
            return "Tempo esgotado: o backend não respondeu em \(Int(RefineCore.requestTimeout)) s."
        case let .network(description):
            return "Falha de comunicação com \(endpoint): \(description)"
        case let .backend(code, status):
            if let code, let text = RefineCore.backendErrorDetails[code] { return text }
            return "O backend respondeu com erro \(code ?? "HTTP \(status)")."
        case .invalidResponse:
            return "O backend retornou uma resposta inválida."
        }
    }
}

enum RefineCore {
    /// shared/api.ts MAX_INPUT_CHARS (counted in UTF-16 units, like JavaScript's String.length).
    static let maxInputChars = 12_000
    static let defaultEndpoint = "http://127.0.0.1:8787"
    static let requestTimeout: TimeInterval = 55

    /// Frontmost app bundle id → target. KEEP IN SYNC with APP_TARGETS in desktop/src/apps.ts.
    /// Unknown apps get the generic target; Codex and Claude Code are never inferred.
    static let appTargets: [String: RefineTarget] = [
        "com.anthropic.claudefordesktop": .claude,
        "com.openai.chat": .chatgpt,
        // The current ChatGPT desktop app ships under this id (ChatGPT + Codex in one app).
        "com.openai.codex": .chatgpt,
        "com.google.Chrome.app.gemini": .gemini,
    ]

    /// Backend error code → explanation. KEEP IN SYNC with desktop/src/messages.ts.
    static let backendErrorDetails: [String: String] = [
        "not_configured": "O backend não está configurado (verifique o .env).",
        "timeout": "O modelo demorou demais para responder. Tente novamente.",
        "rate_limited": "O provedor de IA está sobrecarregado. Tente em instantes.",
        "auth": "O backend não conseguiu autenticar no provedor de IA (verifique a chave de API).",
        "refusal": "O modelo se recusou a refinar este texto.",
        "invalid_output": "O modelo retornou uma resposta inválida. Tente novamente.",
        "upstream": "Falha ao falar com o provedor de IA. Tente novamente.",
        "text_too_long": "A seleção é longa demais.",
        "empty_text": "A seleção está vazia.",
        "origin_not_allowed": "O backend recusou a requisição (origem não permitida).",
        "internal_error": "Erro interno do backend (veja o log do servidor).",
    ]

    static func target(forBundleId bundleId: String?) -> RefineTarget {
        bundleId.flatMap { appTargets[$0] } ?? .generic
    }

    /// `defaults write com.promptrefiner.hotkey endpoint <url>`; anything that is not an http(s)
    /// URL falls back to the default. Trailing slashes are removed.
    static func normalizedEndpoint(_ raw: String?) -> String {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return defaultEndpoint }
        while value.hasSuffix("/") { value.removeLast() }
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return defaultEndpoint }
        return value
    }

    /// Locale hint accepted by the backend (^[A-Za-z0-9-]*$, ≤ 35 chars): "pt_BR" → "pt-BR".
    static func languageTag(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        let tag = String(raw.prefix { allowed.contains($0) }.prefix(35)).replacingOccurrences(of: "_", with: "-")
        return tag.isEmpty ? nil : tag
    }

    /// nil when the copied selection can be refined.
    static func problem(withSelection text: String?) -> RefineFailure? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .emptySelection }
        let count = text.utf16.count
        return count > maxInputChars ? .tooLong(count) : nil
    }

    /// JSON body of POST /api/refine (only fields allowed by the backend schema).
    static func requestBody(text: String, target: RefineTarget, depth: RefineDepth, language: String?) -> Data {
        var body: [String: String] = ["text": text, "target": target.rawValue, "depth": depth.rawValue]
        if let language = languageTag(language) { body["language"] = language }
        // Cannot fail: [String: String] is always valid JSON.
        return (try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])) ?? Data()
    }

    /// Validates the backend answer; returns the refined prompt or why it is unusable.
    static func parseResponse(status: Int, body: Data?) -> Result<String, RefineFailure> {
        let json = body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        guard (200..<300).contains(status) else {
            let code = (json?["error"] as? [String: Any])?["code"] as? String
            return .failure(.backend(code: code, status: status))
        }
        guard let prompt = json?["refinedPrompt"] as? String,
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              prompt.utf16.count <= 40_000,
              let target = json?["target"] as? String, RefineTarget(rawValue: target) != nil
        else { return .failure(.invalidResponse) }
        return .success(prompt)
    }

    static func failure(fromTransportError error: Error) -> RefineFailure {
        guard let urlError = error as? URLError else { return .network(error.localizedDescription) }
        switch urlError.code {
        case .timedOut:
            return .timedOut
        case .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet, .dnsLookupFailed:
            return .unavailable
        default:
            return .network(urlError.localizedDescription)
        }
    }

    /// Text to paste: the refined prompt, keeping the selection's trailing line breaks
    /// (common when whole lines are selected).
    static func finalText(refined: String, original: String) -> String {
        let trailing = original.reversed().prefix { $0 == "\n" || $0 == "\r\n" }
        return refined + String(trailing.reversed())
    }

    static func progressMessage(target: RefineTarget, depth: RefineDepth) -> String {
        let base = target.label.map { "Refinando para \($0)" } ?? "Refinando prompt"
        return base + (depth == .deep ? " (profundo)" : "") + "..."
    }

    static func successMessage(target: RefineTarget, depth: RefineDepth) -> String {
        let base = target.label.map { "Prompt refinado para \($0)" } ?? "Prompt refinado"
        return base + (depth == .deep ? " (profundo)" : "") + " — ⌘Z desfaz"
    }

    /// 12000 → "12.000" (pt-BR grouping, locale-independent).
    static func formatCount(_ n: Int) -> String {
        var digits = Array(String(n))
        var i = digits.count - 3
        while i > 0 { digits.insert(".", at: i); i -= 3 }
        return String(digits)
    }
}
