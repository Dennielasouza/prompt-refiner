import type { TargetAdapter } from "./types.js";

export const claudeCode: TargetAdapter = {
  id: "claude-code",
  name: "Claude Code (agentic coding assistant with terminal and file tools)",
  guidance: [
    "When the task involves development: ask the agent to understand the relevant parts of the repository before editing.",
    "Encourage using the available tools (search, read, run commands, run tests) instead of guessing.",
    "Ask for implementation, not explanation only.",
    "Change only what is necessary; avoid overengineering and unrelated refactors.",
    "Require running tests/builds and verifying the behavior after the change.",
    "Preserve existing functionality.",
    "State assumptions only when genuinely necessary.",
    "Keep working until the task is done unless there is a real blocker; then report what blocks it.",
    {
      auto: "For complex tasks, XML-delimited sections (<context>, <task>, <constraints>, <done_when>) are welcome; keep small tasks as short direct instructions.",
      markdown:
        "For complex tasks, Markdown sections (e.g. context, task, constraints, done when) are welcome; keep small tasks as short direct instructions.",
    },
    "If the task is not about code, keep the prompt clear and direct without forcing engineering structure.",
  ],
};
