import type { TargetAdapter } from "./types.js";

export const chatgpt: TargetAdapter = {
  id: "chatgpt",
  name: "ChatGPT (OpenAI GPT models)",
  guidance: [
    "Make the objective explicit in the first sentence.",
    "Include only context that is relevant to the task.",
    "State constraints clearly and unambiguously (what to do, not only what to avoid).",
    "Specify the output format when the user cares about it (length, structure, sections, tone).",
    "Decompose into numbered steps only when the task genuinely has multiple stages.",
    "Add validation criteria (how to check the answer is right) only for code, math or agentic tasks.",
    "Markdown headings and lists are fine for complex prompts; keep simple prompts as plain sentences.",
  ],
};
