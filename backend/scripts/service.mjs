#!/usr/bin/env node
// Instala/remove o backend do Prompt Refiner como LaunchAgent do macOS
// (inicia no login e é reiniciado automaticamente se cair).
//
// Uso (a partir da raiz do monorepo):
//   npm run install-service -w backend     # compila e instala
//   npm run uninstall-service -w backend   # para e remove
//
// O serviço NÃO roda de dentro do projeto: pastas como ~/Desktop e ~/Documents são
// protegidas pelo macOS (TCC) e travam processos iniciados pelo launchd. Por isso o
// instalador gera um bundle autossuficiente e copia o backend/.env (permissão 600, só
// o seu usuário lê) para ~/Library/Application Support/PromptRefiner/backend.
// Nada do .env vai para o plist. Depois de editar backend/.env, rode install-service de novo.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.promptrefiner.backend";
const BACKEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the service actually runs (outside TCC-protected folders). */
const RUNTIME_DIR = join(homedir(), "Library", "Application Support", "PromptRefiner", "backend");
const ENTRY = join(RUNTIME_DIR, "index.cjs");
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const LOG_DIR = join(homedir(), "Library", "Logs", "PromptRefiner");
const LOG_FILE = join(LOG_DIR, "backend.log");
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const UID = userInfo().uid;
const DOMAIN = `gui/${UID}`;
const SERVICE = `${DOMAIN}/${LABEL}`;

/**
 * Chrome derives an unpacked extension's id from the absolute path of its folder
 * (sha256 → first 32 hex chars mapped 0-f → a-p). Lets the service accept ONLY our extension.
 */
function unpackedExtensionId(dir) {
  const hex = createHash("sha256").update(dir).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
}
const EXTENSION_ORIGIN = `chrome-extension://${unpackedExtensionId(resolve(BACKEND_DIR, "..", "extension", "dist"))}`;

/** True if backend/.env sets ALLOWED_ORIGINS itself (only the key is checked, values are never read out). */
function envDefinesAllowedOrigins() {
  const envPath = join(BACKEND_DIR, ".env");
  return existsSync(envPath) && /^\s*(?:export\s+)?ALLOWED_ORIGINS\s*=/m.test(readFileSync(envPath, "utf8"));
}

/** Self-contained bundle (dependencies inlined) + a private copy of .env in RUNTIME_DIR. */
function deployRuntime() {
  mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o700 });
  chmodSync(RUNTIME_DIR, 0o700);
  const esbuild = join(BACKEND_DIR, "..", "node_modules", ".bin", "esbuild");
  execFileSync(
    esbuild,
    [
      join(BACKEND_DIR, "src", "index.ts"),
      "--bundle",
      "--platform=node",
      "--format=cjs",
      "--target=node20",
      "--log-level=warning",
      `--outfile=${ENTRY}`,
    ],
    { stdio: "inherit" },
  );
  const envSrc = join(BACKEND_DIR, ".env");
  const envDst = join(RUNTIME_DIR, ".env");
  rmSync(envDst, { force: true });
  if (existsSync(envSrc)) {
    copyFileSync(envSrc, envDst);
    chmodSync(envDst, 0o600);
  }
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Lê apenas PORT/HOST do backend/.env (nunca imprime nem copia o resto). */
function readListenConfig() {
  let port = 8787;
  let host = "127.0.0.1";
  const envPath = join(BACKEND_DIR, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?(PORT|HOST)\s*=\s*["']?([^"'#\s]*)/);
      if (!m) continue;
      if (m[1] === "PORT") {
        const n = Number.parseInt(m[2], 10);
        if (Number.isFinite(n) && n > 0) port = n;
      } else if (m[2]) {
        host = m[2];
      }
    }
  }
  return { port, host, hasEnv: existsSync(envPath) };
}

