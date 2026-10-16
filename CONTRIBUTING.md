# Contributing to Prompt Refiner

Thanks for helping! Issues and pull requests are welcome — in English or Portuguese.

## Ground rules

The product only makes sense if it helps people who don't know how to write prompts get **better answers while spending fewer tokens, without losing quality**. Changes to the prompt engine are judged by that: quality first, then cost and speed.

- **Never log, store or print prompt text** (the selection or the result). Logs carry metadata only — there is a test for it.
- **Never invent facts** in refined prompts. The engine may add *method* (criteria, structure, checks), never facts about the person's situation.
- **On failure, the user's text must not change.**
- Don't add browser-extension permissions (only `contextMenus`, `activeTab`, `scripting`, `storage`; no `host_permissions` in the production build).
- LLM output is untrusted: use `textContent`, never `innerHTML`/`eval`.
- `shared/api.ts` is the single source of truth for the API contract. New fields must be **optional** for older clients (an old extension service worker can talk to a new content script).

`CLAUDE.md` has the full list of rules and known pitfalls — read it before larger changes (it's also what coding agents read).

## Setup

```bash
npm install
cp backend/.env.example backend/.env   # add your own API key and model
npm run dev                            # backend on http://127.0.0.1:8787
npm run build -w extension             # then load extension/dist in chrome://extensions
```

## Before opening a PR

```bash
npm run lint                           # npm run lint:fix fixes formatting automatically
npm run typecheck
npm test                               # macOS: all workspaces (desktop tests compile Swift)
npm test -w backend && npm test -w extension   # Linux/Windows
npx playwright install chromium        # once
npm run test:e2e -w extension
```

- Engine changes (`backend/src/engine/`): bump `COMPILER_VERSION` and run `npm run eval -w backend` with your own key (it calls the real API and costs a few cents). Include the before/after numbers in the PR.
- Keep user-facing strings in Brazilian Portuguese for now (i18n is on the roadmap).
- Keep PRs focused; add or update tests for behavior changes.
