import type { Complexity } from "./types.js";

/**
 * Complexity levels exist to prevent prompt inflation: each level caps
 * how much structure the refined prompt may receive.
 */
export const COMPLEXITY_LEVELS: Record<Complexity, { label: string; allowed: string; budget: string }> = {
  1: {
    label: "trivial request or short transformation (fix a sentence, translate, make it more formal)",
    allowed: "only improve clarity and precision; no headings, no role, no sections",
    budget: "roughly the same length as the original, never more than about twice as long",
  },
  2: {
    label: "simple professional task",
    allowed: "may add objective, relevant context, a role only if it adds value, and output format",
    budget: "a short paragraph or a few lines",
  },
  3: {
    label: "complex task",
    allowed: "may add context, objective, workflow steps, criteria, constraints, output format, validation",
    budget: "a structured prompt with a few short sections; no padding",
  },
  4: {
    label: "agentic task or complex execution",
    allowed:
      "may add objective, context, tools to use, workflow, decision rules, constraints, quality criteria, stop conditions, verification",
    budget: "as long as needed for unambiguous execution; every line must change behavior",
  },
  5: {
    label: "long or highly autonomous mission",
    allowed:
      "may add source of truth, workflow, tools, state tracking, recovery behavior, checkpoints, evaluation criteria, failure behavior, stop conditions",
    budget: "complete but tight; no restating, no generic advice",
  },
};
