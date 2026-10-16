import Anthropic from "@anthropic-ai/sdk";
import { type CompileRequest, type CompilerProvider, ProviderError, type ProviderSettings } from "./types.js";

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

const LONG_CACHE = { type: "ephemeral" as const, ttl: "1h" as const };
const SHORT_CACHE = { type: "ephemeral" as const };

export function createAnthropicProvider(settings: ProviderSettings & { refusalFallback: boolean }): CompilerProvider {
  const client = new Anthropic({ apiKey: settings.apiKey, maxRetries: 1, fetch: settings.fetch });
  const useFallback = settings.refusalFallback && FALLBACK_MODELS.has(settings.model);

  return {
    name: "anthropic",
    async compile(req: CompileRequest) {
      const depthCache = req.longCacheDepth ? LONG_CACHE : SHORT_CACHE;
      const params = {
        model: settings.model,
        max_tokens: settings.maxOutputTokens,
        // Most stable first: core → depth → format are cached (≤ 3 breakpoints); destination varies per target.
        // Use is sporadic (gaps of 5–60 min are common), so the core lives 1 h; depth/format only when
        // the caller says they are reused often. Longer TTLs must come before shorter ones.
        system: [
          { type: "text" as const, text: req.coreInstruction, cache_control: LONG_CACHE },
          { type: "text" as const, text: req.depthInstruction, cache_control: depthCache },
          ...(req.formatInstruction ? [{ type: "text" as const, text: req.formatInstruction, cache_control: depthCache }] : []),
          { type: "text" as const, text: req.destinationInstruction },
        ],
        messages: [{ role: "user" as const, content: req.userMessage }],
        output_config: {
          format: { type: "json_schema" as const, schema: req.schema },
          ...(settings.effort ? { effort: settings.effort } : {}),
        },
      };

      let stopReason: string | null;
      let content: Array<{ type: string; text?: string }>;
      try {
        const res = useFallback
          ? await client.beta.messages.create(
              { ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" },
              { signal: req.signal },
            )
          : await client.messages.create(params, { signal: req.signal });
        stopReason = res.stop_reason;
        content = res.content;
        req.onUsage?.({
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          cacheWrite1hTokens: res.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
          thinkingBlocks: res.content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking").length,
        });
      } catch (err) {
        throw mapAnthropicError(err, req.signal);
      }

      if (stopReason === "refusal") throw new ProviderError("refusal", "compiler model declined the request");
      if (stopReason === "max_tokens") throw new ProviderError("invalid_output", "compiler output was truncated");
      const text = content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      try {
        return JSON.parse(text);
      } catch {
        throw new ProviderError("invalid_output", "compiler output is not valid JSON");
      }
    },
  };
}

function mapAnthropicError(err: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted || err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("timeout", "compiler request timed out");
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("auth", "Anthropic rejected the API key");
  }
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("rate_limited", "Anthropic rate limit");
  if (err instanceof Anthropic.APIError) {
    return new ProviderError("upstream", `Anthropic API error ${err.status ?? "network"}`);
  }
  return new ProviderError("upstream", "Anthropic request failed");
}
