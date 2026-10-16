import type { TaskType } from "./types.js";

/** Task families the classifier may choose from. "general" is the fallback. */
export const TASK_TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  writing: "produce new text (post, email, article, copy, story)",
  rewriting: "transform existing text (fix, translate, shorten, change tone)",
  research: "find, gather or explain information on a topic",
  analysis: "examine something given (text, design, situation) and draw conclusions",
  strategy: "decide direction, positioning or trade-offs for a business/goal",
  product: "product definition: features, requirements, roadmap, user problems",
  ux: "user experience: flows, usability, information architecture, visual hierarchy critique",
  ui: "visual interface design or UI implementation details",
  coding: "write or explain code, small and self-contained",
  implementation: "build or change a feature inside an existing codebase",
  debugging: "find and fix the cause of a bug or error",
  data_analysis: "analyze datasets, metrics, spreadsheets, SQL",
  classification: "label, categorize or extract structured fields",
  brainstorming: "generate many ideas or options",
  image_generation: "describe an image to be generated",
  automation: "script, workflow or integration that automates a process",
  agent_task: "multi-step autonomous work using tools",
  planning: "plans, schedules, step-by-step roadmaps",
  general: "anything else, or not enough evidence for a specific family",
};
