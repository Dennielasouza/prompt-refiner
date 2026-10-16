# Prompt Refiner

Turns the text a person selects (in Chrome or any Mac app) into an optimized prompt for ChatGPT, Claude, Gemini, Codex or Claude Code — or into a `CLAUDE.md`/`AGENTS.md` — and replaces only the selection. A local backend calls the LLM API once per refinement.

## Structure (npm workspaces)

- `shared/` — contract between extension ↔ backend ↔ desktop (`api.ts`: targets, depths, formats, kinds, limits) and `hostTargets.ts` (site → target). **Single source of truth.**
- `backend/` — Fastify (`src/server.ts`); engine in `src/engine/` (versioned instruction in `instruction.ts`, `playbooks.ts`, `adapters/`, validation in `output.ts`); Anthropic/OpenAI providers in `src/providers/`; prices in `src/config/pricing.ts`; cost report in `src/usage/`.
- `extension/` — Chrome MV3. `src/background.ts` (menus, on-demand injection, backend call), `src/content.ts` + `src/dom/editable.ts` (capture/replace the selection), `src/ui/toast.ts`.
- `desktop/` — macOS: `src/refine.ts` (CLI used by the Services), `scripts/services.mjs` (installs the Services), `helper/` (Swift menu bar app ✦: ⌥⌥ gesture, HUD, copy → refine → paste flow).

## Commands (repo root)

```bash
npm install
npm test                          # unit tests of the 3 workspaces (desktop includes Swift tests; macOS only)
npm run typecheck
npm run lint                      # Biome (lint + format check); npm run lint:fix applies safe fixes
npm run build
npm run test:e2e -w extension     # Playwright + Chromium with the real extension (npx playwright install chromium once)
npm run eval -w backend           # calls the REAL API (costs money) — use sparingly
npm run eval -w backend -- FILE   # only cases whose name contains "FILE"
npm run usage -w backend          # average cost per mode (-- --detalhes, -- --days 7)
```

Local install (macOS):

```bash
npm run install-service -w backend    # backend as a LaunchAgent (always on)
npm run install-services -w desktop   # macOS Services (⌃⌥⌘R / ⌃⌥⌘P)
npm run install-hotkey -w desktop     # ✦ helper for the ⌥⌥ gesture — see the Accessibility rule
```

Extension: `npm run build -w extension` → reload `extension/dist` in `chrome://extensions`. Without the reload, Chrome keeps the previous build's service worker (and menus) but injects the new `content.js` from disk; the background detects the build mismatch (`build` field of the capture) and calls `chrome.runtime.reload()` when the operation ends.

## Rules — never break

- **Never log, store or print prompt text** (neither the selection nor the result). Logs carry metadata only; a test enforces it (`backend/test/server.test.ts`).
- **Never print or display `backend/.env`** (it holds a real API key). Only `install-service` copies it, to `~/Library/Application Support/PromptRefiner/backend/.env` (mode 600).
- **Don't rebuild/reinstall the ✦ helper (`desktop/helper`) without need, and always warn the user first.** It is ad-hoc signed: every build is "another app" for macOS and the user must **remove (−) and re-add** Prompt Refiner under Accessibility (toggling off/on is not enough).
- Background → content messages: new fields are **optional** in the content script (`messages.ts`); an old background still running talks to the new content script. Requiring a new field once broke the right-click menu.
- Don't add extension permissions (only `contextMenus`, `activeTab`, `scripting`, `storage`; no `host_permissions` in the production build). Test hooks only inside `if (__E2E__)`; check `grep __promptRefinerTest extension/dist/*.js` is empty.
- LLM output is untrusted: `textContent` only, never `innerHTML`/`eval`; always validate (`output.ts`, `isRefineResponse`).
- On failure, **the user's text must not change**. macOS Services: on error `refine.mjs` prints nothing and exits 1 (returning the original text made Electron apps reformat paragraphs).
- User-facing strings in **Brazilian Portuguese** (i18n is on the roadmap).
- Provider `claude-cli` (`backend/src/providers/claudeCli.ts`) runs `claude -p` on the owner's Claude subscription (no API credits). Keep it isolated: prompt text on **stdin only** (never argv), minimal child env (**never forward `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL`** — in `-p` an API key overrides the subscription login), neutral cwd `~/Library/Application Support/PromptRefiner/claude-cli`, `--safe-mode --tools "" --strict-mcp-config --setting-sources "" --no-session-persistence`. Its calls cost US$ 0 in the logs (`callCostUsd`). Personal use only: never route other people's requests through a Claude.ai login. The service plist uses `ProcessType Standard` — `Background` throttled the CLI start-up from ~0.3 s to ~4–5 s.
- Defaults: `claude-sonnet-5-5` with `PROMPT_COMPILER_EFFORT=medium`, chosen from eval data (2026-10-08: same quality as `high` on 18 cases + side-by-side review, ~13% fewer output tokens, worst case 7 s vs 9 s). Don't change model/effort without eval numbers. Product goal: prompt quality first, then token/time savings — any optimization that lowers quality is rejected.

