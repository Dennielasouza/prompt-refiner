import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type CompileRequest, type CompilerProvider, ProviderError, type TokenUsage } from "./types.js";

/**
 * Runs the compiler call through Claude Code's headless print mode (`claude -p`), billed to the
 * person's Claude subscription (Pro/Max) instead of API credits. Same model and system prompt as the
 * Anthropic provider; the four system blocks are sent as one `--system-prompt`.
 *
 * Isolation (fast start, nothing from the person's Claude Code setup leaks into the call):
 * - a neutral, empty working directory (no CLAUDE.md, no project settings);
 * - no tools, no MCP servers, no settings files, no slash commands, no saved session;
 * - a minimal environment: ANTHROPIC_API_KEY and friends from the backend's .env are NOT passed,
 *   otherwise the CLI would bill the (empty) API account instead of the subscription.
 * The prompt text goes through stdin, never argv (argv is visible to every process via `ps`).
 */
export interface ClaudeCliSettings {
  /** Absolute path of the `claude` binary. */
  bin: string;
  model: string;
  effort?: "low" | "medium" | "high";
  /** Working directory for the CLI (created if missing). Must not be the repo (its CLAUDE.md would load). */
  cwd: string;
}

/** Default location of the native Claude Code install (`claude install`). */
export const DEFAULT_CLAUDE_BIN = join(homedir(), ".local", "bin", "claude");
/** Neutral, empty working directory, next to the installed backend (outside TCC-protected folders). */
export const DEFAULT_CLAUDE_CWD = join(homedir(), "Library", "Application Support", "PromptRefiner", "claude-cli");

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

/** Environment for the child: only what the CLI needs to find its login (Keychain, ~/.claude). */
export function childEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    // node's own folder first: lets a `#!/usr/bin/env node` CLI install work too.
    PATH: [dirname(process.execPath), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    // No auto-updater, telemetry or error reporting: faster start and nothing extra leaves the Mac.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_AUTOUPDATER: "1",
    // Never load any CLAUDE.md (user-level ~/.claude/CLAUDE.md included): only our system prompt counts.
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  };
  // CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) is a plan B for when the Keychain login is not
  // reachable; it authenticates with the same subscription. API keys are deliberately NOT forwarded.
  for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "CLAUDE_CODE_OAUTH_TOKEN"]) {
    if (parent[key]) env[key] = parent[key];
  }
  return env;
}

export function buildCliArgs(settings: ClaudeCliSettings, req: CompileRequest): string[] {
  const system = [req.coreInstruction, req.depthInstruction, req.formatInstruction, req.destinationInstruction]
    .filter((part) => part?.trim())
    .join("\n\n");
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    settings.model,
    ...(settings.effort ? ["--effort", settings.effort] : []),
    "--system-prompt",
    system,
    "--json-schema",
    JSON.stringify(req.schema),
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    // No CLAUDE.md, skills, plugins, hooks or MCP servers; auth and the model work normally.
    "--safe-mode",
  ];
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
  structured_output?: unknown;
  stop_reason?: string | null;
  api_error_status?: number | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: { ephemeral_1h_input_tokens?: number };
  };
}

// Known CLI messages: "Not logged in · Please run /login", "Login expired · Please run /login",
// "Failed to authenticate: OAuth session expired…", "API Error: 401 Invalid authentication credentials".
const AUTH_RE =
  /authenticat|oauth|log ?in\b|\/login|logged out|credential|unauthori[sz]ed|invalid api key|token (has )?expired|\b40[13]\b/i;
// "You've hit your session limit · resets 3:45pm", "…weekly limit…", "Claude AI usage limit reached", "Request rejected (429)".
const LIMIT_RE =
  /usage limit|hit your (\w+ )?limit|limit reached|rate.?limit|too many requests|out of (extra )?usage|quota|\b429\b/i;

