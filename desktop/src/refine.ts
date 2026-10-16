/**
 * macOS Service entry point: selected text on stdin → refined prompt on stdout.
 *
 * On success it prints the refined prompt and exits 0; the Service replaces the selection with it.
 * On ANY failure it prints NOTHING to stdout, writes the reason to stderr and exits 1. The Service
 * then fails and the requesting app does not touch the selection at all (verified empirically with
 * NSPerformService: a failing workflow returns no text, only NSServiceErrorReturnPasteboardType).
 * Returning the original text instead is NOT safe: rich editors (ProseMirror in Claude/ChatGPT)
 * re-parse it and add paragraph spacing; returning an empty string deletes the selection in
 * Chromium/Electron apps. The user sees what happened through the helper's HUD (feedback.ts).
 *
 *   node dist/refine.mjs --target auto|chatgpt|claude|gemini|codex|claude-code [--depth balanced|deep]
 *                        [--format markdown|auto] [--kind prompt|claude-md|agents-md]
 * --format is optional (omitted = the backend default, Markdown). --kind claude-md/agents-md turns
 * notes about a project into a CLAUDE.md / AGENTS.md; the target is then implied (--target ignored).
 * Env: PROMPT_REFINER_ENDPOINT (default http://127.0.0.1:8787)
 */

import { pathToFileURL } from "node:url";
import {
  DEPTHS,
  type Depth,
  FORMATS,
  KIND_LABELS,
  KINDS,
  MAX_INPUT_CHARS,
  type OutputKind,
  type PromptFormat,
  REQUESTED_TARGETS,
  type RefineRequestBody,
  type RefineResponseBody,
  type RequestedTarget,
  TARGET_LABELS,
  TARGETS,
  type Target,
} from "../../shared/api.js";
import { frontmostBundleId, targetForApp } from "./apps.js";
import { type Feedback, showFeedback } from "./feedback.js";
import {
  backendErrorDetail,
  FAILED,
  invalidResponseDetail,
  SELECT_PROMPT,
  timeoutDetail,
  tooLongDetail,
  unavailableDetail,
} from "./messages.js";

const TIMEOUT_MS = 55_000; // below the Service's 60 s NSTimeout

export interface RunDeps {
  endpoint: string;
  feedback: Feedback;
  frontmostBundleId: () => Promise<string | null>;
  language: string;
}

/** `output` replaces the selection; on failure the selection must be left untouched. */
export type RunResult = { ok: true; output: string } | { ok: false; reason: string };

export interface RunOptions {
  /** Default "prompt". */
  kind?: OutputKind;
  /** Omitted = the backend default (Markdown). Not sent for instruction files (always Markdown). */
  format?: PromptFormat;
}

/** Instruction files imply their target (the backend enforces the same mapping). */
const FILE_TARGET: Record<Exclude<OutputKind, "prompt">, Target> = { "claude-md": "claude-code", "agents-md": "codex" };

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseTarget(argv: string[]): RequestedTarget {
  const value = arg(argv, "--target");
  return REQUESTED_TARGETS.includes(value as RequestedTarget) ? (value as RequestedTarget) : "auto";
}

function parseDepth(argv: string[]): Depth {
  const value = arg(argv, "--depth");
  return DEPTHS.includes(value as Depth) ? (value as Depth) : "balanced";
}

export function parseOptions(argv: string[]): RunOptions {
  const kind = arg(argv, "--kind");
  const format = arg(argv, "--format");
  return {
    kind: KINDS.includes(kind as OutputKind) ? (kind as OutputKind) : "prompt",
    ...(FORMATS.includes(format as PromptFormat) ? { format: format as PromptFormat } : {}),
  };
}

const label = (t: Target) => (t === "generic" ? null : TARGET_LABELS[t]);

function isResponse(v: unknown): v is RefineResponseBody {
  const o = v as Record<string, unknown> | null;
  return (
    !!o &&
    typeof o.refinedPrompt === "string" &&
    o.refinedPrompt.trim() !== "" &&
    o.refinedPrompt.length <= 40_000 &&
    TARGETS.includes(o.target as Target)
  );
}

async function failed(deps: RunDeps, detail: string, title = FAILED, style: "error" | "info" = "error"): Promise<RunResult> {
  await deps.feedback(style, title, detail || undefined);
  return { ok: false, reason: detail ? `${title} ${detail}` : title };
}

export async function run(
  input: string,
  requested: RequestedTarget,
  deps: RunDeps,
  depth: Depth = "balanced",
  { kind = "prompt", format }: RunOptions = {},
): Promise<RunResult> {
  const file = kind === "prompt" ? null : KIND_LABELS[kind];
  const failedTitle = file ? `Não foi possível gerar o ${file}.` : FAILED;
  const fail = (detail: string) => failed(deps, detail, failedTitle);
  if (!input.trim())
    return failed(deps, "", file ? `Selecione as anotações sobre o projeto para gerar o ${file}.` : SELECT_PROMPT, "info");
  if (input.length > MAX_INPUT_CHARS) return fail(tooLongDetail(input.length, MAX_INPUT_CHARS));

  const target: Target =
    kind !== "prompt" ? FILE_TARGET[kind] : requested === "auto" ? targetForApp(await deps.frontmostBundleId()) : requested;
  const name = label(target);
  const suffix = depth === "deep" ? " (profundo)" : "";
  void deps.feedback(
    "progress",
    file ? `Gerando ${file}...` : `${(name ? `Refinando para ${name}` : "Refinando prompt") + suffix}...`,
  );

  let res: Response;
  try {
    const body: RefineRequestBody = { text: input, target, depth, language: deps.language };
    if (kind !== "prompt") body.kind = kind;
    else if (format) body.format = format;
    res = await fetch(`${deps.endpoint}/api/refine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error).name === "TimeoutError";
    return fail(timedOut ? timeoutDetail(TIMEOUT_MS / 1000) : unavailableDetail(deps.endpoint));
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    if ((err as Error).name === "TimeoutError") return fail(timeoutDetail(TIMEOUT_MS / 1000));
    data = null;
  }
  if (!res.ok) {
    const code = (data as { error?: { code?: unknown } } | null)?.error?.code;
    return fail(backendErrorDetail(typeof code === "string" ? code : undefined, res.status));
  }
  if (!isResponse(data)) return fail(invalidResponseDetail);

  // Keep the selection's trailing line break, if it had one (common when selecting whole lines).
  const trailing = /\n+$/.exec(input)?.[0] ?? "";
  const done = file ? `${file} gerado` : (name ? `Prompt refinado para ${name}` : "Prompt refinado") + suffix;
  await deps.feedback("success", `${done} — ⌘Z desfaz`);
  return { ok: true, output: data.refinedPrompt + trailing };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const input = await readStdin();
  const argv = process.argv.slice(2);
  const result = await run(
    input,
    parseTarget(argv),
    {
      endpoint: (process.env.PROMPT_REFINER_ENDPOINT || "http://127.0.0.1:8787").replace(/\/+$/, ""),
      feedback: showFeedback,
      frontmostBundleId,
      language: Intl.DateTimeFormat().resolvedOptions().locale,
    },
    parseDepth(argv),
    parseOptions(argv),
  );
  if (result.ok) {
    process.stdout.write(result.output);
  } else {
    // Non-zero exit = the Service fails = the requesting app keeps the selection as it was.
    process.stderr.write(result.reason);
    process.exitCode = 1;
  }
}
