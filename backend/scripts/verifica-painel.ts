// Confere a geração das planilhas do painel a partir de uma rodada já gravada, sem gastar rodada nova:
//   npx tsx scripts/verifica-painel.ts ../.local/dados/runs/<arquivo>.jsonl
import { readFileSync } from "node:fs";
import { type CaseAggregate, writePainelCsv } from "./evalRun.js";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("uso: npx tsx scripts/verifica-painel.ts <rodada.jsonl>");
  process.exit(1);
}
const cases = readFileSync(arquivo, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r): r is CaseAggregate => r.type === "case");

console.log(`casos lidos: ${cases.length}`);
for (const f of writePainelCsv(cases)) console.log(`escrito: ${f}`);
