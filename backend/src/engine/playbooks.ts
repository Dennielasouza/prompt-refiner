import type { TaskType } from "./types.js";

/**
 * Method playbooks used by the "deep" mode: what a senior practitioner of each task family
 * would make explicit. They are method (how to do the task well), never facts about the user.
 * The compiler adapts the relevant items to the request; it does not paste them verbatim.
 */
export interface Playbook {
  /** Dimensions/criteria an expert would evaluate or cover. */
  method: string[];
  /** Shape of the deliverable the person asked for (ordering, granularity) — never extra deliverables. */
  output: string;
  /** Typical failure modes the prompt should prevent. */
  pitfalls: string[];
}

export const PLAYBOOKS: Record<TaskType, Playbook> = {
  writing: {
    method: [
      "audience and what they should think/do after reading",
      "one central message",
      "tone and register",
      "structure (hook, body, close)",
      "concrete details over generic claims",
    ],
    output: "the text itself, with the requested length/format; optionally 2–3 variations when the person asked for options",
    pitfalls: ["generic filler", "clichés", "ignoring the stated length or channel"],
  },
  rewriting: {
    method: [
      "what must be preserved (meaning, facts, names, tone unless asked)",
      "what must change (the explicit transformation)",
      "target register and audience if given",
    ],
    output: "only the rewritten text, unless the person asked for explanations",
    pitfalls: ["changing meaning", "adding content", "explaining the edits when not asked"],
  },
  research: {
    method: [
      "precise research question and scope",
      "source quality and recency",
      "separating established facts from estimates and opinion",
      "conflicting evidence",
    ],
    output: "direct answer first, then supporting points with sources; uncertainty flagged where it applies",
    pitfalls: ["unsourced claims", "outdated information presented as current", "false certainty"],
  },
  analysis: {
    method: [
      "the question the analysis must answer",
      "evidence for each conclusion",
      "alternative explanations",
      "impact/priority of each finding",
    ],
    output: "main conclusion first, then findings ordered by importance, each with its evidence and implication",
    pitfalls: ["conclusions without evidence", "listing observations without implications", "ignoring uncertainty"],
  },
  strategy: {
    method: [
      "goal and success metric",
      "options with trade-offs",
      "assumptions that must hold",
      "risks and how to mitigate them",
      "decision criteria",
    ],
    output: "recommendation first, then options compared on the same criteria, then the main risks",
    pitfalls: ["one-sided recommendation", "hidden assumptions", "advice too generic to act on"],
  },
  product: {
    method: [
      "user and problem being solved",
      "evidence of the problem",
      "scope (in/out)",
      "success metrics",
      "edge cases and dependencies",
    ],
    output: "problem → proposal → scope → acceptance criteria → risks/open questions",
    pitfalls: ["solution before problem", "untestable requirements", "scope creep"],
  },
  ux: {
    method: [
      "entry point: what draws attention first and whether it is the most important",
      "reading order and scan path",
      "visual weight contrast (size, typography weight, color, saturation)",
      "grouping and spacing (proximity, alignment)",
      "density and noise",
      "consistency of treatment",
      "affordances, feedback and error states",
      "accessibility (contrast, target size, labels)",
    ],
    output:
      "short overall diagnosis, then problems ordered by severity; for each: what happens and where → why it hurts the user → concrete fix → severity (high/medium/low)",
    pitfalls: ["vague advice ('improve hierarchy')", "critiques not tied to a visible element"],
  },
  ui: {
    method: [
      "layout and grid",
      "typographic scale",
      "color roles and contrast",
      "spacing system",
      "component states (hover, focus, disabled, error, empty, loading)",
      "responsiveness",
      "accessibility",
    ],
    output: "specific, implementable changes (values, components, states), grouped by area",
    pitfalls: ["aesthetic opinions without rationale", "ignoring states and responsiveness"],
  },
  coding: {
    method: [
      "exact behavior and inputs/outputs",
      "language, version and constraints given",
      "edge cases and error handling",
      "readability and conventions",
      "how to verify (tests or examples)",
    ],
    output: "the code, then one line on how to run it",
    pitfalls: [
      "unrequested frameworks or dependencies",
      "untested happy-path-only code",
      "silently guessing unspecified behavior",
    ],
  },
  implementation: {
    method: [
      "inspect the existing code and conventions before editing",
      "minimal change that satisfies the requirement",
      "files/modules likely affected (only if named)",
      "tests to add/update",
      "backward compatibility",
      "running build/tests/lint",
    ],
    output: "done-when criteria the agent must meet; final summary of files changed, commands run and results",
    pitfalls: ["refactoring unrelated code", "adding dependencies without need", "declaring success without running tests"],
  },
  debugging: {
    method: [
      "reproduce first",
      "isolate the root cause (not the symptom)",
      "form and test hypotheses",
      "regression test that fails before and passes after",
      "check related code paths for the same bug",
    ],
    output: "root cause, the fix, the test proving it, and anything else affected",
    pitfalls: ["patching symptoms", "fixing without reproducing", "changing behavior beyond the bug"],
  },
  data_analysis: {
    method: [
      "question to answer and metric definitions",
      "data quality checks (missing, duplicates, outliers)",
      "appropriate comparisons/segments",
      "statistical caution (sample size, correlation vs causation)",
      "how results were computed",
    ],
    output: "key answer first, then the supporting numbers/tables; caveats only where they change the conclusion",
    pitfalls: ["unverified numbers", "causal claims from correlation", "hiding data issues"],
  },
  classification: {
    method: [
      "closed list of labels with definitions",
      "decision rules for ambiguous cases",
      "a fallback label (e.g. 'other'/'uncertain')",
      "consistent output schema",
    ],
    output: "strict machine-readable format (e.g. one JSON object per item) with label and short justification",
    pitfalls: ["labels outside the list", "inconsistent format", "forcing a label when evidence is insufficient"],
  },
  brainstorming: {
    method: [
      "quantity requested",
      "diversity across different angles/approaches",
      "constraints to respect",
      "criteria to judge ideas",
    ],
    output: "numbered list; a one-line rationale per idea only when the person gave criteria or asked why",
    pitfalls: ["near-duplicate ideas", "ignoring constraints", "only obvious ideas"],
  },
  image_generation: {
    method: [
      "subject",
      "composition and framing",
      "style/medium",
      "lighting and color palette",
      "mood",
      "aspect ratio",
      "elements to avoid",
    ],
    output: "a single dense descriptive prompt in the order subject → setting → style → lighting → composition → details",
    pitfalls: ["vague adjectives", "contradictory styles", "too many subjects"],
  },
  automation: {
    method: [
      "trigger, inputs and outputs",
      "steps and integrations involved",
      "idempotency and retries",
      "error handling and alerts",
      "secrets handling",
      "how to test safely",
    ],
    output: "the automation (script/workflow) plus setup steps and a safe test procedure",
    pitfalls: ["no error handling", "hard-coded secrets", "destructive actions without confirmation"],
  },
  agent_task: {
    method: [
      "goal and definition of done",
      "scope: what may and may not be changed",
      "tools to use and when",
      "when to act vs when to ask",
      "checkpoints and verification",
      "failure and stop conditions",
    ],
    output: "done-when checklist and a final report of actions taken, results and remaining issues",
    pitfalls: ["open-ended tasks with no stop condition", "acting outside scope", "claiming success without verification"],
  },
  planning: {
    method: [
      "goal and deadline/constraints given",
      "phases and dependencies",
      "owners/resources only if given",
      "risks and buffers",
      "milestones and how to measure progress",
    ],
    output: "plan at the granularity the request implies (e.g. by week), with steps in a realistic order",
    pitfalls: ["unrealistic sequencing", "missing dependencies"],
  },
  general: {
    method: ["the concrete outcome wanted", "what a good answer must include", "what to do when information is missing"],
    output: "the most direct format that serves the outcome",
    pitfalls: ["answering a different question"],
  },
};
