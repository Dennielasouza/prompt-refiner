/**
 * Injected on demand (activeTab + scripting) into the frame where the user right-clicked.
 * Captures the selection synchronously, shows progress, and replaces exactly that selection
 * when the background sends the refined prompt. Never reads anything else from the page.
 */
import {
  type Depth,
  KIND_LABELS,
  MAX_INPUT_CHARS,
  type OutputKind,
  type RequestedTarget,
  TARGET_LABELS,
  type Target,
} from "../../shared/api.js";
import { resolveTarget } from "../../shared/hostTargets.js";
import {
  type ApplyFailure,
  applyReplacement,
  type Capture,
  captureSelection,
  type UndoInfo,
  undoReplacement,
} from "./dom/editable.js";
import { type CaptureResponse, isToContent, kindOf, type ToBackground, type ToContent } from "./messages.js";
import { claimRegistration, extensionContextAlive } from "./registration.js";
import { hideToast, showToast } from "./ui/toast.js";

const REFINE_FAILED = "Não foi possível refinar o prompt.";
const EXTENSION_RELOADED = "O Prompt Refiner foi atualizado ou recarregado.";
const TRY_AGAIN = "Selecione o texto e tente novamente.";

const APPLY_FAILURE_DETAIL: Record<ApplyFailure, string> = {
  selection_changed: "O texto selecionado mudou durante o refinamento. Nada foi alterado.",
  field_gone: "O campo não está mais disponível. Nada foi alterado.",
  editor_rejected: "Este editor não aceitou a inserção automática. Nada foi alterado.",
};

/** Instruction files get their own wording ("Gerando CLAUDE.md...", "CLAUDE.md gerado"). */
const fileName = (kind: OutputKind) => (kind === "prompt" ? null : KIND_LABELS[kind]);
const failedTitle = (kind: OutputKind) => {
  const file = fileName(kind);
  return file ? `Não foi possível gerar o ${file}.` : REFINE_FAILED;
};

const pending = new Map<string, { capture: Capture; kind: OutputKind }>();

function label(target: Target): string | null {
  return target === "generic" ? null : TARGET_LABELS[target];
}

const depthSuffix = (depth: Depth) => (depth === "deep" ? " (profundo)" : "");

