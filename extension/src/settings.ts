import { DEPTHS, type Depth, FORMATS, type PromptFormat, REQUESTED_TARGETS, type RequestedTarget } from "../../shared/api.js";

export interface Settings {
  endpoint: string;
  defaultTarget: RequestedTarget;
  /** Depth used by the keyboard shortcut (the context menu offers both). */
  defaultDepth: Depth;
  /** Format of every refined prompt (menu and shortcut). CLAUDE.md/AGENTS.md are always Markdown. */
  format: PromptFormat;
}

export const DEFAULT_SETTINGS: Settings = {
  // 127.0.0.1, not "localhost": the backend binds 127.0.0.1, and a host that resolves
  // localhost to ::1 first would fail to connect with no useful error.
  endpoint: "http://127.0.0.1:8787",
  defaultTarget: "auto",
  defaultDepth: "balanced",
  format: "markdown",
};

/** Returns a normalized http(s) origin+path without trailing slash, or null if invalid. */
function isLocalHostname(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}

export function normalizeEndpoint(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    // Plain http sends the person's text in the clear: accept it only on their own machine.
    if (url.protocol === "http:" && !isLocalHostname(url.hostname)) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function isLocalEndpoint(endpoint: string): boolean {
  return isLocalHostname(new URL(endpoint).hostname);
}

export async function getSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS });
  const target = stored.defaultTarget as RequestedTarget;
  const depth = stored.defaultDepth as Depth;
  const format = stored.format as PromptFormat;
  return {
    endpoint: normalizeEndpoint(String(stored.endpoint)) ?? DEFAULT_SETTINGS.endpoint,
    defaultTarget: REQUESTED_TARGETS.includes(target) ? target : DEFAULT_SETTINGS.defaultTarget,
    defaultDepth: DEPTHS.includes(depth) ? depth : DEFAULT_SETTINGS.defaultDepth,
    format: FORMATS.includes(format) ? format : DEFAULT_SETTINGS.format,
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ ...settings });
}
