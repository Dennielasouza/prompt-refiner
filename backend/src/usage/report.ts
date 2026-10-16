import { estimateCostUsd } from "../config/pricing.js";

/**
 * Usage report built from the backend log (metadata only: tokens, cost, time — never text).
 * Designed for humans: money per mode, totals at the bottom, technical details on demand.
 */

export interface UsageEntry {
  time: number;
  failed: boolean;
  depth: "balanced" | "deep";
  /** Provider that ran the call (absent in logs written before it was recorded). */
  provider?: string;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Part of cacheWriteTokens written with the 1 h TTL. */
  cacheWrite1hTokens?: number;
  costUsd: number | null;
}

/** Parses JSON log lines, keeping refine entries that carry token usage. */
export function parseLog(text: string, since = 0): UsageEntry[] {
  const out: UsageEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if ((e.msg !== "prompt refined" && e.msg !== "refine failed") || typeof e.outputTokens !== "number") continue;
    if (typeof e.time !== "number" || e.time < since) continue;
    // All-zero usage = the model never ran (e.g. Claude Code not logged in): nothing was used or charged.
    if (!e.outputTokens && !e.inputTokens && !e.cacheReadTokens && !e.cacheWriteTokens) continue;
    out.push({
      time: e.time,
      failed: e.msg === "refine failed",
      depth: e.depth === "deep" ? "deep" : "balanced",
      ...(typeof e.provider === "string" ? { provider: e.provider } : {}),
      model: String(e.model ?? "?"),
      ms: Number(e.ms) || 0,
      inputTokens: Number(e.inputTokens) || 0,
      outputTokens: Number(e.outputTokens) || 0,
      cacheReadTokens: Number(e.cacheReadTokens) || 0,
      cacheWriteTokens: Number(e.cacheWriteTokens) || 0,
      cacheWrite1hTokens: Number(e.cacheWrite1hTokens) || 0,
      costUsd: typeof e.costUsd === "number" ? e.costUsd : null,
    });
  }
  return out;
}

const MIN_RELIABLE = 10;
const DASH = "—";

const num = (n: number, digits: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatUsd(n: number | null): string {
  if (n == null) return DASH;
  if (n > 0 && n < 0.0005) return "< US$ 0,001";
  return `US$ ${num(n, n >= 1 ? 2 : 3)}`;
}

const formatSeconds = (ms: number) => `${num(ms / 1000, 1)} s`;
const formatInt = (n: number) => Math.round(n).toLocaleString("pt-BR");
const formatDate = (t: number) =>
  new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
const costs = (list: UsageEntry[]) => list.map((e) => e.costUsd).filter((c): c is number => c != null);

/** Fixed-width table: first column left-aligned, the others right-aligned. */
function table(header: string[], rows: string[][], totalRow?: string[]): string[] {
  const all = [header, ...rows, ...(totalRow ? [totalRow] : [])];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r: string[]) => `  ${r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("   ")}`;
  const out = [line(header), ...rows.map(line)];
  if (totalRow) out.push(`  ${"─".repeat(widths.reduce((a, b) => a + b, 0) + 3 * (widths.length - 1))}`, line(totalRow));
  return out;
}

function summaryRow(label: string, list: UsageEntry[]): string[] {
  const c = costs(list);
  return [
    label,
    String(list.length),
    list.length ? formatUsd(avg(c)) : DASH,
    list.length ? formatUsd(c.length ? sum(c) : null) : DASH,
    list.length ? formatSeconds(avg(list.map((e) => e.ms))!) : DASH,
  ];
}

export interface ReportOptions {
  days?: number;
  details?: boolean;
}

const SUBSCRIPTION = "claude-cli";

/** What a call would have cost on the API (same tokens), to show how heavy subscription runs are. */
const apiEquivalent = (e: UsageEntry) => estimateCostUsd(e.model, e);

/** Subscription runs (claude-cli): no API cost, so show tokens, time and the API-equivalent value instead. */
function subscriptionSection(list: UsageEntry[]): string[] {
  const ok = list.filter((e) => !e.failed);
  const row = (label: string, l: UsageEntry[]) => {
    const eq = l.map(apiEquivalent).filter((c): c is number => c != null);
    return [
      label,
      String(l.length),
      l.length ? formatInt(avg(l.map((e) => e.outputTokens))!) : DASH,
      l.length ? formatInt(avg(l.map((e) => e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens))!) : DASH,
      l.length ? formatSeconds(avg(l.map((e) => e.ms))!) : DASH,
      eq.length ? formatUsd(avg(eq)) : DASH,
    ];
  };
  const failed = list.filter((e) => e.failed);
  const rows = [
    row(
      "Equilibrado",
      ok.filter((e) => e.depth === "balanced"),
    ),
    row(
      "Profundo",
      ok.filter((e) => e.depth === "deep"),
    ),
  ];
  if (failed.length) rows.push(row("Falhas", failed));
  return [
    "Pela assinatura do Claude — sem custo de API (conta só no limite de uso do plano)",
    "",
    ...table(
      ["", "Refinamentos", "Tokens gerados", "Tokens de entrada", "Tempo médio", "Valor se fosse na API"],
      rows,
      row("Total", list),
    ),
    "",
    "  Tokens gerados = prompt refinado + raciocínio (a parte que mais pesa). Tokens de entrada = instruções do motor + seu texto.",
    "  Valor se fosse na API = só referência de quanto o uso pesa; você não paga isso.",
  ];
}

