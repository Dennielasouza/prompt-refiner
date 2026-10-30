/**
 * Gravação de rodada do eval — Passo 1a de `.local/plano-eval-validado.md`.
 *
 * Estatística, divisão de tokens, escrita do JSONL e comparação com a baseline. Tudo aqui é
 * ferramenta offline: nada neste arquivo roda no caminho do pedido do usuário e nada chama modelo.
 *
 * Duas decisões do plano estão embutidas nas formas abaixo:
 * - nunca um número único: toda grandeza medida sai como mediana + espalhamento sobre N repetições;
 * - tokens de resposta incluem o raciocínio do modelo, então tokens visíveis e de raciocínio andam separados.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz do repositório, derivada da localização deste arquivo (o eval pode rodar de qualquer cwd). */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUNS_DIR = join(REPO_ROOT, ".local", "dados", "runs");
const BASELINE_POINTER = join(RUNS_DIR, "baseline.json");

// --- estatística ------------------------------------------------------------------------------

export interface Stats {
  n: number;
  median: number;
  mean: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  /** Intervalo interquartil: o espalhamento que acompanha a mediana. */
  iqr: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mediana + espalhamento de uma amostra. `null` para amostra vazia (caso que só deu erro). */
export function stats(values: number[]): Stats | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  return {
    n: sorted.length,
    median: round2(quantile(sorted, 0.5)),
    mean: round2(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: sorted[0]!,
    max: sorted.at(-1)!,
    p25: round2(p25),
    p75: round2(p75),
    iqr: round2(p75 - p25),
  };
}

/** mediana [p25–p75] — a única forma de imprimir um número medido. */
export function fmtStats(s: Stats | null, unit = ""): string {
  if (!s) return "—";
  return s.iqr === 0 ? `${s.median}${unit}` : `${s.median}${unit} [${s.p25}–${s.p75}]`;
}

// --- tokens -----------------------------------------------------------------------------------

/**
 * Contagem aproximada de tokens (≈4 caracteres/token). Usada SÓ para separar a parte da saída que a
 * pessoa vê da parte que o modelo gastou pensando — nunca para cobrar nem para substituir contagem real.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface OutputTokenSplit {
  /** Reportado pelo provider; inclui raciocínio (decisão 4 do plano). */
  total: number;
  visibleEst: number;
  reasoningEst: number;
}

/** Separa os tokens de saída reportados em visíveis vs raciocínio, usando a resposta como parte visível. */
export function splitOutputTokens(total: number, visibleAnswer: string): OutputTokenSplit {
  const visibleEst = Math.min(estimateTokens(visibleAnswer), total);
  return { total, visibleEst, reasoningEst: Math.max(0, total - visibleEst) };
}

export const TOKEN_SPLIT_METHOD =
  "visibleEst = ceil(chars/4) da resposta estruturada, limitado ao total; reasoningEst = total − visibleEst (estimativa, não contagem do provider)";

// --- versão do motor --------------------------------------------------------------------------

function git(args: string[]): string | null {
  try {
    const out = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function packageVersion(): string {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, "backend", "package.json"), "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export interface EngineVersion {
  /** Versão da instrução do compilador: o que muda a saída de verdade. */
  compilerVersion: string;
  gitCommit: string | null;
  /** Árvore suja = a rodada não é reproduzível a partir do commit. */
  gitDirty: boolean;
  packageVersion: string;
}

export function engineVersion(compilerVersion: string): EngineVersion {
  return {
    compilerVersion,
    gitCommit: git(["rev-parse", "--short", "HEAD"]),
    gitDirty: Boolean(git(["status", "--porcelain"])),
    packageVersion: packageVersion(),
  };
}

export function newRunId(now = new Date()): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
}

// --- escrita ----------------------------------------------------------------------------------

export class RunWriter {
  readonly file: string;
  constructor(readonly runId: string) {
    mkdirSync(RUNS_DIR, { recursive: true });
    this.file = join(RUNS_DIR, `${runId}.jsonl`);
    writeFileSync(this.file, "");
  }
  write(record: Record<string, unknown>): void {
    appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }
}

// --- baseline ---------------------------------------------------------------------------------

export interface BaselinePointer {
  runId: string;
  file: string;
  markedAt: string;
}

export interface CaseAggregate {
  type: "case";
  run: string;
  name: string;
  reps: number;
  repsPassed: number;
  aggregates: Record<string, Stats | null>;
  checks: { name: string; passed: number; failed: number; details: string[] }[];
}

export function readBaseline(): { pointer: BaselinePointer; cases: CaseAggregate[] } | null {
  if (!existsSync(BASELINE_POINTER)) return null;
  try {
    const pointer: BaselinePointer = JSON.parse(readFileSync(BASELINE_POINTER, "utf8"));
    const path = join(RUNS_DIR, pointer.file);
    if (!existsSync(path)) return null;
    const cases = readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r): r is CaseAggregate => r.type === "case");
    return { pointer, cases };
  } catch {
    return null;
  }
}

export function markBaseline(runId: string): BaselinePointer {
  const pointer: BaselinePointer = { runId, file: `${runId}.jsonl`, markedAt: new Date().toISOString() };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(BASELINE_POINTER, `${JSON.stringify(pointer, null, 2)}\n`);
  return pointer;
}

export interface CaseDelta {
  name: string;
  status: "novo" | "comparado" | "ausente";
  metrics?: { key: string; baseline: number; current: number; deltaPct: number }[];
  passRate?: { baseline: number; current: number };
}

const pct = (baseline: number, current: number) =>
  baseline === 0 ? 0 : Math.round(((current - baseline) / baseline) * 1000) / 10;

/** Compara medianas contra a baseline, caso por caso. Casos presentes em só uma das rodadas são marcados. */
export function compareWithBaseline(
  current: CaseAggregate[],
  baseline: CaseAggregate[],
  keys = ["outputTokens", "visibleTokensEst", "reasoningTokensEst", "latencyMs", "outputChars"],
): CaseDelta[] {
  const byName = new Map(baseline.map((c) => [c.name, c]));
  const deltas: CaseDelta[] = current.map((c) => {
    const b = byName.get(c.name);
    if (!b) return { name: c.name, status: "novo" };
    const metrics = keys.flatMap((key) => {
      const bs = b.aggregates[key];
      const cs = c.aggregates[key];
      return bs && cs ? [{ key, baseline: bs.median, current: cs.median, deltaPct: pct(bs.median, cs.median) }] : [];
    });
    return {
      name: c.name,
      status: "comparado" as const,
      metrics,
      passRate: {
        baseline: b.reps ? Math.round((b.repsPassed / b.reps) * 100) : 0,
        current: c.reps ? Math.round((c.repsPassed / c.reps) * 100) : 0,
      },
    };
  });
  const seen = new Set(current.map((c) => c.name));
  for (const b of baseline) if (!seen.has(b.name)) deltas.push({ name: b.name, status: "ausente" });
  return deltas;
}