/** Maps a CLI error result to a ProviderError kind. The CLI's text is used only to classify, never logged. */
export function classifyCliError(r: CliResult): ProviderError {
  const text = typeof r.result === "string" ? r.result : "";
  const status = typeof r.api_error_status === "number" ? r.api_error_status : null;
  if (r.stop_reason === "refusal") return new ProviderError("refusal", "compiler model declined the request");
  if (status === 401 || status === 403 || AUTH_RE.test(text)) {
    return new ProviderError("auth", "Claude Code is not logged in (run `claude`, then /login)");
  }
  if (status === 429 || LIMIT_RE.test(text)) return new ProviderError("rate_limited", "Claude subscription usage limit");
  if (r.subtype === "error_max_structured_output_retries") {
    return new ProviderError("invalid_output", "compiler output did not match the schema");
  }
  if (r.subtype === "error_max_turns") return new ProviderError("invalid_output", "compiler did not finish in time");
  return new ProviderError("upstream", `Claude Code error ${status ?? r.subtype ?? "unknown"}`);
}

function toUsage(u: CliResult["usage"]): TokenUsage | null {
  if (!u || typeof u.output_tokens !== "number") return null;
  // All zeros = the model never ran (e.g. not logged in): nothing to report.
  if (!u.output_tokens && !u.input_tokens && !u.cache_read_input_tokens && !u.cache_creation_input_tokens) return null;
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    cacheWrite1hTokens: u.cache_creation?.ephemeral_1h_input_tokens ?? 0,
  };
}

/** Runs the CLI once; resolves with exit code and stdout (stderr is discarded: it is never logged). */
function runCli(
  settings: ClaudeCliSettings,
  args: string[],
  stdin: string,
  signal: AbortSignal,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ProviderError("timeout", "compiler request timed out"));
    try {
      mkdirSync(settings.cwd, { recursive: true, mode: 0o700 });
    } catch {
      return reject(new ProviderError("upstream", "cannot create the Claude Code working directory"));
    }
    const child = spawn(settings.bin, args, { cwd: settings.cwd, env: childEnv(), stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };
    const kill = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2000).unref();
    };
    const onAbort = () => {
      kill();
      finish(() => reject(new ProviderError("timeout", "compiler request timed out")));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new ProviderError(
            "upstream",
            err.code === "ENOENT" ? "Claude Code CLI not found" : `cannot start Claude Code (${err.code ?? "error"})`,
          ),
        ),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_STDOUT_BYTES) {
        kill();
        finish(() => reject(new ProviderError("invalid_output", "Claude Code output too large")));
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => finish(() => resolve({ code, stdout: Buffer.concat(chunks).toString("utf8") })));
    // The CLI may exit before reading stdin (e.g. bad flags); ignore EPIPE.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

/** Last JSON object printed on stdout (`--output-format json` prints a single result object). */
function parseResult(stdout: string): CliResult | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && v.type === "result") return v as CliResult;
    } catch {
      /* try the previous line */
    }
  }
  return null;
}

export function createClaudeCliProvider(settings: ClaudeCliSettings): CompilerProvider {
  return {
    name: "claude-cli",
    async compile(req: CompileRequest) {
      const { code, stdout } = await runCli(settings, buildCliArgs(settings, req), req.userMessage, req.signal);
      const r = parseResult(stdout);
      if (!r) throw new ProviderError("upstream", `Claude Code exited with code ${code ?? "signal"} and no result`);

      const usage = toUsage(r.usage);
      if (usage) req.onUsage?.(usage);
      if (r.is_error || r.subtype !== "success") throw classifyCliError(r);
      if (r.stop_reason === "refusal") throw new ProviderError("refusal", "compiler model declined the request");
      if (r.stop_reason === "max_tokens") throw new ProviderError("invalid_output", "compiler output was truncated");

      if (r.structured_output && typeof r.structured_output === "object") return r.structured_output;
      // Fallback: some versions only put the JSON in `result`.
      if (typeof r.result === "string") {
        try {
          return JSON.parse(r.result);
        } catch {
          /* fall through */
        }
      }
      throw new ProviderError("invalid_output", "compiler output is not valid JSON");
    },
  };
}