## Prompt engine

- One LLM call with structured output; the system prompt is assembled with stable (cacheable) parts first and the destination part last: core → depth (or instruction-file block) → format → destination. The first three are cached: the core for 1 h, balanced depth/format for 1 h, deep/instruction-file blocks for 5 min (use is sporadic; 1 h writes cost 2× input, so only frequently reused blocks get them). `pricing.ts` bills 1 h writes separately.
- `format: markdown` (default) forbids XML tags and structures with Markdown; `auto` lets the destination adapter decide. `kind: claude-md | agents-md` changes the job: the notes become the content of the instruction file (no invented commands; a missing essential command becomes a `TODO:` line).
- Answer economy (`<answer_economy>`): every request in the refined prompt becomes content the destination writes. Method that changes HOW the task is done is welcome; extra WHAT (sub-topic lists, examples, tips, "what would change the answer") only when asked. "Return only X" is for transformations of given text, not for new content. Measured on 2026-10-14 (blind answer test, 10 cases): answers −15% (balanced) and −32% (deep) with equal or better scores.
- Core rule: **never invent facts** about the person's situation (including tone/style preferences they didn't express); deep mode may add **method** (criteria, process, format, verification) from `playbooks.ts`, fully only at complexity ≥ 3 (at 1–2 it behaves like balanced plus at most one method line). Trivial requests stay short.
- The structured output has no free-text fields besides `refinedPrompt` (warnings are short codes) — every output token costs time and money.
- When changing the instruction: bump `COMPILER_VERSION`, run tests and the eval, and redeploy (`npm run install-service -w backend`); check the version with `curl -sS http://127.0.0.1:8787/api/health`.
- Keep in sync: `shared/api.ts` ↔ `desktop/src/apps.ts` ↔ `desktop/helper/RefineCore.swift` (Swift tests flag drift).

## How to verify a change

- Backend: `npm test -w backend && npm run typecheck -w backend`; engine changes → eval.
- Extension: unit + `test:e2e` (run twice) + `build`; delete `extension/dist-e2e`.
- Desktop: `npm test -w desktop` (includes Swift). The Services flow can be tested headlessly with `NSPerformService` (a tiny Swift tool).
- Installed backend: `launchctl print gui/$(id -u)/com.promptrefiner.backend`, log at `~/Library/Logs/PromptRefiner/backend.log`.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, e2e and the macOS desktop tests.

## Known pitfalls

- If the repo lives in a TCC-protected folder (`~/Desktop`, `~/Documents`, `~/Downloads`), launchd processes hang when reading files there. That's why the backend service runs from `~/Library/Application Support/PromptRefiner/`. Never point LaunchAgents into the repo.
- Files in synced/protected folders get extended attributes that break `codesign`: the ✦ helper is assembled and signed in a temp folder.
- `npm run dev` and the installed service compete for port 8787 — don't run both.
- `install-service` restricts CORS to the unpacked extension's id (derived from the absolute path of `extension/dist`); moving the repo requires running it again.
- Rich editors (ProseMirror/Tiptap, Quill, Lexical): replace via a synthetic `paste` event, wait for `selectionchange` before pasting and confirm the selection is the expected one; text offsets: start binds forward, end binds backward (`rangeFromOffsets`).
- The Claude desktop app uses ⌥⌥ for its quick entry by default — users must disable it (Claude › Settings › System) to use ⌥⌥ here.
- ⌥⌥ sends ⌘C/⌘V by key position (works with ABNT2/US layouts, not Dvorak).
- Service names with accents: edit the `pbs` preferences via JSON (`services.mjs`), never with `defaults -dict-add`.
