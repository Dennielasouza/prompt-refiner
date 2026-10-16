import { accessSync, constants } from "node:fs";
import { isAbsolute } from "node:path";
import { FORMATS, type PromptFormat } from "../../../shared/api.js";
import { DEFAULT_CLAUDE_BIN, DEFAULT_CLAUDE_CWD } from "../providers/claudeCli.js";
import type { ProviderName } from "../providers/types.js";

export interface AppConfig {
  port: number;
  host: string;
  provider: ProviderName | null;
  model: string | null;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  /** claude-cli: absolute path of the `claude` binary and the neutral folder it runs in. */
  claudeBin: string;
  claudeCwd: string;
  effort?: "low" | "medium" | "high";
  timeoutMs: number;
  /** Format used when a request does not specify one (PROMPT_DEFAULT_FORMAT, default markdown). */
  defaultFormat: PromptFormat;
  maxOutputTokens: number;
  anthropicRefusalFallback: boolean;
  /** Exact origins, or prefixes ending in "*" (e.g. "chrome-extension://*"). */
  allowedOrigins: string[];
  /** Human-readable reason the compiler cannot run, if any. */
  configError?: string;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const openaiApiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const requested = env.PROMPT_COMPILER_PROVIDER?.trim().toLowerCase() || "";
  const model = env.PROMPT_COMPILER_MODEL?.trim() || null;
  const effortRaw = env.PROMPT_COMPILER_EFFORT?.trim().toLowerCase();
  const claudeBin = env.PROMPT_COMPILER_CLAUDE_BIN?.trim() || DEFAULT_CLAUDE_BIN;

  let provider: ProviderName | null = null;
  let configError: string | undefined;

  if (requested === "claude-cli") {
    // Uses the Claude subscription logged in to Claude Code; no API key needed.
    provider = "claude-cli";
    if (!isAbsolute(claudeBin))
      configError = `PROMPT_COMPILER_CLAUDE_BIN precisa ser um caminho absoluto (recebido: ${claudeBin}).`;
    else if (!isExecutable(claudeBin)) {
      configError = `PROMPT_COMPILER_PROVIDER=claude-cli, mas o Claude Code não foi encontrado em ${claudeBin} (instale o Claude Code ou defina PROMPT_COMPILER_CLAUDE_BIN).`;
    }
  } else if (requested === "anthropic" || requested === "openai") {
    provider = requested;
    const key = requested === "anthropic" ? anthropicApiKey : openaiApiKey;
    if (!key) configError = `PROMPT_COMPILER_PROVIDER=${requested} mas a chave de API correspondente não está definida.`;
  } else if (requested) {
    configError = `PROMPT_COMPILER_PROVIDER inválido: "${requested}" (use anthropic, openai ou claude-cli).`;
  } else if (anthropicApiKey) {
    provider = "anthropic";
  } else if (openaiApiKey) {
    provider = "openai";
  } else {
    configError = "Nenhuma chave de API configurada (ANTHROPIC_API_KEY ou OPENAI_API_KEY).";
  }
  if (!configError && !model) configError = "PROMPT_COMPILER_MODEL não está definido.";

  return {
    port: int(env.PORT, 8787),
    host: env.HOST?.trim() || "127.0.0.1",
    provider,
    model,
    anthropicApiKey,
    openaiApiKey,
    claudeBin,
    claudeCwd: DEFAULT_CLAUDE_CWD,
    effort: effortRaw === "low" || effortRaw === "medium" || effortRaw === "high" ? effortRaw : undefined,
    timeoutMs: int(env.PROMPT_COMPILER_TIMEOUT_MS, 45_000),
    defaultFormat: FORMATS.includes(env.PROMPT_DEFAULT_FORMAT?.trim() as PromptFormat)
      ? (env.PROMPT_DEFAULT_FORMAT!.trim() as PromptFormat)
      : "markdown",
    maxOutputTokens: int(env.PROMPT_COMPILER_MAX_TOKENS, 16_000),
    anthropicRefusalFallback: env.ANTHROPIC_REFUSAL_FALLBACK?.trim().toLowerCase() !== "false",
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "chrome-extension://*")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    configError,
  };
}
