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

// --- planilhas do painel ---------------------------------------------------------------------

/** Onde o painel de medições busca os dados: sempre a última rodada completa, no mesmo caminho. */
export const PAINEL_DIR = join(REPO_ROOT, ".local", "dados", "painel");

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/** Grupo da tabela do painel, deduzido do prefixo do nome do caso. */
function grupoDoCaso(nome: string): string {
  if (nome.startsWith("DNH")) return "Nao piorar o que ja esta bom";
  if (nome.startsWith("IDEM")) return "Idempotencia";
  if (nome.startsWith("LEAK")) return "Vazamento";
  if (nome.startsWith("HOSTIL")) return "Entrada hostil";
  if (nome.startsWith("FILE")) return "Arquivo de instrucao";
  if (nome.startsWith("DEEP")) return "Modo profundo";
  if (nome.startsWith("MD") || nome.startsWith("AUTO")) return "Formato";
  if (nome.startsWith("LONG")) return "Entrada longa";
  return "Basico";
}

/**
 * Reescreve as planilhas que o painel de medições lê, com os números desta rodada. Só é chamada numa
 * rodada completa e real: uma rodada filtrada ou simulada deixaria o painel com dados parciais.
 * O painel busca os arquivos pelo caminho fixo, então cada rodada completa já o deixa pronto para anexar.
 */
export function writePainelCsv(cases: CaseAggregate[]): string[] {
  mkdirSync(PAINEL_DIR, { recursive: true });
  const med = (c: CaseAggregate, k: string) => c.aggregates[k]?.median ?? "";
  const round1 = (v: number | string) => (typeof v === "number" ? Math.round(v * 10) / 10 : v);
  const int = (v: number | string) => (typeof v === "number" ? Math.round(v) : v);

  const testes = join(PAINEL_DIR, "testes-eval.csv");
  writeFileSync(
    testes,
    csv(
      [
        "caso",
        "grupo",
        "entra_chars",
        "sai_chars",
        "fator",
        "tokens_saida",
        "tokens_visivel",
        "tokens_rascunho",
        "tempo_s",
        "reps",
        "reps_ok",
      ],
      [...cases]
        .sort((a, b) => (b as { inputChars?: number }).inputChars! - (a as { inputChars?: number }).inputChars!)
        .map((c) => [
          c.name,
          grupoDoCaso(c.name),
          (c as { inputChars?: number }).inputChars ?? "",
          int(med(c, "outputChars")),
          typeof med(c, "growth") === "number" ? Math.round((med(c, "growth") as number) * 100) / 100 : "",
          int(med(c, "outputTokens")),
          int(med(c, "visibleTokensEst")),
          int(med(c, "reasoningTokensEst")),
          round1(typeof med(c, "latencyMs") === "number" ? (med(c, "latencyMs") as number) / 1000 : ""),
          c.reps,
          c.repsPassed,
        ]),
    ),
  );

  // Quantas vezes cada propriedade foi verificada, somando casos e repetições.
  const porNome = new Map<string, number>();
  for (const c of cases) {
    for (const ch of c.checks) {
      const base = ch.name.split("[")[0]!;
      porNome.set(base, (porNome.get(base) ?? 0) + ch.passed + ch.failed);
    }
  }
  const rotulos: Record<string, string> = {
    mustInclude: "Fatos e termos da pessoa sobreviveram",
    mustNotInclude: "Nao vazou instrucao nem poluiu o formato",
    taskType: "Classificou o tipo de tarefa",
    maxComplexity: "Nao complicou demais",
    minComplexity: "Nao simplificou demais",
    notInflated: "Nao inchou o prompt",
    languagePreserved: "Manteve o idioma",
    requireLanguage: "Idioma exigido do arquivo",
    noPreamble: "Sem enrolacao antes do prompt",
    doNoHarmGrowth: "Prompt bom voltou do mesmo tamanho",
    wordOverlap: "Palavras da pessoa preservadas",
    idempotence: "Refinar duas vezes nao incha",
    latencyCeiling: "Dentro do teto de tempo",
    noQualityWarning: "Sem alerta de qualidade do motor",
  };
  const checagens = join(PAINEL_DIR, "checagens.csv");
  writeFileSync(
    checagens,
    csv(
      ["protege", "vezes"],
      [...porNome.entries()].sort((a, b) => b[1] - a[1]).map(([nome, n]) => [rotulos[nome] ?? nome, n]),
    ),
  );
  return [testes, checagens];
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

/**
 * Quanto cada métrica precisa mexer para a diferença significar algo. Calibrado comparando DUAS
 * rodadas do MESMO motor (2026-10-30-152236-or48 vs 2026-10-30-184534-kcbc, 3 rep. cada): como nada
 * no motor mudou entre elas, toda diferença observada ali era ruído.
 *
 *   métrica              desvio mediano   pior caso
 *   outputChars                    0,9%       14,0%
 *   visibleTokensEst               1,2%       13,9%
 *   outputTokens                   1,2%       48,0%
 *   reasoningTokensEst             0,7%       72,0%
 *   latencyMs                     27,3%      130,2%
 *
 * Tamanho e tokens visíveis são estáveis, então um limite baixo já é confiável. Raciocínio e tempo
 * oscilam muito em casos isolados (o modelo às vezes pensa o dobro), então um limite baixo ali só
 * geraria alarme falso — e relatório que apita sem motivo é relatório que se aprende a ignorar.
 *
 * AVISO: estimativa de ruído a partir de 2 rodadas só; reaperte quando houver mais histórico.
 * Com este ruído, o eval NÃO detecta regressão de tempo abaixo de ~75% em 3 repetições: para isso
 * seriam necessárias mais repetições, não um limite menor.
 */
export const NOISE_THRESHOLD_PCT: Record<string, number> = {
  outputChars: 20,
  visibleTokensEst: 20,
  outputTokens: 50,
  reasoningTokensEst: 75,
  latencyMs: 75,
};

/** Limite de ruído de uma métrica; 20% para qualquer métrica nova ainda não calibrada. */
export const noiseThreshold = (key: string): number => NOISE_THRESHOLD_PCT[key] ?? 20;

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