export function renderReport(entries: UsageEntry[], opts: ReportOptions = {}): string {
  const period = opts.days ? ` · últimos ${opts.days} dia(s)` : "";
  if (entries.length === 0) {
    return `Prompt Refiner — custo de uso${period}\n\nAinda não há refinamentos com custo registrado. Use o Prompt Refiner e rode este comando de novo.`;
  }

  const subscription = entries.filter((e) => e.provider === SUBSCRIPTION);
  const all = entries;
  entries = entries.filter((e) => e.provider !== SUBSCRIPTION);
  const okAll = all.filter((e) => !e.failed);
  const times = all.map((e) => e.time);
  const models = [...new Set(all.map((e) => e.model))].join(", ");
  const count = `${okAll.length} refinamento${okAll.length === 1 ? "" : "s"}`;
  const lines = [
    "Prompt Refiner — custo de uso",
    `${formatDate(Math.min(...times))} → ${formatDate(Math.max(...times))} · ${count} · ${models}${period}`,
    "",
  ];
  if (subscription.length) lines.push(...subscriptionSection(subscription), "");
  if (entries.length === 0) return lines.join("\n").trimEnd();
  if (subscription.length) lines.push("Pela API (pago, antes da troca)", "");

  const ok = entries.filter((e) => !e.failed);
  const failed = entries.filter((e) => e.failed);
  const balanced = ok.filter((e) => e.depth === "balanced");
  const deep = ok.filter((e) => e.depth === "deep");

  const rows = [summaryRow("Equilibrado", balanced), summaryRow("Profundo", deep)];
  if (failed.length) rows.push(summaryRow("Falhas (também cobradas)", failed));
  const totalRow = summaryRow("Total", entries);
  totalRow[1] = String(ok.length) + (failed.length ? ` + ${failed.length}` : "");
  lines.push(...table(["", "Refinamentos", "Custo médio", "Custo total", "Tempo médio"], rows, totalRow), "");

  // Projection per mode: the two modes cost very differently, so never mix them.
  const projections = (
    [
      ["Equilibrado", balanced],
      ["Profundo", deep],
    ] as const
  ).filter(([, list]) => costs(list).length > 0);
  if (projections.length) {
    lines.push("  A cada 100 refinamentos, no ritmo atual:");
    const width = Math.max(...projections.map(([label]) => label.length));
    for (const [label, list] of projections) {
      const warning = list.length < MIN_RELIABLE ? `   ⚠ poucos dados (${list.length} de ~${MIN_RELIABLE})` : "";
      lines.push(`    ${label.padEnd(width)}  ≈ US$ ${num(avg(costs(list))! * 100, 2)}${warning}`);
    }
  }

  if (opts.details) {
    const tokenRow = (label: string, pick: (e: UsageEntry) => number) => [
      label,
      ...[balanced, deep].map((l) => (l.length ? formatInt(avg(l.map(pick))!) : DASH)),
    ];
    lines.push(
      "",
      ...table(
        ["Tokens por refinamento (média)", "Equilibrado", "Profundo"],
        [
          tokenRow("Instruções lidas do cache (mais baratas)", (e) => e.cacheReadTokens),
          tokenRow("Instruções gravadas no cache", (e) => e.cacheWriteTokens),
          tokenRow("Texto novo (sem cache)", (e) => e.inputTokens),
          tokenRow("Gerados (resposta + raciocínio)", (e) => e.outputTokens),
        ],
      ),
      "",
      "  Cache: o primeiro uso após uma pausa grava as instruções (mais caro); os seguintes as leem (mais barato). As instruções principais ficam guardadas por 1 h; as do modo profundo, por 5 min.",
    );
  } else {
    lines.push("", "  Tokens e cache: npm run usage -w backend -- --detalhes");
  }
  lines.push("  Estimativa pela tabela de preços (backend/src/config/pricing.ts); o valor cobrado está no Console da Anthropic.");
  return lines.join("\n");
}
