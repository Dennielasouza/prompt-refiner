/**
 * Contract shared by the extension and the backend.
 * "target" = the agent the prompt is optimized FOR, not the model that refines it.
 */
export const TARGETS = ["generic", "chatgpt", "claude", "gemini", "codex", "claude-code"] as const;
export type Target = (typeof TARGETS)[number];

export const REQUESTED_TARGETS = ["auto", ...TARGETS] as const;
export type RequestedTarget = (typeof REQUESTED_TARGETS)[number];

/** Display names (pt-BR UI). */
export const TARGET_LABELS: Record<RequestedTarget, string> = {
  auto: "Automático",
  generic: "uso geral",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
};

/**
 * How much prompt-engineering method the refiner adds.
 * balanced: clarifies and structures what the person wrote.
 * deep: also adds the method a senior practitioner would use (evaluation criteria, process,
 *       output contract, uncertainty handling, verification) — never new facts.
 */
export const DEPTHS = ["balanced", "deep"] as const;
export type Depth = (typeof DEPTHS)[number];

/**
 * How the refined prompt is formatted.
 * markdown (default): structure with Markdown (## headings, lists, **bold**, ``` fences); never XML tags.
 * auto: the target adapter decides (e.g. XML tags for complex Claude prompts).
 */
export const FORMATS = ["markdown", "auto"] as const;
export type PromptFormat = (typeof FORMATS)[number];

/**
 * What to produce from the selected text.
 * prompt: a refined prompt for the target (default).
 * claude-md / agents-md: an agent instructions file (CLAUDE.md for Claude Code, AGENTS.md for Codex
 * and other agents) written from the person's notes about a project. Always Markdown.
 */
export const KINDS = ["prompt", "claude-md", "agents-md"] as const;
export type OutputKind = (typeof KINDS)[number];

export const KIND_LABELS: Record<OutputKind, string> = {
  prompt: "prompt",
  "claude-md": "CLAUDE.md",
  "agents-md": "AGENTS.md",
};

/** Max characters accepted for a raw prompt. Enforced on both sides. */
export const MAX_INPUT_CHARS = 12_000;

export interface RefineRequestBody {
  text: string;
  target: RequestedTarget;
  /** Only sent for target "auto". */
  hostname?: string;
  language?: string;
  /** Defaults to "balanced". */
  depth?: Depth;
  /** Defaults to the backend's PROMPT_DEFAULT_FORMAT (markdown). Ignored for instruction files (always Markdown). */
  format?: PromptFormat;
  /** Defaults to "prompt". For claude-md/agents-md the target is implied (claude-code/codex). */
  kind?: OutputKind;
}

export interface RefineResponseBody {
  refinedPrompt: string;
  target: Target;
  depth: Depth;
  format: PromptFormat;
  kind: OutputKind;
  taskType: string;
  complexity: number;
  strategies: string[];
  warnings: string[];
}

export interface ErrorResponseBody {
  error: { code: string; message: string };
}

export interface HealthResponseBody {
  status: "ok" | "misconfigured";
  provider: string | null;
  compilerVersion: string;
  message?: string;
}
