import type { TargetAdapter } from "./types.js";

export const claude: TargetAdapter = {
  id: "claude",
  name: "Claude (Anthropic)",
  guidance: [
    "Give clear, explicit instructions; say what to do rather than only what not to do.",
    "Provide enough context for the model to understand why the task matters, when the user supplied it.",
    {
      auto: "For complex prompts (complexity ≥ 3) that mix context, data, instructions or examples, separate them with descriptive XML tags (e.g. <context>, <instructions>, <data>, <output_format>). Use XML only when it truly improves separation.",
      markdown:
        "For complex prompts (complexity ≥ 3) that mix context, data, instructions or examples, separate them into sections with descriptive Markdown headings (e.g. context, instructions, data, output format) and put supplied data in fenced blocks. Use sections only when they truly improve separation.",
    },
    {
      auto: "Do not wrap simple prompts (complexity 1–2) in XML; plain prose is better there.",
      markdown: "", // the Markdown format block already keeps simple prompts plain
    },
    "Include examples only when the user provided them or when the expected format is otherwise ambiguous — never invent example data.",
    "For agentic tasks, give concrete execution instructions: act rather than suggest, verify results, and say when to stop.",
  ],
};
