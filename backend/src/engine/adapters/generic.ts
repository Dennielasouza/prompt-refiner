import type { TargetAdapter } from "./types.js";

export const generic: TargetAdapter = {
  id: "generic",
  name: "a modern general-purpose LLM (destination unknown)",
  guidance: [
    "Use clear, direct, model-agnostic language; avoid vendor-specific syntax.",
    "Prefer short paragraphs; use light Markdown headings or lists only when the prompt has several distinct parts.",
    "State the objective first, then any context, constraints and the expected output.",
  ],
};
