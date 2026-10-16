import type { RequestedTarget, Target } from "./api.js";

/**
 * Hostname → target used by the "Automático" mode. Add new destinations here.
 * Subdomains match their parent entry. Codex and Claude Code are never inferred from a page.
 */
export const HOST_TARGETS: Record<string, Target> = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
  "aistudio.google.com": "gemini",
};

export function targetFromHostname(hostname: string | undefined): Target {
  if (!hostname) return "generic";
  let host = hostname.trim().toLowerCase().replace(/\.$/, "");
  while (host) {
    const hit = HOST_TARGETS[host];
    if (hit) return hit;
    const dot = host.indexOf(".");
    if (dot === -1) break;
    host = host.slice(dot + 1);
  }
  return "generic";
}

export function resolveTarget(requested: RequestedTarget, hostname?: string): Target {
  return requested === "auto" ? targetFromHostname(hostname) : requested;
}
