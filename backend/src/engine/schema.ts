import { TASK_TYPES } from "./types.js";

/**
 * JSON Schema the compiler model must follow. Kept to the subset supported by both
 * Anthropic structured outputs and OpenAI strict json_schema (no numeric bounds).
 * Field order matters: analysis fields come before the prompt so the model decides first.
 */
export const COMPILER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskType: { type: "string", enum: [...TASK_TYPES] },
    complexity: { type: "integer", description: "1 to 5" },
    refinedPrompt: { type: "string", description: "The final prompt only." },
    warnings: { type: "array", items: { type: "string" }, description: "Short snake_case codes only." },
  },
  required: ["taskType", "complexity", "refinedPrompt", "warnings"],
} as const;
