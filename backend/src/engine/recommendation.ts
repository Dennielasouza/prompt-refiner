import type { Complexity, Target, TaskType } from "./types.js";

/**
 * Suggests the cheapest model + effort that should still do the job, so nobody burns a
 * flagship model with high effort on a request a small one handles just as well.
 *
 * It reuses the `complexity` the compiler already returns — there is no second analysis and no
 * extra token. Complexity was designed to cap prompt inflation, but its levels are a reading of
 * how hard the request is (1 trivial … 5 long autonomous mission), which is the same axis.
 *
 * Model names come from what is actually documented:
 *  - Anthropic: the models this project prices in config/pricing.ts, plus Fable as the top tier
 *    (Anthropic positions Fable above Opus, though it says Opus 5.5 comes close on most tasks).
 *  - OpenAI: the three text models and their effort levels in the API docs; the tier mapping
 *    follows OpenAI's own model-selection guide ("keep the lightest setting that meets your
 *    quality bar"), e.g. Luna for focused work, Sol for complex technical work, Astra for
 *    ambitious projects. Astra is already the top of that family — there is no fourth name.
 *  - Google: the three text tiers in ai.google.dev/gemini-api/docs/models; its thinking_level
 *    takes low/medium/high, the same vocabulary used here. 4 Argon is the current top tier
 *    (confirmed by the owner, 2026-10-31) — third-party roundups still list Pro and are stale.
 *
 * LADDER LENGTHS DIFFER. Anthropic publishes four tiers, the other two three, so the levels here
 * are canonical (0 smallest … 3 ultra) and each family maps them onto the rungs it actually has.
 * A three-rung family therefore spends two canonical levels on its middle model and separates
 * them by effort instead. This is deliberate: inventing a fourth OpenAI or Gemini name would make
 * the product name a model that does not exist. Appending a real name to a family is all it takes
 * for that family to use all four.
 *
 * When the destination is unknown ("generic") it names all three, because a size description
 * ("a fast model") is not something anyone can act on in a model picker.
 *
 * It is a heuristic, not a measurement: the project's own model×effort benchmark scored every
 * combination between 8.1 and 8.5, which is not a conclusive difference — and a benchmark that
 * cannot separate the tiers is evidence of no power, not of equivalence. The UI says "Sugestão"
 * for that reason, and `floorFor` keeps the unmeasured half of the heuristic from doing harm.
 */

/** Smallest to ultra. Canonical, not a per-family index — see `rungFor`. */
const LEVELS = [0, 1, 2, 3] as const;
type Level = (typeof LEVELS)[number];

export type Effort = "low" | "medium" | "high";

export interface Recommendation {
  /** Ready for display, e.g. "Luna" or "Sonnet 5.5". Generic wording when the family is unknown. */
  model: string;
  effort: Effort;
}

/** Per-destination model names, smallest first. Lengths may differ between families. */
const FAMILIES = {
  // The models this project prices in config/pricing.ts, plus the top tier above Opus.
  anthropic: ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"],
  // Both OpenAI surfaces: chatgpt.com and the Codex agent. Astra is the documented top.
  openai: ["Luna", "Sol", "Astra"],
  google: ["3.5 Flash-Lite", "3.8 Flash", "4 Argon"],
} as const satisfies Record<string, readonly [string, string, string, ...string[]]>;

type Family = keyof typeof FAMILIES;

function familyFor(target: Target): Family | null {
  if (target === "chatgpt" || target === "codex") return "openai";
  if (target === "claude" || target === "claude-code") return "anthropic";
  if (target === "gemini") return "google";
  return null; // destination unknown — name them all
}

/**
 * Canonical level → the rung a family of `length` models actually has. Exact for a four-rung
 * family; a three-rung one rounds, so levels 1 and 2 share its middle model.
 */
function rungFor(level: Level, length: number): number {
  return Math.round((level / (LEVELS.length - 1)) * (length - 1));
}

function modelIn(family: Family, level: Level): string {
  const ladder = FAMILIES[family];
  return ladder[rungFor(level, ladder.length)];
}