/** Provider named in backend/.env (only that key is read; nothing is printed). */
function envProvider() {
  const envPath = join(BACKEND_DIR, ".env");
  if (!existsSync(envPath)) return "";
  const m = readFileSync(envPath, "utf8").match(/^\s*(?:export\s+)?PROMPT_COMPILER_PROVIDER\s*=\s*["']?([A-Za-z-]*)/m);
  return m ? m[1].toLowerCase() : "";
}

/** Path of the claude binary the backend will use (PROMPT_COMPILER_CLAUDE_BIN or the default install). */
function envClaudeBin() {
  const envPath = join(BACKEND_DIR, ".env");
  const m = existsSync(envPath)
    ? readFileSync(envPath, "utf8").match(/^\s*(?:export\s+)?PROMPT_COMPILER_CLAUDE_BIN\s*=\s*["']?([^"'#\n]*)/m)
    : null;
  return m?.[1].trim() || join(homedir(), ".local", "bin", "claude");
}

/**
 * claude-cli provider: checks (without spending anything) whether Claude Code is logged in with the
 * subscription, in the same clean environment the backend uses. Prints only the login state.
 */
function checkClaudeLogin() {
  const bin = envClaudeBin();
  if (!existsSync(bin)) {
    console.log(
      `\nClaude Code não encontrado em ${bin}. Instale o Claude Code ou defina PROMPT_COMPILER_CLAUDE_BIN no backend/.env.`,
    );
    return;
  }
  const r = spawnSync(bin, ["auth", "status"], {
    encoding: "utf8",
    cwd: homedir(),
    env: { HOME: homedir(), USER: userInfo().username, PATH: "/usr/bin:/bin", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    timeout: 15000,
  });
  let status = null;
  try {
    status = JSON.parse(r.stdout);
  } catch {
    /* formato inesperado */
  }
  if (status?.loggedIn && status.authMethod !== "api_key" && status.authMethod !== "api_key_helper") {
    console.log(`\nClaude Code: conectado à sua assinatura (${status.authMethod}). Os refinamentos não usam créditos de API.`);
    return;
  }
  console.log("\n⚠ O Claude Code NÃO está conectado à sua assinatura do Claude. Os refinamentos vão falhar até você entrar:");
  console.log("   1. Abra o app Terminal.");
  console.log("   2. Digite  claude  e aperte Enter.");
  console.log("   3. Digite  /login  , escolha a conta com assinatura do Claude (Pro/Max) e conclua no navegador.");
  console.log("   4. Saia com  /exit  e rode de novo: npm run install-service -w backend");
}

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: "utf8" });
}

/** PID do processo do nosso LaunchAgent, se estiver carregado e rodando. */
function agentPid() {
  const r = run("launchctl", ["print", SERVICE]);
  if (r.status !== 0) return null;
  const m = r.stdout.match(/^\s*pid = (\d+)/m);
  return m ? Number(m[1]) : null;
}

/** Processos escutando na porta TCP (pid + comando). */
function listenersOn(port) {
  const r = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  if (r.status !== 0 || !r.stdout) return [];
  const out = [];
  let cur = null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("p")) {
      cur = { pid: Number(line.slice(1)), command: "" };
      out.push(cur);
    } else if (line.startsWith("c") && cur) {
      cur.command = line.slice(1);
    }
  }
  return out;
}

function describePid(pid) {
  const r = run("ps", ["-o", "command=", "-p", String(pid)]);
  return (r.stdout || "").trim();
}

function bootout() {
  // Ignora erros: o serviço pode simplesmente não estar carregado.
  run("launchctl", ["bootout", SERVICE]);
  // Aguarda o launchd terminar de descarregar (evita erro 5/37 no bootstrap).
  for (let i = 0; i < 20; i++) {
    if (run("launchctl", ["print", SERVICE]).status !== 0) return;
    execFileSync("sleep", ["0.25"]);
  }
}

function rotateLog() {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_BYTES) renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    /* rotação é best-effort */
  }
}

