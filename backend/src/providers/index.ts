import type { AppConfig } from "../config/env.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createClaudeCliProvider } from "./claudeCli.js";
import { createOpenAIProvider } from "./openai.js";
import type { CompilerProvider } from "./types.js";

/** Returns the configured compiler provider, or null when the config is incomplete. */
export function createProvider(config: AppConfig): CompilerProvider | null {
  if (config.configError || !config.provider || !config.model) return null;
  const base = { model: config.model, maxOutputTokens: config.maxOutputTokens, effort: config.effort };
  if (config.provider === "claude-cli") {
    return createClaudeCliProvider({ bin: config.claudeBin, cwd: config.claudeCwd, model: config.model, effort: config.effort });
  }
  if (config.provider === "anthropic") {
    return createAnthropicProvider({
      ...base,
      apiKey: config.anthropicApiKey!,
      refusalFallback: config.anthropicRefusalFallback,
    });
  }
  return createOpenAIProvider({ ...base, apiKey: config.openaiApiKey! });
}