function loadingMessage(requested: RequestedTarget, depth: Depth, kind: OutputKind): string {
  const file = fileName(kind);
  if (file) return `Gerando ${file}...`;
  const name = label(resolveTarget(requested, location.hostname));
  return `${(name ? `Refinando para ${name}` : "Refinando prompt") + depthSuffix(depth)}...`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (e.g. insecure context): legacy copy.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.documentElement.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function capture(msg: Extract<ToContent, { type: "pr:capture" }>): CaptureResponse {
  const kind = kindOf(msg);
  const result = captureSelection();
  if (!result.ok) {
    if (result.reason === "password") {
      showToast({ kind: "info", message: "O Prompt Refiner não funciona em campos de senha." });
    } else if (result.reason === "unsupported") {
      showToast({ kind: "info", message: "Este campo não é suportado. Selecione o texto em um campo editável." });
    } else {
      const file = fileName(kind);
      showToast({
        kind: "info",
        message: file ? `Selecione as anotações sobre o projeto para gerar o ${file}.` : "Selecione o prompt que deseja refinar.",
      });
    }
    return { ok: false, reason: result.reason };
  }
  const { capture } = result;
  if (capture.selectedText.length > MAX_INPUT_CHARS) {
    showToast({
      kind: "error",
      message: failedTitle(kind),
      detail: `A seleção tem mais de ${MAX_INPUT_CHARS.toLocaleString("pt-BR")} caracteres.`,
    });
    return { ok: false, reason: "too_long" };
  }

  pending.clear(); // one refinement at a time per frame
  pending.set(msg.opId, { capture, kind });
  showToast({
    kind: "loading",
    message: loadingMessage(msg.target, msg.depth, kind),
    action: {
      label: "Cancelar",
      onClick: () => {
        pending.delete(msg.opId);
        // An orphaned script (extension reloaded) can't reach the background; sendMessage would throw.
        if (extensionContextAlive()) {
          const cancel: ToBackground = { type: "pr:cancel", opId: msg.opId };
          void chrome.runtime.sendMessage(cancel).catch(() => {});
        }
        showToast({ kind: "info", message: kind === "prompt" ? "Refinamento cancelado." : "Geração cancelada." });
      },
    },
  });
  watchForOrphaning();
  return { ok: true, text: capture.selectedText, hostname: location.hostname, build: __BUILD_ID__ };
}

/**
 * If the extension is reloaded/updated mid-refinement, this script is orphaned: the answer will
 * never arrive and the loading toast would spin forever. Detect it and say so.
 */
let orphanWatch: ReturnType<typeof setInterval> | undefined;
function watchForOrphaning(): void {
  if (orphanWatch) return;
  orphanWatch = setInterval(() => {
    if (pending.size === 0) {
      clearInterval(orphanWatch);
      orphanWatch = undefined;
    } else if (!extensionContextAlive()) {
      clearInterval(orphanWatch);
      orphanWatch = undefined;
      pending.clear();
      showToast({ kind: "error", message: EXTENSION_RELOADED, detail: `O refinamento foi interrompido. ${TRY_AGAIN}` });
    }
  }, 1000);
}

function showUndone(undo: UndoInfo): void {
  void undoReplacement(undo).then((r) =>
    r.ok
      ? showToast({ kind: "info", message: "Alteração desfeita." })
      : showToast({ kind: "error", message: "Não foi possível desfazer.", detail: "O texto foi editado depois do refinamento." }),
  );
}

async function apply(msg: Extract<ToContent, { type: "pr:apply" }>): Promise<void> {
  const entry = pending.get(msg.opId);
  if (!entry) return; // cancelled or superseded
  pending.delete(msg.opId);
  const file = fileName(kindOf(msg));

  const result = await applyReplacement(entry.capture, msg.refinedPrompt);
  if (!result.ok) {
    showToast({
      kind: "error",
      message: file ? `Não foi possível inserir o ${file}.` : "Não foi possível inserir o prompt refinado.",
      detail: APPLY_FAILURE_DETAIL[result.reason],
      action: {
        label: file ? "Copiar texto" : "Copiar prompt",
        onClick: () =>
          void copyText(msg.refinedPrompt).then((ok) =>
            showToast(
              ok
                ? { kind: "info", message: file ? "Texto copiado." : "Prompt copiado." }
                : { kind: "error", message: "Não foi possível copiar." },
            ),
          ),
      },
      duration: 15_000,
    });
    return;
  }
  const name = label(msg.target);
  showToast({
    kind: "success",
    message: file ? `${file} gerado` : (name ? `Prompt refinado para ${name}` : "Prompt refinado") + depthSuffix(msg.depth),
    action: { label: "Desfazer", onClick: () => showUndone(result.undo) },
  });
}

function fail(msg: Extract<ToContent, { type: "pr:error" }>): void {
  const entry = pending.get(msg.opId);
  if (!entry) return;
  pending.delete(msg.opId);
  showToast({ kind: "error", message: failedTitle(entry.kind), detail: msg.detail });
}

function onMessage(msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void): boolean {
  // Only our own extension may drive this script; payloads are validated before use.
  if (sender.id !== chrome.runtime.id || !isToContent(msg)) return false;
  switch (msg.type) {
    case "pr:capture":
      sendResponse(capture(msg));
      return false;
    case "pr:apply":
      void apply(msg).finally(() => sendResponse({ ok: true }));
      return true;
    case "pr:error":
      fail(msg);
      sendResponse({ ok: true });
      return false;
  }
}

function onPageHide(): void {
  pending.clear();
  hideToast();
}

// Injected on every use: register once per live extension context and build. A registration
// left by an older build or an invalidated context is replaced instead of trusted.
claimRegistration(window, __BUILD_ID__, extensionContextAlive, () => {
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch {
      // Context already invalidated: the listener is dead anyway.
    }
    window.removeEventListener("pagehide", onPageHide);
    pending.clear();
    clearInterval(orphanWatch);
    orphanWatch = undefined;
  };
});
