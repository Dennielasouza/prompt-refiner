import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type FeedbackStyle = "progress" | "success" | "error" | "info";
export type Feedback = (style: FeedbackStyle, title: string, detail?: string) => Promise<void>;

/** Installed by `npm run install-hotkey -w desktop` (scripts/helper.mjs). */
export const HELPER_EXECUTABLE = join(homedir(), "Applications/Prompt Refiner.app/Contents/MacOS/PromptRefinerHotkey");

/**
 * Shows feedback the user actually sees. osascript `display notification` is often silently
 * blocked (Focus, notification permission of "Script Editor"), so the primary channel is the
 * helper's HUD: `PromptRefinerHotkey --hud <style> <title> [detail]` forwards it to the running
 * menu bar helper (distributed notification) or shows it itself. Fire-and-forget, detached, so the
 * Service is never slowed down. Falls back to a notification when the helper is not installed.
 * Messages never contain the selected text.
 */
export const showFeedback: Feedback = (style, title, detail) => {
  if (existsSync(HELPER_EXECUTABLE)) {
    return new Promise((resolve) => {
      const child = spawn(HELPER_EXECUTABLE, ["--hud", style, title, ...(detail ? [detail] : [])], {
        detached: true,
        stdio: "ignore",
      });
      child.once("error", () => resolve(style === "progress" ? undefined : notify(title, detail)));
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  }
  return style === "progress" ? Promise.resolve() : notify(title, detail);
};

/** macOS notification. Text is passed as an argument, never interpolated into the script. */
export function notify(message: string, subtitle?: string): Promise<void> {
  const script = [
    "on run argv",
    "if (count of argv) > 1 then",
    'display notification (item 1 of argv) with title "Prompt Refiner" subtitle (item 2 of argv)',
    "else",
    'display notification (item 1 of argv) with title "Prompt Refiner"',
    "end if",
    "end run",
  ];
  const args = script.flatMap((line) => ["-e", line]).concat(message, ...(subtitle ? [subtitle] : []));
  return new Promise((resolve) => execFile("/usr/bin/osascript", args, () => resolve()));
}
