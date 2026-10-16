// Usage report: npm run usage -w backend [-- --days 7] [-- --detalhes] [-- --log <path>]
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseLog, renderReport } from "../src/usage/report.js";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const logPath = opt("--log") ?? join(homedir(), "Library/Logs/PromptRefiner/backend.log");
const days = Number(opt("--days") ?? 0) || undefined;

if (!existsSync(logPath)) {
  console.error(
    `Log não encontrado: ${logPath}\nO registro de custo começa quando o backend roda como serviço (npm run install-service -w backend).`,
  );
  process.exit(1);
}

const since = days ? Date.now() - days * 86_400_000 : 0;
console.log(renderReport(parseLog(readFileSync(logPath, "utf8"), since), { days, details: args.includes("--detalhes") }));
