import type { ProviderName, TokenUsage } from "../providers/types.js";

/**
 * USD per million tokens, used only to ESTIMATE cost in logs. Update when prices change
 * (Anthropic first-party API list prices as of 2026-09; cache write = 1.25× input for the 5-minute TTL,
 * cacheWrite1h = 2× input for the 1-hour TTL).
 * Unknown models → no estimate.
 */
export const PRICES_PER_MTOK: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number }
> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWrite1h: 4 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, cacheWrite1h: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWrite1h: 2 },
};

export function estimateCostUsd(model: string | null, usage: TokenUsage): number | null {
  const p = model ? PRICES_PER_MTOK[model] : undefined;
  if (!p) return null;
  const write1h = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens);
  const usd =
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      (usage.cacheWriteTokens - write1h) * p.cacheWrite +
      write1h * p.cacheWrite1h) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/**
 * API cost of one call for the configured provider. `claude-cli` runs on the Claude subscription: there
 * is no API charge (it only counts against the plan's usage limits), so the cost is unavailable (null) —
 * never an invented API price, and it does not drag the per-mode API averages of the usage report to 0.
 */
export function callCostUsd(provider: ProviderName | null, model: string | null, usage: TokenUsage): number | null {
  return provider === "claude-cli" ? null : estimateCostUsd(model, usage);
}
