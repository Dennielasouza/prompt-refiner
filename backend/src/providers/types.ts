export interface CompileRequest {
  /** Stable instruction shared by every request (cacheable). */
  coreInstruction: string;
  /** Depth-specific instruction (balanced/deep; for instruction files, the file job). Stable per depth, cacheable. */
  depthInstruction: string;
  /** Format-specific instruction (stable per format, cacheable). Empty/absent = no format block. */
  formatInstruction?: string;
  /**
   * Keep the depth/format blocks cached for 1 h instead of 5 min. Worth it only for the blocks used
   * most often (balanced prompts): a 1 h write costs 2× input vs 1.25×, so rarely reused blocks get dearer.
   */
  longCacheDepth?: boolean;
  /** Per-target instruction (adapter guidance), or per-file-kind guidance for instruction files. */
  destinationInstruction: string;
  userMessage: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  /** Called with token usage when the provider reports it (for cost tracking; no content). */
  onUsage?: (usage: TokenUsage) => void;
}

export interface TokenUsage {
  /** Uncached input tokens. */
  inputTokens: number;
  /** Output tokens, including any internal reasoning/thinking tokens (billed as output). */
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Part of `cacheWriteTokens` written with the 1 h TTL (billed at 2× input instead of 1.25×). */
  cacheWrite1hTokens?: number;
  /**
   * Number of thinking blocks in the answer (Anthropic). 0 = the model answered without extended
   * thinking; shows how much of `outputTokens` (and latency) is reasoning when tuning the effort.
   */
  thinkingBlocks?: number;
}

/** The model that REFINES the prompt. Independent of the prompt's target. */
export interface CompilerProvider {
  readonly name: ProviderName;
  /** Returns the parsed structured object (still untrusted; validated by the engine). */
  compile(req: CompileRequest): Promise<unknown>;
}

/** `claude-cli`: Claude Code's print mode, billed to the person's Claude subscription (no API credits). */
export type ProviderName = "anthropic" | "openai" | "claude-cli";

export type ProviderErrorKind = "timeout" | "rate_limited" | "auth" | "refusal" | "invalid_output" | "upstream";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface ProviderSettings {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  effort?: "low" | "medium" | "high";
  /** Test seam: custom fetch passed to the official SDK client. */
  fetch?: typeof fetch;
}
