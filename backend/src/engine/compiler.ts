import type { CompilerProvider, TokenUsage } from "../providers/types.js";
import { ProviderError } from "../providers/types.js";
import { buildCoreInstruction, buildSystemParts, buildUserMessage } from "./instruction.js";
import { guessLanguage } from "./language.js";
import { InvalidOutputError, validateCompilerOutput } from "./output.js";
import { COMPILER_OUTPUT_SCHEMA } from "./schema.js";
import { resolveTarget } from "./targets.js";
import type { RefineInput, RefineResult } from "./types.js";

const CORE_INSTRUCTION = buildCoreInstruction();

/**
 * Prompt Intelligence Engine entry point.
 * Intent analysis → classification → complexity → strategy → target adaptation → generation → quality gate
 * happen in ONE compiler call; this function prepares it and validates the result.
 */
export async function refinePrompt(
  input: RefineInput,
  provider: CompilerProvider,
  opts: { timeoutMs: number; onUsage?: (usage: TokenUsage) => void },
): Promise<RefineResult> {
  const kind = input.kind ?? "prompt";
  // Instruction files imply their agent; they are always Markdown.
  const target =
    kind === "claude-md" ? "claude-code" : kind === "agents-md" ? "codex" : resolveTarget(input.target, input.hostname);
  const depth = input.depth ?? "balanced";
  const format = kind === "prompt" ? (input.format ?? "markdown") : "markdown";
  // The locale hint is a fallback. It competes with the text's own language (English notes or an
  // English "translate to spanish: …" prompt from a pt-BR browser came out in Portuguese), so drop it
  // whenever the text's language is clear.
  const language = guessLanguage(input.text) ? undefined : input.language;
  const signal = AbortSignal.timeout(opts.timeoutMs);

  const timedOut = new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(new ProviderError("timeout", "compiler request timed out")), {
      once: true,
    }),
  );
  // Race so a provider that ignores the signal still cannot exceed the timeout.
  const raw = await Promise.race([
    provider.compile({
      coreInstruction: CORE_INSTRUCTION,
      ...buildSystemParts({ kind, depth, format, target }),
      // Balanced prompts are ~80% of real use; their blocks are worth keeping for 1 h.
      longCacheDepth: kind === "prompt" && depth === "balanced",
      userMessage: buildUserMessage(input.text, language, kind),
      schema: COMPILER_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      signal,
      onUsage: opts.onUsage,
    }),
    timedOut,
  ]);

  try {
    return { ...validateCompilerOutput(raw, input.text, { kind }), target, depth, format, kind };
  } catch (err) {
    if (err instanceof InvalidOutputError) throw new ProviderError("invalid_output", err.message);
    throw err;
  }
}
