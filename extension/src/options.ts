import { type Depth, type PromptFormat, REQUESTED_TARGETS, type RequestedTarget, TARGET_LABELS } from "../../shared/api.js";
import { checkHealth } from "./api.js";
import { isLastFailure, LAST_FAILURE_KEY } from "./feedback.js";
import { getSettings, normalizeEndpoint, saveSettings } from "./settings.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const endpointInput = $<HTMLInputElement>("endpoint");
const endpointHint = $<HTMLParagraphElement>("endpoint-hint");
const targetSelect = $<HTMLSelectElement>("defaultTarget");
const depthSelect = $<HTMLSelectElement>("defaultDepth");
const formatSelect = $<HTMLSelectElement>("format");
const testButton = $<HTMLButtonElement>("test");
const status = $<HTMLSpanElement>("status");
const DEFAULT_HINT = endpointHint.textContent ?? "";

function setStatus(text: string, tone: "ok" | "warn" | "err" | "" = ""): void {
  status.textContent = text;
  status.className = `status ${tone}`;
}

function readEndpoint(): string | null {
  const endpoint = normalizeEndpoint(endpointInput.value);
  endpointInput.setAttribute("aria-invalid", String(!endpoint));
  if (!endpoint) {
    endpointHint.textContent =
      "Informe uma URL válida: http só no seu computador (ex.: http://127.0.0.1:8787); fora dele, use https.";
  } else {
    endpointHint.textContent = DEFAULT_HINT;
  }
  return endpoint;
}

async function init(): Promise<void> {
  for (const target of REQUESTED_TARGETS) {
    if (target === "generic") continue;
    targetSelect.add(new Option(target === "auto" ? `✨ ${TARGET_LABELS.auto}` : TARGET_LABELS[target], target));
  }
  const settings = await getSettings();
  endpointInput.value = settings.endpoint;
  targetSelect.value = settings.defaultTarget;
  depthSelect.value = settings.defaultDepth;
  formatSelect.value = settings.format;

  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((c) => c.name === "refine-default")?.shortcut;
  $("shortcut").textContent = shortcut || "não definido (chrome://extensions/shortcuts)";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const endpoint = readEndpoint();
  if (!endpoint) return setStatus("Endpoint inválido.", "err");
  await saveSettings({
    endpoint,
    defaultTarget: targetSelect.value as RequestedTarget,
    defaultDepth: depthSelect.value as Depth,
    format: formatSelect.value as PromptFormat,
  });
  endpointInput.value = endpoint;
  setStatus("Configurações salvas.", "ok");
});

testButton.addEventListener("click", async () => {
  const endpoint = readEndpoint();
  if (!endpoint) return setStatus("Endpoint inválido.", "err");
  testButton.disabled = true;
  setStatus("Testando…");
  try {
    const health = await checkHealth(endpoint);
    if (health.status === "ok") setStatus(`Conectado (provider: ${health.provider}).`, "ok");
    else setStatus(`Erro: ${health.message ?? "backend sem configuração."}`, "err");
  } catch (err) {
    const network = err instanceof TypeError || (err instanceof DOMException && err.name === "TimeoutError");
    setStatus(
      network ? "Não conectado. Verifique se o backend está rodando." : `Erro: ${(err as Error).message}`,
      network ? "warn" : "err",
    );
  } finally {
    testButton.disabled = false;
  }
});

endpointInput.addEventListener("input", () => {
  readEndpoint();
  setStatus("");
});

/** Last failure recorded by the background this browser session (reason and time only). */
async function showLastFailure(): Promise<void> {
  const stored = await chrome.storage.session.get(LAST_FAILURE_KEY).catch(() => ({}) as Record<string, unknown>);
  const last = (stored as Record<string, unknown>)[LAST_FAILURE_KEY];
  if (!isLastFailure(last)) return;
  $("last-problem-text").textContent = last.title.replace(/^Prompt Refiner — /, "");
  $("last-problem-time").textContent =
    `(${new Date(last.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })})`;
  $("last-problem").hidden = false;
}

void init();
void showLastFailure();
