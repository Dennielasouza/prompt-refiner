import type { Complexity, Target, TaskType } from "./types.js";

/**
 * Suggests the cheapest model + effort that should still do the job, so nobody burns a
 * flagship model with high effort on a request a small one handles just as well.
 *
 * It reuses the `complexity` the compiler already returns — there is no second analysis and no
 * extra token. Complexity was designed to cap prompt inflation, but its levels are a reading of
 * how hard the request is (1 trivial … 5 long autonomous mission), which is the same axis.
 *
 * Names are what the destination's OWN MENU shows, because a suggestion nobody can pick is
 * useless. Checked against the official docs on 2026-11-02 (.local/relatorio-modelo-e-esforco-oficial.md):
 *  - Claude and Claude Code: the menu picks a model and an effort
 *    (support.claude.com/en/articles/8664678).
 *  - ChatGPT: the menu does NOT pick a model. Paid plans select GPT-6 and move a Thinking slider
 *    (Instant · Medium · High · Extra High · Pro); GPT-6 Sol powers every position except Pro,
 *    which is GPT-6 Pro on Astra (help.openai.com/en/articles/20001354). So the "model" here is
 *    what the menu says, and the effort is the slider position: low ≈ Instant, medium ≈ Medium,
 *    high ≈ High. Free and Go plans only get GPT-5.6 Luna, which this cannot know about.
 *  - Codex: the menu picks a model — Luna, Terra, Sol, Astra, smallest first
 *    (developers.openai.com/api/docs/models). Terra sits between Luna and Sol; an earlier
 *    version of this file said OpenAI had no fourth name, which was wrong.
 *  - Gemini: the app menu lists Flash-Lite, Flash, Pro and Argon, without version numbers
 *    (support.google.com/gemini/answer/18648722).
 *
 * LADDER LENGTHS MAY DIFFER, so the levels here are canonical (0 smallest … 3 ultra) and each
 * family maps them onto the rungs it actually has (`rungFor`). Every family has four today, but
 * the mapping stays general: a family whose vendor publishes fewer tiers must share a rung
 * rather than name a model that does not exist.
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

/** Per-destination names as each menu shows them, smallest first. Lengths may differ. */
const FAMILIES = {
  anthropic: ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"],
  // Not a model ladder: ChatGPT shows one model on the first three rungs and tells them apart by
  // the Thinking slider, which `effort` already carries. Only the top rung is a different choice.
  chatgpt: ["GPT-6", "GPT-6", "GPT-6", "GPT-6 Pro"],
  codex: ["Luna", "Terra", "Sol", "Astra"],
  google: ["Flash-Lite", "Flash", "Pro", "Argon"],
} as const satisfies Record<string, readonly [string, string, string, ...string[]]>;

type Family = keyof typeof FAMILIES;

function familyFor(target: Target): Family | null {
  if (target === "chatgpt") return "chatgpt";
  if (target === "codex") return "codex";
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

/** "Haiku 5.5 (Claude), GPT-6 (ChatGPT) ou Flash-Lite (Gemini)" */
function everyFamily(level: Level): string {
  const a = modelIn("anthropic", level);
  const o = modelIn("chatgpt", level);
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
