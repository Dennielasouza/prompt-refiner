import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUsd, parseLog, renderReport, type UsageEntry } from "../src/usage/report.js";

const entry = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  time: Date.UTC(2026, 9, 7, 13, 34),
  failed: false,
  depth: "balanced",
  model: "claude-sonnet-5-5",
  ms: 2600,
  inputTokens: 300,
  outputTokens: 150,
  cacheReadTokens: 3800,
  cacheWriteTokens: 0,
  costUsd: 0.003,
  ...over,
});

describe("usage report", () => {
  it("parses only refine entries with token usage", () => {
    const log = [
      JSON.stringify({
        msg: "prompt refined",
        time: 1,
        depth: "deep",
        model: "m",
        ms: 10,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        costUsd: 0.01,
      }),
      JSON.stringify({ msg: "prompt refined", time: 2 }), // old entry, no tokens
      JSON.stringify({ msg: "request completed", time: 3 }),
      "not json",
      JSON.stringify({
        msg: "refine failed",
        time: 4,
        model: "m",
        ms: 5,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
      }),
    ].join("\n");
    const rows = parseLog(log);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].depth, "deep");
    assert.equal(rows[1].failed, true);
    assert.equal(parseLog(log, 3).length, 1, "since filter");
  });

  it("formats money the Brazilian way", () => {
    assert.equal(formatUsd(0.00304), "US$ 0,003");
    assert.equal(formatUsd(1.234), "US$ 1,23");
    assert.equal(formatUsd(0.0001), "< US$ 0,001");
    assert.equal(formatUsd(null), "—");
  });

  it("shows one row per mode, total at the bottom, no index column or quotes", () => {
    const out = renderReport([entry(), entry({ depth: "deep", costUsd: 0.008 })]);
    const lines = out.split("\n");
    assert.ok(!out.includes("(index)") && !out.includes("'"));
    const iB = lines.findIndex((l) => l.trim().startsWith("Equilibrado"));
    const iD = lines.findIndex((l) => l.trim().startsWith("Profundo"));
    const iT = lines.findIndex((l) => l.trim().startsWith("Total"));
    assert.ok(iB < iD && iD < iT);
    assert.match(lines[iT], /2\s+US\$ 0,006\s+US\$ 0,011\s+2,6 s/);
    assert.match(out, /A cada 100 refinamentos, no ritmo atual:/);
    assert.match(out, /Equilibrado\s+≈ US\$ 0,30\s+⚠ poucos dados \(1 de ~10\)/);
    assert.match(out, /Profundo\s+≈ US\$ 0,80\s+⚠ poucos dados \(1 de ~10\)/);
    assert.ok(!out.includes("Tokens por refinamento"), "details hidden by default");
  });

  it("lists failures separately and drops the low-data warning with enough data", () => {
    const out = renderReport([...Array.from({ length: 10 }, () => entry()), entry({ failed: true, costUsd: 0.002 })]);
    assert.match(out, /Falhas \(também cobradas\)\s+1/);
    assert.match(out, /Total\s+10 \+ 1/);
    assert.ok(!out.includes("poucos dados"));
    assert.match(out, /Equilibrado\s+≈ US\$ 0,30$/m);
    assert.ok(!/Profundo\s+≈/.test(out), "no projection for a mode without data");
  });

  it("shows token details on demand with plain-language labels", () => {
    const out = renderReport([entry()], { details: true, days: 7 });
    assert.match(out, /últimos 7 dia\(s\)/);
    assert.match(out, /Instruções lidas do cache \(mais baratas\)\s+3\.800\s+—/);
    assert.match(out, /Gerados \(resposta \+ raciocínio\)\s+150/);
  });

  it("labels subscription (claude-cli) refinements as free of API cost", () => {
    const parsed = parseLog(
      JSON.stringify({ msg: "prompt refined", time: 1, provider: "claude-cli", model: "m", outputTokens: 2, costUsd: null }),
    );
    assert.equal(parsed[0].provider, "claude-cli");
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    assert.deepEqual(parseLog(JSON.stringify({ msg: "refine failed", time: 1, provider: "claude-cli", ...zero })), []);
    const out = renderReport([entry({ provider: "claude-cli", model: "claude-sonnet-5-5", costUsd: null })]);
    assert.match(out, /Pela assinatura do Claude — sem custo de API/);
    assert.match(out, /Valor se fosse na API/);
    assert.doesNotMatch(out, /Console da Anthropic/);
    assert.doesNotMatch(out, /Pela API \(pago/);
    assert.match(renderReport([entry()]), /Console da Anthropic/);
    const mixed = renderReport([entry({ provider: "claude-cli", costUsd: null }), entry()]);
    assert.ok(mixed.indexOf("Pela assinatura") < mixed.indexOf("Pela API (pago"), "subscription first, then API");
    assert.match(mixed, /Pela API \(pago[\s\S]*Total\s+1\s/);
  });

  it("explains when there is no data", () => {
    assert.match(renderReport([]), /Ainda não há refinamentos/);
  });
});
