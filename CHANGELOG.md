# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The installer now always installs in one place.** It used to install wherever the script
  happened to sit, so running it from a GitHub ZIP in `~/Downloads` (or from a temp folder)
  built the extension there, printed every `✓`, and left the person unable to find
  `extension/dist` in Chrome. The destination (`~/prompt-refiner`, or `PROMPT_REFINER_DIR`) is
  now resolved and printed before any work: a copy outside it is moved to the destination and
  the install continues from there, or, when something is already installed there, the
  installer stops and shows the options instead of silently picking one.
- **A re-run no longer leaves the previous version running.** When a backend was already
  answering on the port, the installer skipped `install-service` entirely — so the new code
  was never deployed and the extension's folder was never allowed through CORS, with success
  on screen. The service is now reinstalled on every run, and the installer compares the
  `compilerVersion` it gets from `/api/health` with the one in the source it just built.
- **A busy port is caught up front.** If another program (typically a forgotten `npm run dev`)
  holds the port, the installer stops before doing any work and names the PID, instead of
  testing against someone else's server or failing late.
- **No more mid-run dialogs or shared log files.** The Apple command line tools are checked
  before anything calls `git` or `swiftc` (which pop a system dialog and wait for a click when
  missing), unknown options are rejected instead of ignored, failures that don't stop the
  install are collected and shown at the end (with a non-zero exit), and the logs of a run go
  to a private temporary folder instead of predictable `/tmp/pr-*.log` names.

## [0.1.0] - 2026-10-15

First public release. Source only: the extension is loaded unpacked, and the backend
runs on the user's own machine.

### Added

- **Prompt engine.** One LLM call per refinement, with structured output, covering intent
  analysis, task classification, complexity scoring (1–5), destination adaptation and
  generation, followed by a deterministic quality gate. Two depths: *balanced* organizes and
  clarifies what the person wrote; *deep* also adds method (success criteria, process, output
  contract, uncertainty handling, a final check) drawn from per-task playbooks, applied in full
  only to complex tasks. Neither depth invents facts about the person's situation.
- **Destinations.** ChatGPT, Claude, Gemini, Codex, Claude Code, a generic target, and an
  automatic mode that resolves the destination from the site (`chatgpt.com`,
  `chat.openai.com`, `claude.ai`, `gemini.google.com`, `aistudio.google.com`) or from the
  frontmost macOS app. Codex and Claude Code are never inferred.
- **Output formats.** Markdown by default (no XML tags), or `auto`, which lets the
  destination adapter decide.
- **Instruction files.** Loose project notes can be turned into the contents of a `CLAUDE.md`
  or an `AGENTS.md`, built only from what the notes contain; anything essential that is
  missing becomes a `TODO:` line.
- **Three engine options**, configured in `backend/.env`: `claude-cli`, which runs the
  official Claude Code CLI in headless mode on the person's own Claude subscription with no
  API key and no API cost; `anthropic`; and `openai`. No model is hardcoded —
  `PROMPT_COMPILER_MODEL` is always required.
- **Local backend.** Fastify on `127.0.0.1:8787` by default, with `POST /api/refine` and
  `GET /api/health`, strict input validation, a 12,000-character input limit, a 64 KB body
  limit, JSON-only parsing, and CORS restricted to `chrome-extension://` origins.
- **Chrome MV3 extension.** Context menus for balanced, deep and instruction-file
  refinements, shown inside editable fields only; an `Alt+Shift+R` shortcut that uses the
  default destination and depth; a settings page with a connection test and the last recorded
  failure; and an in-page notice with **Undo** and, when replacement is not safe,
  **Copy prompt**. Permissions are limited to `contextMenus`, `activeTab`, `scripting` and
  `storage`, with no `host_permissions` and no remotely hosted code.
- **In-place replacement** for `<input>`, `<textarea>` and `contenteditable` editors. The
  selection is captured synchronously on click and verified again before writing; rich
  editors (ProseMirror/Tiptap, Lexical, Quill, Slate, Draft) are fed through a synthetic
  `paste` event, with `execCommand("insertText")` and direct DOM editing as fallbacks. If the
  text moved or the editor rejects the insertion, nothing is modified. Password fields are
  refused before any call is made.
- **macOS integration.** 14 macOS Services (⌃⌥⌘R balanced and ⌃⌥⌘P deep in automatic mode,
  a fixed-destination pair per destination, plus `CLAUDE.md` and `AGENTS.md` generation), and
  an ad-hoc-signed ✦ menu bar app that refines on a double tap of ⌥ Option (⇧ + ⌥⌥ for deep)
  by copying the selection, calling the backend and pasting only on success, in the same app.
  On failure the Services print nothing and exit non-zero, so the app keeps the original text.
- **Backend as a macOS LaunchAgent** (`npm run install-service -w backend`): a self-contained
  bundle outside the repository, a copy of `.env` at mode 600, and CORS narrowed to the
  unpacked extension's own ID.
- **Cost report** (`npm run usage -w backend`), with averages per depth, `--days` and
  `--detalhes` options. Subscription calls are reported separately at US$ 0 alongside the
  value they would have cost on the API.
- **Privacy guarantees enforced in code.** Prompt text is never logged — logs carry metadata
  only (destination, depth, format, task type, complexity, character counts, timings, tokens,
  estimated cost), and a test enforces it. Model output is validated and inserted as plain
  text only, never as HTML. For the `claude-cli` engine, prompt text goes through stdin and
  never through argv, the child process gets a minimal environment with no API keys
  forwarded, and the CLI runs in a neutral working directory with no tools, MCP servers,
  settings sources or session persistence.
- **Tests and tooling.** Unit tests for the three workspaces (including Swift tests for the
  macOS helper), a Playwright end-to-end suite that drives the real extension against a real
  backend with a deterministic fake provider, an 18-case live eval of the engine, Biome for
  lint and formatting, and TypeScript type checking.
- **Documentation.** `README.md` and `README.pt-BR.md`, `PRIVACY.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md` and `CLAUDE.md` (the rules coding agents read).

### Known limitations

- Not published on the Chrome Web Store; the extension must be loaded unpacked in developer
  mode. A store release is planned as a separate version.
- The local backend must be running.
- The desktop integration is macOS-only.
- The interface is in Brazilian Portuguese only.
- Google Docs, `chrome://` pages, the Chrome Web Store, PDFs and
  `input type="email"` / `number` are not supported.
- Undo does not survive a page reload, by design.

[Unreleased]: https://github.com/Dennielasouza/prompt-refiner/commits/main
[0.1.0]: https://github.com/Dennielasouza/prompt-refiner/commits/main
