import { guessLanguage } from "./language.js";
import { type Complexity, type OutputKind, TASK_TYPES, type TaskType } from "./types.js";

export const MAX_REFINED_CHARS = 40_000;
const MAX_LIST_ITEMS = 12;
const MAX_ITEM_CHARS = 200;

export type ValidatedOutput = {
  refinedPrompt: string;
  taskType: TaskType;
  complexity: Complexity;
  strategies: string[];
  warnings: string[];
};

export class InvalidOutputError extends Error {}

/** Lines a model sometimes adds before the prompt despite instructions. */
const PREAMBLE =
  /^(aqui está|aqui esta|segue|eis|here is|here's|below is|prompt (refinado|otimizado|melhorado|refined|optimized|improved)|refined prompt|aquí está)[^\n]{0,80}:\s*\n+/i;

/**
 * UTF-8 text decoded with a single-byte charset ("nÃ£o", "dĂȘ"). Seen in live model output
 * (Claude Sonnet 5.5 with thinking turned off); never valid Portuguese/English/Spanish.
 */
const MOJIBAKE = /[ÃĂ][\u0080-\u00BF\u0100-\u017F\u0218-\u021B]/;

/** Info strings of a fence that wraps a whole prompt/file (not a real code block such as ```bash). */
const WRAPPER_LANGS = new Set(["", "markdown", "md", "text", "txt", "plain", "plaintext", "prompt", "xml"]);
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** True when every fenced block in `text` is closed (CommonMark-style pairing). */
function fencesBalanced(text: string): boolean {
  let open: { char: string; len: number } | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(FENCE_LINE);
    if (!m) continue;
    const [, fence, rest] = m;
    if (!open) open = { char: fence[0], len: fence.length };
    else if (fence[0] === open.char && fence.length >= open.len && !rest.trim()) open = null;
  }
  return open === null;
}

/**
 * Strip a code fence wrapping the WHOLE text. A text that merely starts and ends with real code
 * blocks (e.g. a CLAUDE.md beginning with ```bash and ending with ```) is left untouched.
 */
function stripWrappingFence(text: string): string {
  const m = text.match(/^(`{3,}|~{3,})[ \t]*([\w-]*)[ \t]*\n([\s\S]*)\n\1[ \t]*$/);
  if (!m || !WRAPPER_LANGS.has(m[2].toLowerCase())) return text;
  const inner = m[3];
  // The wrapper must be one block: its inner fences must pair up among themselves.
  return fencesBalanced(inner) ? inner.trim() : text;
}

/** Remove wrappers the model may have put around the prompt (fences, quotes, preamble). */
export function cleanRefinedPrompt(value: string): string {
  let text = value.replace(/\r\n/g, "\n").trim();
  text = text.replace(PREAMBLE, "").trim();
  text = stripWrappingFence(text);
  const quoted = text.match(/^["“«]([\s\S]*)["”»]$/);
  if (quoted && !quoted[1].includes('"')) text = quoted[1].trim();
  return text;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<string>();
  for (const item of value) {
    if (typeof item === "string" && item.trim()) out.add(item.trim().slice(0, MAX_ITEM_CHARS));
    if (out.size >= MAX_LIST_ITEMS) break;
  }
  return [...out];
}

/**
 * Validates untrusted model output and applies the deterministic part of the quality gate.
 * Throws InvalidOutputError when there is no usable prompt (the caller keeps the original text).
 */
export function validateCompilerOutput(raw: unknown, originalText: string, opts: { kind?: OutputKind } = {}): ValidatedOutput {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new InvalidOutputError("compiler output is not valid JSON");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new InvalidOutputError("compiler output is not an object");
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.refinedPrompt !== "string") throw new InvalidOutputError("refinedPrompt missing");
  const refinedPrompt = cleanRefinedPrompt(obj.refinedPrompt);
  if (!refinedPrompt) throw new InvalidOutputError("refinedPrompt is empty");
  if (refinedPrompt.length > MAX_REFINED_CHARS) throw new InvalidOutputError("refinedPrompt is too long");

  const taskType: TaskType = TASK_TYPES.includes(obj.taskType as TaskType) ? (obj.taskType as TaskType) : "general";

  const n = Math.round(Number(obj.complexity));
  const complexity = (Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 2) as Complexity;

  const warnings = stringList(obj.warnings);

  // Deterministic quality checks: flag, never block (no extra LLM calls).
  // Instruction files legitimately expand short notes into a structured file: no inflation check.
  const isFile = (opts.kind ?? "prompt") !== "prompt";
  if (!isFile && complexity <= 1 && refinedPrompt.length > Math.max(400, originalText.length * 3)) {
    warnings.push("quality:possible_inflation");
  }
  const srcLang = guessLanguage(originalText);
  const outLang = guessLanguage(refinedPrompt);
  if (srcLang && outLang && srcLang !== outLang) warnings.push(`quality:language_drift:${srcLang}->${outLang}`);
  if (MOJIBAKE.test(refinedPrompt) && !MOJIBAKE.test(originalText)) warnings.push("quality:mojibake");

  return { refinedPrompt, taskType, complexity, strategies: stringList(obj.strategies), warnings };
}
