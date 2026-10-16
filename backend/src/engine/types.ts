export {
  DEPTHS,
  type Depth,
  FORMATS,
  KINDS,
  MAX_INPUT_CHARS,
  type OutputKind,
  type PromptFormat,
  REQUESTED_TARGETS,
  type RequestedTarget,
  TARGETS,
  type Target,
} from "../../../shared/api.js";

import type { Depth, OutputKind, PromptFormat, RequestedTarget, Target } from "../../../shared/api.js";

export const TASK_TYPES = [
  "writing",
  "rewriting",
  "research",
  "analysis",
  "strategy",
  "product",
  "ux",
  "ui",
  "coding",
  "implementation",
  "debugging",
  "data_analysis",
  "classification",
  "brainstorming",
  "image_generation",
  "automation",
  "agent_task",
  "planning",
  "general",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export type Complexity = 1 | 2 | 3 | 4 | 5;

export interface RefineInput {
  text: string;
  target: RequestedTarget;
  hostname?: string;
  language?: string;
  depth?: Depth;
  format?: PromptFormat;
  kind?: OutputKind;
}

export interface RefineResult {
  refinedPrompt: string;
  target: Target;
  depth: Depth;
  format: PromptFormat;
  kind: OutputKind;
  taskType: TaskType;
  complexity: Complexity;
  strategies: string[];
  warnings: string[];
}