/** "Haiku 5.5 (Claude), Luna (ChatGPT) ou 3.5 Flash-Lite (Gemini)" */
function everyFamily(level: Level): string {
  const a = modelIn("anthropic", level);
  const o = modelIn("openai", level);
  const g = modelIn("google", level);
  return `${a} (Claude), ${o} (ChatGPT) ou ${g} (Gemini)`;
}

/**
 * Base (level, effort) per complexity level. Complexity 5 maps to the ultra tier, and a hard task
 * type at complexity 4 reaches it too — otherwise the top rung would be unreachable decoration.
 */
const BASE: Record<Complexity, { level: Level; effort: Effort }> = {
  1: { level: 0, effort: "low" },
  2: { level: 0, effort: "medium" },
  3: { level: 1, effort: "medium" },
  4: { level: 2, effort: "high" },
  5: { level: 3, effort: "high" },
};

/**
 * Task types that move the suggestion one step, because the task type says something the
 * complexity level alone does not: code has to RUN, and an agent acts on its own.
 */
const HARDER: ReadonlySet<TaskType> = new Set(["coding", "implementation", "debugging", "agent_task", "automation"]);
/** Transformations of text the person already supplied: the answer is bounded by the input. */
const EASIER: ReadonlySet<TaskType> = new Set(["rewriting", "classification"]);

/**
 * The lowest rung a request may be pointed at. The suggestion exists to save money, but economy
 * that costs the answer is not economy, so the burden of proof runs the other way here: it may
 * point below the middle rung only where going there is defensible, never merely because it is
 * cheaper.
 *
 *  - A task that RUNS or ACTS (code, an agent) never goes to the smallest model. A wrong answer
 *    there is broken rather than weaker, and the smallest tier is where that shows up first.
 *  - Anything the compiler itself read as complexity 3 or more stays at the middle rung. The
 *    engine already judged the request non-trivial; a task-type hint should not overrule it.
 *
 * What it deliberately does NOT floor: a genuinely trivial request (complexity 1–2) that neither
 * runs nor acts. That case is the whole point of the feature, and taking it away would leave the
 * suggestion with no economy to offer.
 *
 * None of this is measured. It is a floor precisely BECAUSE it is not measured: until the
 * destination-token experiment exists, the safe default is to point down less often, not more.
 */
function floorFor(taskType: TaskType, complexity: Complexity): Level {
  if (HARDER.has(taskType)) return 1;
  if (complexity >= 3) return 1;
  return 0;
}

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

function step<T>(values: readonly T[], current: T, by: number): T {
  const i = values.indexOf(current);
  return values[Math.min(values.length - 1, Math.max(0, i + by))];
}

/**
 * Moves the base one step for the task type. The two directions are NOT symmetric:
 *
 * Going UP, effort is the cheap lever — raise it, and reach for a bigger model only once effort
 * has nowhere left to go. Going DOWN, the MODEL is where the money is: per config/pricing.ts,
 * Haiku costs about a twentieth of Sonnet, while dropping one effort level saves a fraction of
 * the output tokens. So a lighter task type drops the model first.
 */
function adjust(base: { level: Level; effort: Effort }, by: 1 | -1): { level: Level; effort: Effort } {
  if (by === 1) {
    const effort = step(EFFORTS, base.effort, 1);
    return effort === base.effort ? { level: step(LEVELS, base.level, 1), effort } : { level: base.level, effort };
  }
  const level = step(LEVELS, base.level, -1);
  return level === base.level ? { level, effort: step(EFFORTS, base.effort, -1) } : { level, effort: base.effort };
}

export function recommend(complexity: Complexity, taskType: TaskType, target: Target): Recommendation {
  const base = BASE[complexity];
  const moved = HARDER.has(taskType) ? adjust(base, 1) : EASIER.has(taskType) ? adjust(base, -1) : base;
  const level = Math.max(moved.level, floorFor(taskType, complexity)) as Level;
  const family = familyFor(target);
  return { model: family ? modelIn(family, level) : everyFamily(level), effort: moved.effort };
}
