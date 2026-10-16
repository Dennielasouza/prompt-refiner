import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Target } from "../../shared/api.js";

/**
 * Desktop counterpart of shared/hostTargets.ts: frontmost app bundle id → target for "Automático".
 * KEEP IN SYNC with RefineCore.appTargets in desktop/helper/RefineCore.swift (the ⌥⌥ helper);
 * the Swift unit tests (`npm run test:helper -w desktop`) fail if they differ.
 * Unknown apps (Slack, editors, terminals…) get the generic target — Codex and Claude Code are
 * never inferred automatically.
 */
export const APP_TARGETS: Record<string, Target> = {
  "com.anthropic.claudefordesktop": "claude",
  "com.openai.chat": "chatgpt",
  // The current ChatGPT desktop app ships under this id (ChatGPT + Codex in one app).
  "com.openai.codex": "chatgpt",
  "com.google.Chrome.app.gemini": "gemini",
};

export function targetForApp(bundleId: string | null): Target {
  return (bundleId && APP_TARGETS[bundleId]) || "generic";
}

/** Bundle id of the frontmost app (the one whose text is selected). No special permission needed. */
export async function frontmostBundleId(): Promise<string | null> {
  try {
    const { stdout: asn } = await promisify(execFile)("/usr/bin/lsappinfo", ["front"]);
    const { stdout } = await promisify(execFile)("/usr/bin/lsappinfo", ["info", "-only", "bundleid", asn.trim()]);
    return /"CFBundleIdentifier"="([^"]+)"/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}
