import type { TargetAdapter } from "./types.js";

export const codex: TargetAdapter = {
  id: "codex",
  name: "OpenAI Codex (autonomous coding agent working inside a repository)",
  guidance: [
    "When the task involves code: lead with the implementation objective stated as an action to perform.",
    "Include technical context and any files, modules, commands or stack the user mentioned — never invent file names or paths.",
    "Ask the agent to inspect the relevant parts of the repository before changing code.",
    "List functional requirements and constraints explicitly.",
    "Require tests (add or update) and running the existing test/lint/build commands when they apply.",
    "Define acceptance criteria as observable outcomes.",
    "Ask for implementation, not just recommendations; the agent should make the change and validate it.",
    "If the task is not about code, keep the prompt clear and direct without forcing engineering structure.",
  ],
};
