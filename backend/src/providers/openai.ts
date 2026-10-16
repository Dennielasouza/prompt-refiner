import OpenAI from "openai";
import { type CompileRequest, type CompilerProvider, ProviderError, type ProviderSettings } from "./types.js";

export function createOpenAIProvider(settings: ProviderSettings): CompilerProvider {
  const client = new OpenAI({ apiKey: settings.apiKey, maxRetries: 1, fetch: settings.fetch });

  return {
    name: "openai",
    async compile(req: CompileRequest) {
      let res: OpenAI.Responses.Response;
      try {
        res = await client.responses.create(
          {
            model: settings.model,
            instructions: [req.coreInstruction, req.depthInstruction, req.formatInstruction, req.destinationInstruction]
              .filter(Boolean)
              .join("\n\n"),
            input: req.userMessage,
            max_output_tokens: settings.maxOutputTokens,
            text: { format: { type: "json_schema", name: "refined_prompt", schema: req.schema, strict: true } },
            ...(settings.effort ? { reasoning: { effort: settings.effort } } : {}),
          },
          { signal: req.signal },
        );
      } catch (err) {
        throw mapOpenAIError(err, req.signal);
      }

      if (res.usage) {
        const cached = res.usage.input_tokens_details?.cached_tokens ?? 0;
        req.onUsage?.({
          inputTokens: res.usage.input_tokens - cached,
          outputTokens: res.usage.output_tokens,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
        });
      }
      if (res.status === "incomplete") throw new ProviderError("invalid_output", "compiler output was truncated");
      for (const item of res.output) {
        if (item.type === "message" && item.content.some((c) => c.type === "refusal")) {
          throw new ProviderError("refusal", "compiler model declined the request");
        }
      }
      try {
        return JSON.parse(res.output_text);
      } catch {
        throw new ProviderError("invalid_output", "compiler output is not valid JSON");
      }
    },
  };
}

function mapOpenAIError(err: unknown, signal: AbortSignal): ProviderError {
  if (signal.aborted || err instanceof OpenAI.APIUserAbortError || err instanceof OpenAI.APIConnectionTimeoutError) {
    return new ProviderError("timeout", "compiler request timed out");
  }
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new ProviderError("auth", "OpenAI rejected the API key");
  }
  if (err instanceof OpenAI.RateLimitError) return new ProviderError("rate_limited", "OpenAI rate limit");
  if (err instanceof OpenAI.APIError) return new ProviderError("upstream", `OpenAI API error ${err.status ?? "network"}`);
  return new ProviderError("upstream", "OpenAI request failed");
}