// ProcessType Standard, not Background: the backend answers a person who is waiting. Background QoS
// throttled the claude-cli provider's child process (Claude Code start-up went from ~0.3 s to ~4–5 s).
function buildPlist() {
  const nodeBin = process.execPath;
  const path = [dirname(nodeBin), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    .filter((p, i, a) => a.indexOf(p) === i)
    .join(":");
  const s = xmlEscape;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${s(LABEL)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${s(nodeBin)}</string>
		<string>${s(ENTRY)}</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${s(RUNTIME_DIR)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ThrottleInterval</key>
	<integer>10</integer>
	<key>ProcessType</key>
	<string>Standard</string>
	<key>StandardOutPath</key>
	<string>${s(LOG_FILE)}</string>
	<key>StandardErrorPath</key>
	<string>${s(LOG_FILE)}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${s(path)}</string>
		<key>NODE_ENV</key>
		<string>production</string>${
      envDefinesAllowedOrigins()
        ? ""
        : `
		<key>ALLOWED_ORIGINS</key>
		<string>${s(EXTENSION_ORIGIN)}</string>`
    }
	</dict>
</dict>
</plist>
`;
}

async function waitForHealth(host, port, timeoutMs = 15000) {
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { url, body: await res.json() };
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { url, body: null };
}

async function install() {
  if (process.platform !== "darwin") {
    console.error("Este instalador só funciona no macOS (usa launchd).");
    process.exit(1);
  }
  const { port, host, hasEnv } = readListenConfig();
  if (!hasEnv) {
    console.warn(`Aviso: ${join(BACKEND_DIR, ".env")} não existe. O backend vai subir, mas sem chave de API.`);
    console.warn("       Copie backend/.env.example para backend/.env e preencha a chave.\n");
  }

  // Conflito de porta: algo que NÃO é o nosso LaunchAgent já está escutando.
  const ours = agentPid();
  const conflicts = listenersOn(port).filter((l) => l.pid !== ours);
  if (conflicts.length > 0) {
    console.warn(`A porta ${port} já está em uso por outro processo (não é o serviço ${LABEL}):`);
    for (const c of conflicts) console.warn(`     PID ${c.pid}: ${describePid(c.pid) || c.command}`);
    console.warn("   Provavelmente é um `npm run dev` antigo aberto em algum terminal.");
    console.warn("   O serviço será instalado mesmo assim, mas só consegue subir quando a porta ficar livre");
    console.warn("   (o launchd tenta de novo automaticamente a cada poucos segundos).");
    console.warn(`   Para liberar: feche esse terminal ou rode  kill ${conflicts.map((c) => c.pid).join(" ")}\n`);
  }

  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  rotateLog();

  bootout();
  deployRuntime();
  writeFileSync(PLIST_PATH, buildPlist(), { mode: 0o644 });

  const lint = run("plutil", ["-lint", PLIST_PATH]);
  if (lint.status !== 0) {
    console.error(`plist inválido: ${lint.stdout || lint.stderr}`);
    process.exit(1);
  }

  const boot = run("launchctl", ["bootstrap", DOMAIN, PLIST_PATH]);
  if (boot.status !== 0) {
    console.error(`Falha ao carregar o serviço no launchd: ${(boot.stderr || boot.stdout).trim()}`);
    console.error(`Tente: launchctl bootout ${SERVICE} ; npm run install-service -w backend`);
    process.exit(1);
  }

  console.log(`Serviço ${LABEL} instalado.`);
  console.log(`   Node:     ${process.execPath}`);
  console.log(`   Programa: ${ENTRY}`);
  console.log(`   Pasta:    ${RUNTIME_DIR} (cópia privada do .env, permissão 600)`);
  console.log(`   plist:    ${PLIST_PATH}`);
  console.log(`   Log:      ${LOG_FILE}`);
  console.log(
    envDefinesAllowedOrigins()
      ? "   Origens:  definidas por ALLOWED_ORIGINS no backend/.env"
      : `   Origens:  só a extensão do Prompt Refiner (${EXTENSION_ORIGIN}); apps do Mac continuam liberados`,
  );
  console.log("   (Se mover o projeto ou carregar a extensão de outra pasta, rode install-service de novo.)");
  console.log("   Ele inicia sozinho no login e é reiniciado automaticamente se cair.\n");

  if (conflicts.length > 0) {
    console.log("Health check pulado: a porta está ocupada por outro processo (veja o aviso acima).");
  } else {
    const { url, body } = await waitForHealth(host, port);
    if (body) {
      console.log(`Health (${url}): ${JSON.stringify(body)}`);
      if (body.status !== "ok") console.log("O backend subiu, mas está mal configurado — confira o backend/.env.");
    } else {
      console.log(`O backend não respondeu em ${url}. Veja o log: tail -n 50 "${LOG_FILE}"`);
    }
  }

  if (envProvider() === "claude-cli") checkClaudeLogin();

  console.log("\nComandos úteis:");
  console.log(`   Saúde:     curl -s http://127.0.0.1:${port}/api/health`);
  console.log(`   Status:    launchctl print ${SERVICE} | grep -E 'state|pid'`);
  console.log(`   Log:       tail -f "${LOG_FILE}"`);
  console.log(`   Reiniciar: launchctl kickstart -k ${SERVICE}`);
  console.log("   Editou backend/.env ou o código? Rode de novo: npm run install-service -w backend");
  console.log("   Remover:   npm run uninstall-service -w backend");
}

function uninstall() {
  const wasLoaded = run("launchctl", ["print", SERVICE]).status === 0;
  bootout();
  const hadPlist = existsSync(PLIST_PATH);
  rmSync(PLIST_PATH, { force: true });
  rmSync(RUNTIME_DIR, { recursive: true, force: true }); // inclui a cópia do .env
  if (wasLoaded || hadPlist) {
    console.log(`Serviço ${LABEL} parado e removido (incluindo a cópia do .env).`);
    console.log(`   O log continua em ${LOG_FILE} (pode apagar se quiser).`);
    console.log("   A partir de agora o backend só roda se você iniciar à mão (npm run dev).");
  } else {
    console.log(`O serviço ${LABEL} não estava instalado. Nada a fazer.`);
  }
}

const cmd = process.argv[2];
if (cmd === "install") await install();
else if (cmd === "uninstall") uninstall();
else {
  console.error("Uso: node scripts/service.mjs <install|uninstall>");
  process.exit(1);
}
