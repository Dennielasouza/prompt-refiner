import type { Target } from "../types.js";
import { chatgpt } from "./chatgpt.js";
import { claude } from "./claude.js";
import { claudeCode } from "./claudeCode.js";
import { codex } from "./codex.js";
import { gemini } from "./gemini.js";
import { generic } from "./generic.js";
import { type Guidance, resolveGuidance, type TargetAdapter } from "./types.js";

export const ADAPTERS: Record<Target, TargetAdapter> = {
  generic,
  chatgpt,
  claude,
  gemini,
  codex,
  "claude-code": claudeCode,
};

export function getAdapter(target: Target): TargetAdapter {
  return ADAPTERS[target];
}

export type { Guidance, TargetAdapter };
export { resolveGuidance };
