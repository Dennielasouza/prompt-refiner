import type { PromptFormat, Target } from "../types.js";

/**
 * One guidance line. A plain string applies to every format; a per-format record lets a
 * destination recommend a structure syntax (e.g. XML tags for Claude) only when format = auto.
 */
export type Guidance = string | Record<PromptFormat, string>;

/**
 * A target adapter changes HOW instructions are structured for a destination agent.
 * It never changes WHAT the task is.
 */
export interface TargetAdapter {
  id: Target;
  /** Human-readable destination name used inside the compiler instruction. */
  name: string;
  /** Formatting and emphasis guidance injected into the compiler instruction. */
  guidance: Guidance[];
}

export function resolveGuidance(adapter: TargetAdapter, format: PromptFormat): string[] {
  // An empty per-format line means "nothing to add for this format".
  return adapter.guidance.map((g) => (typeof g === "string" ? g : g[format])).filter(Boolean);
}
