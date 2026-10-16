import type { TargetAdapter } from "./types.js";

export const gemini: TargetAdapter = {
  id: "gemini",
  name: "Gemini (Google)",
  guidance: [
    "State the task explicitly as a direct instruction.",
    "Keep instructions consistent; never repeat the same rule with different wording.",
    "Specify the output format (structure, length, sections) when it matters.",
    "Clearly separate data supplied by the user from instructions (use labeled blocks or delimiters).",
    "When the user refers to long material (documents, transcripts, code), put the instructions after the data placeholder and ask the model to base its answer on that material.",
  ],
};
