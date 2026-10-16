// Compiled together with ../*.swift (pure logic, no AppKit) by `npm run test:helper -w desktop`.
// Arguments (passed by scripts/helper.mjs): paths of desktop/src/apps.ts, shared/api.ts and
// desktop/src/messages.ts, to check the Swift copies are in sync with the TypeScript ones.
import Foundation

var failures = 0
func check(_ name: String, _ condition: Bool) {
    print(condition ? "✔ \(name)" : "✖ \(name)")
    if !condition { failures += 1 }
}

func run(_ events: [(TapDetector.Input, TimeInterval)]) -> [Bool] {
    var d = TapDetector()
    return events.compactMap { d.handle($0.0, at: $0.1) }
}

let down = TapDetector.Input.optionDown(shift: false, otherModifiers: false)
let up = TapDetector.Input.optionUp(shift: false)
let downS = TapDetector.Input.optionDown(shift: true, otherModifiers: false)
let upS = TapDetector.Input.optionUp(shift: true)

check("double tap → balanced", run([(down, 0), (up, 0.08), (down, 0.20), (up, 0.28)]) == [false])
check("shift held during both taps → deep", run([(downS, 0), (upS, 0.08), (downS, 0.20), (upS, 0.28)]) == [true])
check("shift only on one tap → balanced", run([(downS, 0), (upS, 0.08), (down, 0.20), (up, 0.28)]) == [false])
check("single tap → nothing", run([(down, 0), (up, 0.08)]).isEmpty)
check("taps too far apart → nothing", run([(down, 0), (up, 0.08), (down, 0.70), (up, 0.78)]).isEmpty)
check("long press → nothing", run([(down, 0), (up, 0.6), (down, 0.7), (up, 0.78)]).isEmpty)
check("key typed between taps → nothing (e.g. ⌥ shortcuts)", run([(down, 0), (up, 0.08), (.otherKey, 0.1), (down, 0.20), (up, 0.28)]).isEmpty)
check("⌘ or ⌃ with ⌥ → nothing", run([(down, 0), (up, 0.08), (.optionDown(shift: false, otherModifiers: true), 0.2), (up, 0.28)]).isEmpty)
check("triple tap fires once", run([(down, 0), (up, 0.08), (down, 0.2), (up, 0.28), (down, 0.4), (up, 0.48)]) == [false])
check("two separate double taps fire twice", run([(down, 0), (up, 0.08), (down, 0.2), (up, 0.28), (down, 2), (up, 2.08), (down, 2.2), (up, 2.28)]) == [false, false])


// MARK: - RefineCore

