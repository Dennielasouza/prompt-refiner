/**
 * Service worker: context menu → inject content script (activeTab) → capture selection →
 * call the backend → send the refined prompt (or CLAUDE.md/AGENTS.md content) back to the same frame.
 * The backend endpoint is the only network destination; no API keys live here.
 */
import {
  type Depth,
  KINDS,
  type OutputKind,
  REQUESTED_TARGETS,
  type RefineRequestBody,
  type RequestedTarget,
  TARGET_LABELS,
} from "../../shared/api.js";
import { REQUEST_TIMEOUT_MS, RefineError, requestRefinement, timeoutError } from "./api.js";
import {
  BADGE_COLOR,
  BADGE_TEXT,
  describeInjectionError,
  type FailureKind,
  failureTitle,
  LAST_FAILURE_KEY,
  type LastFailure,
} from "./feedback.js";
import { type CaptureResponse, isCaptureResponse, isToBackground, type ToContent } from "./messages.js";
import { REGISTRATION_KEY, resetRegistrationInPage } from "./registration.js";
import { getSettings } from "./settings.js";

/** One submenu per depth; ids are "<parent>:<target>". */
const MENU_PARENTS: Record<Depth, { id: string; title: string }> = {
  balanced: { id: "prompt-refiner", title: "Refinar prompt" },
  deep: { id: "prompt-refiner-deep", title: "Refinar prompt (profundo)" },
};
const COMMAND_DEFAULT = "refine-default";

/** Third submenu: agent instruction files; ids are "<parent>:<kind>". */
const FILE_MENU = { id: "prompt-refiner-file", title: "Gerar arquivo de instruções" };
const FILE_ITEMS: Array<[Exclude<OutputKind, "prompt">, string]> = [
  ["claude-md", "CLAUDE.md (Claude Code)"],
  ["agents-md", "AGENTS.md (Codex e outros)"],
];
/** Instruction files imply their target (the backend enforces the same mapping). */
const FILE_TARGET: Record<Exclude<OutputKind, "prompt">, RequestedTarget> = { "claude-md": "claude-code", "agents-md": "codex" };

/** Order and labels of the submenu. */
const MENU_ITEMS: Array<[RequestedTarget, string]> = [
  ["auto", `✨ ${TARGET_LABELS.auto}`],
  ["chatgpt", TARGET_LABELS.chatgpt],
  ["claude", TARGET_LABELS.claude],
  ["gemini", TARGET_LABELS.gemini],
  ["codex", TARGET_LABELS.codex],
  ["claude-code", TARGET_LABELS["claude-code"]],
];

function createMenus(): void {
  for (const parent of Object.values(MENU_PARENTS)) {
    chrome.contextMenus.create({ id: parent.id, title: parent.title, contexts: ["editable"] });
    for (const [target, title] of MENU_ITEMS) {
      chrome.contextMenus.create({ id: `${parent.id}:${target}`, parentId: parent.id, title, contexts: ["editable"] });
    }
  }
  chrome.contextMenus.create({ id: FILE_MENU.id, title: FILE_MENU.title, contexts: ["editable"] });
  for (const [kind, title] of FILE_ITEMS) {
    chrome.contextMenus.create({ id: `${FILE_MENU.id}:${kind}`, parentId: FILE_MENU.id, title, contexts: ["editable"] });
  }
}

function parseMenuId(id: string | number): { target: RequestedTarget; depth: Depth; kind: OutputKind } | null {
  const [parentId, target] = String(id).split(":");
  if (parentId === FILE_MENU.id) {
    const kind = FILE_ITEMS.find(([k]) => k === target)?.[0];
    return kind ? { target: FILE_TARGET[kind], depth: "balanced", kind } : null;
  }
  const depth = (Object.keys(MENU_PARENTS) as Depth[]).find((d) => MENU_PARENTS[d].id === parentId);
  return depth && REQUESTED_TARGETS.includes(target as RequestedTarget)
    ? { target: target as RequestedTarget, depth, kind: "prompt" }
    : null;
}

const SUPERSEDED = "Um novo refinamento foi iniciado nesta aba. Nada foi alterado aqui.";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

// --- In-flight requests ------------------------------------------------------

const inflight = new Map<string, AbortController>();
const opByTab = new Map<number, string>();
let keepAlive: ReturnType<typeof setInterval> | undefined;

/** Long LLM calls can exceed the worker's idle window; a cheap API call keeps it alive. */
function updateKeepAlive(): void {
  if (inflight.size > 0 && !keepAlive) {
    keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  } else if (inflight.size === 0 && keepAlive) {
    clearInterval(keepAlive);
    keepAlive = undefined;
  }
}

