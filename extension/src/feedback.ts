/**
 * Feedback for failures that happen where no toast can be shown: the content script could not
 * be injected (chrome:// pages, Chrome Web Store, PDF viewer, cross-origin iframes, file://
 * without access…) or the page stopped answering. The extension icon gets a red "!" badge and
 * its tooltip explains why, per tab, until the next attempt in that tab.
 *
 * chrome.action is permissionless and already in the manifest; notifications or host
 * permissions would widen what the extension may do just to report an error.
 */

export type FailureKind = "inaccessible" | "no_response" | "not_delivered" | "failed";

export const BADGE_TEXT = "!";
/** chrome.storage.session key of the last failure shown to the person (for the options page). */
export const LAST_FAILURE_KEY = "lastFailure";

/** Reason and time only — never page or prompt content. */
export interface LastFailure {
  title: string;
  at: number;
}

export function isLastFailure(v: unknown): v is LastFailure {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.title === "string" && o.title.length <= 500 && typeof o.at === "number" && Number.isFinite(o.at);
}
export const BADGE_COLOR = "#dc2626";

/** pt-BR reason for a chrome.scripting.executeScript failure. Never includes page content. */
export function describeInjectionError(message: string, frameId = 0): string {
  if (/chrome\.google\.com\/webstore|chromewebstore\.google\.com|extensions gallery/i.test(message)) {
    return "o Chrome não permite extensões na Chrome Web Store.";
  }
  if (/cannot access a chrome(-extension|-untrusted)?:\/\/ url|chrome-extension:\/\/|chrome:\/\//i.test(message)) {
    return "o Chrome não permite extensões em páginas internas do navegador (chrome://, visualizador de PDF, outras extensões).";
  }
  if (/file:\/\//i.test(message)) {
    return "para usar em arquivos locais, ative “Permitir acesso aos URLs de arquivos” nos detalhes da extensão.";
  }
  if (/no (tab|frame) with id|frame with id|tab was closed|no document/i.test(message)) {
    return "a página mudou ou foi fechada antes do refinamento.";
  }
  if (frameId !== 0) {
    return "o campo está dentro de um quadro (iframe) que a extensão não pode acessar.";
  }
  return "a extensão não tem acesso a esta página.";
}

export function failureTitle(kind: FailureKind, reason?: string): string {
  switch (kind) {
    case "inaccessible":
      return `Prompt Refiner — não funciona nesta página: ${reason ?? "a extensão não tem acesso a esta página."}`;
    case "no_response":
      return "Prompt Refiner — a página não respondeu. Recarregue a página (F5) e tente novamente. Se continuar, recarregue a extensão (↻) em chrome://extensions.";
    case "failed":
      return `Prompt Refiner — não foi possível refinar o prompt.${reason ? ` ${reason}` : ""}`;
    case "not_delivered":
      return "Prompt Refiner — o prompt refinado não pôde ser inserido: a página mudou ou foi recarregada durante o refinamento.";
  }
}