func pairs(_ source: String, block marker: String) -> [String: String] {
    guard let start = source.range(of: marker), let end = source.range(of: "};", range: start.upperBound..<source.endIndex) else { return [:] }
    let body = String(source[start.upperBound..<end.lowerBound])
    let regex = try! NSRegularExpression(pattern: #"^\s*"?([A-Za-z0-9_.\-]+)"?:\s*"([^"]+)",?\s*(//.*)?$"#, options: [.anchorsMatchLines])
    var result: [String: String] = [:]
    for m in regex.matches(in: body, range: NSRange(body.startIndex..., in: body)) {
        result[String(body[Range(m.range(at: 1), in: body)!])] = String(body[Range(m.range(at: 2), in: body)!])
    }
    return result
}
let args = CommandLine.arguments
if args.count >= 4, let appsTs = try? String(contentsOfFile: args[1], encoding: .utf8),
   let apiTs = try? String(contentsOfFile: args[2], encoding: .utf8),
   let messagesTs = try? String(contentsOfFile: args[3], encoding: .utf8) {
    let tsTargets = pairs(appsTs, block: "APP_TARGETS: Record<string, Target> = {")
    check("app → target map is in sync with desktop/src/apps.ts", !tsTargets.isEmpty && tsTargets == RefineCore.appTargets.mapValues(\.rawValue))
    check("MAX_INPUT_CHARS is in sync with shared/api.ts", apiTs.contains("MAX_INPUT_CHARS = \(RefineCore.maxInputChars / 1000)_000;"))
    let tsMessages = pairs(messagesTs, block: "BACKEND_ERROR_DETAILS: Record<string, string> = {")
    check("backend error texts are in sync with desktop/src/messages.ts", !tsMessages.isEmpty && tsMessages == RefineCore.backendErrorDetails)
} else {
    check("sync sources readable (pass apps.ts, api.ts, messages.ts paths)", false)
}

check("Claude desktop → claude", RefineCore.target(forBundleId: "com.anthropic.claudefordesktop") == .claude)
check("ChatGPT desktop (both ids) → chatgpt",
      RefineCore.target(forBundleId: "com.openai.chat") == .chatgpt && RefineCore.target(forBundleId: "com.openai.codex") == .chatgpt)
check("Gemini PWA → gemini", RefineCore.target(forBundleId: "com.google.Chrome.app.gemini") == .gemini)
check("unknown / nil app → generic", RefineCore.target(forBundleId: "com.tinyspeck.slackmacgap") == .generic && RefineCore.target(forBundleId: nil) == .generic)
check("never infers codex or claude-code", ["com.apple.Terminal", "com.googlecode.iterm2", "com.microsoft.VSCode", "com.todesktop.230313mzl4w4u92"]
    .allSatisfy { RefineCore.target(forBundleId: $0) == .generic } && !RefineCore.appTargets.values.contains(.codex) && !RefineCore.appTargets.values.contains(.claudeCode))
check("all targets round-trip the contract names", RefineTarget.allCases.map(\.rawValue) == ["generic", "chatgpt", "claude", "gemini", "codex", "claude-code"])

check("empty / whitespace selection → emptySelection", [nil, "", "   ", "\n\t \n"].allSatisfy { RefineCore.problem(withSelection: $0) == .emptySelection })
check("12000 chars ok, 12001 too long", RefineCore.problem(withSelection: String(repeating: "a", count: 12_000)) == nil
    && RefineCore.problem(withSelection: String(repeating: "a", count: 12_001)) == .tooLong(12_001))
check("length counted in UTF-16 units like JS", RefineCore.problem(withSelection: String(repeating: "😀", count: 6_001)) == .tooLong(12_002))

let body = try! JSONSerialization.jsonObject(with: RefineCore.requestBody(text: "oi\nmundo", target: .claudeCode, depth: .deep, language: "pt_BR")) as! [String: String]
check("request body has exactly the contract fields", body == ["text": "oi\nmundo", "target": "claude-code", "depth": "deep", "language": "pt-BR"])
let noLang = try! JSONSerialization.jsonObject(with: RefineCore.requestBody(text: "x", target: .generic, depth: .balanced, language: "@@")) as! [String: String]
check("invalid language is omitted", noLang == ["text": "x", "target": "generic", "depth": "balanced"])
check("language tag sanitized", RefineCore.languageTag("pt-BR") == "pt-BR" && RefineCore.languageTag("en_US@rg=brzzzz") == "en-US"
    && RefineCore.languageTag(nil) == nil && RefineCore.languageTag(String(repeating: "a", count: 50))?.count == 35)

check("endpoint default / override / invalid", RefineCore.normalizedEndpoint(nil) == "http://127.0.0.1:8787"
    && RefineCore.normalizedEndpoint("  http://localhost:9000/ ") == "http://localhost:9000"
    && RefineCore.normalizedEndpoint("https://example.test/base//") == "https://example.test/base"
    && RefineCore.normalizedEndpoint("ftp://x") == "http://127.0.0.1:8787"
    && RefineCore.normalizedEndpoint("localhost:8787") == "http://127.0.0.1:8787"
    && RefineCore.normalizedEndpoint("") == "http://127.0.0.1:8787")

func json(_ s: String) -> Data { Data(s.utf8) }
check("valid response → refined prompt",
      RefineCore.parseResponse(status: 200, body: json(#"{"refinedPrompt":"Linha 1\n\nLinha 2","target":"claude","depth":"balanced"}"#)) == .success("Linha 1\n\nLinha 2"))
check("blank refinedPrompt → invalidResponse", RefineCore.parseResponse(status: 200, body: json(#"{"refinedPrompt":"  \n","target":"claude"}"#)) == .failure(.invalidResponse))
check("missing / unknown target → invalidResponse", RefineCore.parseResponse(status: 200, body: json(#"{"refinedPrompt":"x"}"#)) == .failure(.invalidResponse)
    && RefineCore.parseResponse(status: 200, body: json(#"{"refinedPrompt":"x","target":"auto"}"#)) == .failure(.invalidResponse))
check("non-JSON / empty 200 → invalidResponse", RefineCore.parseResponse(status: 200, body: json("<html>")) == .failure(.invalidResponse)
    && RefineCore.parseResponse(status: 200, body: nil) == .failure(.invalidResponse))
check("refinedPrompt of wrong type → invalidResponse", RefineCore.parseResponse(status: 200, body: json(#"{"refinedPrompt":42,"target":"claude"}"#)) == .failure(.invalidResponse))
check("error body → backend code", RefineCore.parseResponse(status: 503, body: json(#"{"error":{"code":"not_configured","message":"x"}}"#)) == .failure(.backend(code: "not_configured", status: 503)))
check("non-JSON error → backend status", RefineCore.parseResponse(status: 502, body: json("Bad Gateway")) == .failure(.backend(code: nil, status: 502)))

let ep = "http://127.0.0.1:8787"
check("unavailable message names the endpoint", RefineFailure.unavailable.detail(endpoint: ep) == "Backend indisponível em http://127.0.0.1:8787.")
check("timeout message", RefineFailure.timedOut.detail(endpoint: ep) == "Tempo esgotado: o backend não respondeu em 55 s.")
check("known backend codes are explained", RefineFailure.backend(code: "not_configured", status: 503).detail(endpoint: ep) == "O backend não está configurado (verifique o .env)."
    && RefineFailure.backend(code: "rate_limited", status: 503).detail(endpoint: ep) == "O provedor de IA está sobrecarregado. Tente em instantes."
    && RefineFailure.backend(code: "timeout", status: 504).detail(endpoint: ep) == "O modelo demorou demais para responder. Tente novamente.")
check("unknown backend code / plain status", RefineFailure.backend(code: "weird", status: 500).detail(endpoint: ep) == "O backend respondeu com erro weird."
    && RefineFailure.backend(code: nil, status: 502).detail(endpoint: ep) == "O backend respondeu com erro HTTP 502.")
check("too long message", RefineFailure.tooLong(13_450).detail(endpoint: ep) == "A seleção tem 13.450 caracteres; o limite é 12.000.")
check("titles", RefineFailure.emptySelection.title == "Selecione o prompt que deseja refinar." && RefineFailure.emptySelection.detail(endpoint: ep) == nil
    && RefineFailure.unavailable.title == "Não foi possível refinar o prompt.")
check("transport errors → failures", RefineCore.failure(fromTransportError: URLError(.cannotConnectToHost)) == .unavailable
    && RefineCore.failure(fromTransportError: URLError(.timedOut)) == .timedOut
    && RefineCore.failure(fromTransportError: URLError(.networkConnectionLost)) == .unavailable)
if case .network = RefineCore.failure(fromTransportError: URLError(.badServerResponse)) { check("other URLError → network", true) } else { check("other URLError → network", false) }

check("final text keeps the selection's trailing newlines", RefineCore.finalText(refined: "A\n\nB", original: "x\n") == "A\n\nB\n"
    && RefineCore.finalText(refined: "A", original: "x") == "A" && RefineCore.finalText(refined: "A", original: "x\r\n\n") == "A\r\n\n")
check("progress messages", RefineCore.progressMessage(target: .claude, depth: .balanced) == "Refinando para Claude..."
    && RefineCore.progressMessage(target: .generic, depth: .balanced) == "Refinando prompt..."
    && RefineCore.progressMessage(target: .chatgpt, depth: .deep) == "Refinando para ChatGPT (profundo)...")
check("success messages", RefineCore.successMessage(target: .claude, depth: .balanced) == "Prompt refinado para Claude — ⌘Z desfaz"
    && RefineCore.successMessage(target: .generic, depth: .deep) == "Prompt refinado (profundo) — ⌘Z desfaz")
check("count formatting", RefineCore.formatCount(12_000) == "12.000" && RefineCore.formatCount(999) == "999" && RefineCore.formatCount(1_234_567) == "1.234.567")

// MARK: - RefineClient (real URLSession against a closed local port)

let done = DispatchSemaphore(value: 0)
var clientResult: Result<String, RefineFailure>?
RefineClient(endpoint: "http://127.0.0.1:9", timeout: 5).refine(text: "x", target: .generic, depth: .balanced, language: "pt-BR") {
    clientResult = $0
    done.signal()
}
check("closed port → unavailable (text untouched path)", done.wait(timeout: .now() + 10) == .success && clientResult == .failure(.unavailable))

exit(failures == 0 ? 0 : 1)