// --- Visible feedback when no toast can be shown ------------------------------

const DEFAULT_TITLE = chrome.runtime.getManifest().action?.default_title ?? "Prompt Refiner";

/** Remembers the last failure (reason only, never page content) for the options page. */
function recordFailure(title: string): void {
  const last: LastFailure = { title, at: Date.now() };
  void chrome.storage.session.set({ [LAST_FAILURE_KEY]: last }).catch(() => {});
}

/** Red "!" on the extension icon for this tab, with the reason in the tooltip. */
async function flagFailure(tabId: number, kind: FailureKind, reason?: string): Promise<void> {
  const title = failureTitle(kind, reason);
  recordFailure(title);
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }),
    chrome.action.setBadgeText({ tabId, text: BADGE_TEXT }),
    chrome.action.setTitle({ tabId, title }),
  ]).catch(() => {}); // tab already closed
}

// --- Stale worker after a rebuild ----------------------------------------------

/**
 * Chrome keeps running the service worker it registered when the extension was last (re)loaded,
 * while chrome.scripting reads content.js from disk on every injection. When an unpacked
 * extension is rebuilt without clicking ↻ in chrome://extensions, this worker (and its context
 * menus) is older than the files on disk. The freshly injected content script reports its build;
 * on a mismatch the extension reloads itself once nothing is in flight, so the next use runs the
 * new build (Web Store updates always reload, so this only happens with unpacked builds).
 */
let staleWorker = false;

function noteContentBuild(captured: CaptureResponse): void {
  if (captured.ok && captured.build && captured.build !== __BUILD_ID__) staleWorker = true;
}

function reloadIfStale(): void {
  if (!staleWorker) return;
  // Delay so the current operation's messages and toasts are delivered first.
  setTimeout(() => {
    if (!staleWorker || inflight.size > 0) return;
    console.info("[Prompt Refiner] Os arquivos da extensão foram atualizados no disco; recarregando a extensão.");
    chrome.runtime.reload();
  }, 1000);
}

async function clearFailure(tabId: number): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: "" }),
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }),
  ]).catch(() => {});
}

// --- Flow --------------------------------------------------------------------

async function inject(tabId: number, frameId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ["content.js"] });
}

async function runRefinement(
  tabId: number,
  frameId: number,
  requested: RequestedTarget,
  depth: Depth = "balanced",
  kind: OutputKind = "prompt",
): Promise<void> {
  try {
    await refine(tabId, frameId, requested, depth, kind);
  } finally {
    reloadIfStale();
  }
}

async function refine(tabId: number, frameId: number, requested: RequestedTarget, depth: Depth, kind: OutputKind): Promise<void> {
  if (!KINDS.includes(kind)) return;
  const target = kind === "prompt" ? requested : FILE_TARGET[kind];
  const opId = crypto.randomUUID();
  const send = (message: ToContent) => chrome.tabs.sendMessage(tabId, message, { frameId });
  const capture = () => send({ type: "pr:capture", opId, target, depth, kind }).catch(() => null);

  await clearFailure(tabId);
  try {
    await inject(tabId, frameId);
  } catch (err) {
    console.info("[Prompt Refiner] Página inacessível para a extensão:", errorMessage(err));
    await flagFailure(tabId, "inaccessible", describeInjectionError(errorMessage(err), frameId));
    return;
  }

  // The content script captures the selection synchronously and shows feedback.
  let captured: unknown = await capture();
  if (!isCaptureResponse(captured)) {
    // Nobody answered: a stale registration made the injected script skip its listener.
    // Drop it and inject once more so a fresh listener is registered.
    console.info("[Prompt Refiner] O script da página não respondeu; reinjetando.");
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: resetRegistrationInPage,
        args: [REGISTRATION_KEY],
      });
      await inject(tabId, frameId);
      captured = await capture();
    } catch {
      captured = null;
    }
    if (!isCaptureResponse(captured)) {
      await flagFailure(tabId, "no_response");
      return;
    }
  }
  noteContentBuild(captured);
  if (!captured.ok) return; // the content script already explained why in a toast

  const previous = opByTab.get(tabId);
  // A new refinement in the same tab replaces the running one. If that one runs in another frame,
  // its loading toast must not spin forever: it gets an explanation (see "superseded" below).
  if (previous) inflight.get(previous)?.abort(new RefineError("superseded", SUPERSEDED));
  const controller = new AbortController();
  inflight.set(opId, controller);
  opByTab.set(tabId, opId);
  updateKeepAlive();
  const timer = setTimeout(() => controller.abort(timeoutError()), REQUEST_TIMEOUT_MS);

  try {
    const { endpoint, format } = await getSettings();
    // Only the selected text (+ hostname for auto mode) leaves the browser.
    const body: RefineRequestBody = { text: captured.text, target, depth, language: navigator.language };
    if (kind === "prompt") body.format = format;
    else body.kind = kind; // instruction files are always Markdown; their target is implied
    if (target === "auto" && captured.hostname) body.hostname = captured.hostname;
    const result = await requestRefinement(endpoint, body, controller.signal);
    if (controller.signal.aborted) throw controller.signal.reason;
    const delivered = await send({
      type: "pr:apply",
      opId,
      refinedPrompt: result.refinedPrompt,
      target: result.target,
      depth,
      kind,
    }).then(
      () => true,
      () => false,
    );
    if (!delivered) await flagFailure(tabId, "not_delivered");
  } catch (err) {
    const code = err instanceof RefineError ? err.code : "unexpected";
    if (code === "aborted") return; // cancelled from the page, which already said so
    if (code === "superseded") {
      // Same frame: the new capture already replaced the toast and the message is ignored there.
      await send({ type: "pr:error", opId, detail: SUPERSEDED }).catch(() => {});
      return;
    }
    console.info("[Prompt Refiner] Falha no refinamento:", code);
    const detail = err instanceof RefineError ? err.detail : undefined;
    recordFailure(failureTitle("failed", detail ?? `(código: ${code})`));
    const shown = await send({ type: "pr:error", opId, detail }).then(
      () => true,
      () => false,
    );
    if (!shown) await flagFailure(tabId, "failed", detail);
  } finally {
    clearTimeout(timer);
    inflight.delete(opId);
    if (opByTab.get(tabId) === opId) opByTab.delete(tabId);
    updateKeepAlive();
  }
}

// --- Listeners (registered synchronously at top level, as MV3 requires) -------

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.removeAll(() => createMenus());
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const choice = parseMenuId(info.menuItemId);
  if (!choice || tab?.id === undefined || tab.id < 0) return;
  void runRefinement(tab.id, info.frameId ?? 0, choice.target, choice.depth, choice.kind);
});

/**
 * Runs inside every accessible frame (no extra permission: activeTab is granted by the shortcut).
 * Must be self-contained. Reports whether the frame has focus and a non-empty selection, and
 * whether its focused element is itself a frame (then the real target is deeper).
 */
function probeFrame() {
  const el = document.activeElement as HTMLInputElement | null;
  let selected = false;
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    try {
      selected = el.selectionStart !== null && el.selectionStart !== el.selectionEnd;
    } catch {
      selected = false;
    }
  } else {
    const sel = document.getSelection();
    selected = !!sel && !sel.isCollapsed;
  }
  return { focused: document.hasFocus(), selected, activeIsFrame: el?.tagName === "IFRAME" || el?.tagName === "FRAME" };
}

/** The keyboard shortcut has no click position: find the frame that holds the selection. */
async function frameForShortcut(tabId: number): Promise<number> {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: probeFrame });
    let best = { frameId: 0, score: -1 };
    for (const r of results) {
      const p = r.result as ReturnType<typeof probeFrame> | undefined;
      if (!p || p.activeIsFrame) continue;
      const score = (p.selected ? 2 : 0) + (p.focused ? 1 : 0);
      if (score > best.score) best = { frameId: r.frameId, score };
    }
    return best.score >= 2 ? best.frameId : 0;
  } catch {
    return 0; // e.g. a frame we cannot access: fall back to the top frame
  }
}

async function runShortcut(tabId: number): Promise<void> {
  const [settings, frameId] = await Promise.all([getSettings(), frameForShortcut(tabId)]);
  await runRefinement(tabId, frameId, settings.defaultTarget, settings.defaultDepth);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== COMMAND_DEFAULT || tab?.id === undefined) return;
  void runShortcut(tab.id);
});

chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !isToBackground(msg)) return false;
  // A frame may only cancel the operation running in its own tab.
  if (opByTab.get(sender.tab.id) === msg.opId) inflight.get(msg.opId)?.abort(new RefineError("aborted"));
  return false;
});

// Test build only (dist-e2e): lets the Playwright smoke test trigger the flow, since native
// context menus cannot be clicked by automation. Compiled out of the production bundle.
if (__E2E__) {
  (globalThis as Record<string, unknown>).__promptRefinerTest = { runRefinement, runShortcut };
}
