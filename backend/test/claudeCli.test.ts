import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/env.js";
import { callCostUsd } from "../src/config/pricing.js";
import { childEnv, classifyCliError, createClaudeCliProvider } from "../src/providers/claudeCli.js";
import { createProvider } from "../src/providers/index.js";
import { type CompileRequest, ProviderError, type TokenUsage } from "../src/providers/types.js";

const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const workDir = mkdtempSync(join(tmpdir(), "pr-claude-cli-"));
const cwd = join(workDir, "neutral");
after(() => rmSync(workDir, { recursive: true, force: true }));

const req = (userMessage = "USER", signal = new AbortController().signal): CompileRequest => ({
  coreInstruction: "CORE",
  depthInstruction: "DEPTH",
  formatInstruction: "FORMAT",
  destinationInstruction: "DEST",
  userMessage,
  schema: { type: "object" },
  signal,
});

const provider = (bin = FAKE_CLI) => createClaudeCliProvider({ bin, cwd, model: "claude-sonnet-5-5", effort: "medium" });

describe("claude-cli provider", () => {
  it("runs the CLI headless, isolated, with the prompt on stdin, and returns the structured output", async () => {
    const usages: TokenUsage[] = [];
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    let out: Record<string, unknown>;
    try {
      out = (await provider().compile({ ...req("texto secreto"), onUsage: (u) => usages.push(u) })) as Record<string, unknown>;
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    assert.equal(out.refinedPrompt, "P");
    const args = out._args as string[];
    const flag = (name: string) => args[args.indexOf(name) + 1];
    assert.equal(args[0], "-p");
    assert.equal(flag("--output-format"), "json");
    assert.equal(flag("--model"), "claude-sonnet-5-5");
    assert.equal(flag("--effort"), "medium");
    assert.equal(flag("--system-prompt"), "CORE\n\nDEPTH\n\nFORMAT\n\nDEST", "system blocks in cache order");
    assert.deepEqual(JSON.parse(flag("--json-schema")), { type: "object" });
    assert.equal(flag("--tools"), "", "no tools");
    assert.equal(flag("--setting-sources"), "", "no settings files");
    for (const f of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--safe-mode"]) {
      assert.ok(args.includes(f), f);
    }
    assert.ok(!args.some((a) => a.includes("texto secreto")), "prompt text never goes to argv (visible in ps)");
    assert.equal(out._stdin, "texto secreto");
    assert.equal(realpathSync(out._cwd as string), realpathSync(cwd), "runs in the neutral folder, not the repo");
    const envKeys = out._envKeys as string[];
    assert.ok(!envKeys.some((k) => k.startsWith("ANTHROPIC_")), "API key/base URL are not passed to the CLI");
    assert.deepEqual(
      envKeys.filter((k) => k.startsWith("CLAUDE")),
      ["CLAUDE_CODE_DISABLE_CLAUDE_MDS", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
      "no host session variables (e.g. from a parent Claude Code) reach the CLI",
    );
    assert.deepEqual(usages, [
      { inputTokens: 10, outputTokens: 20, cacheReadTokens: 3000, cacheWriteTokens: 0, cacheWrite1hTokens: 0 },
    ]);
  });

  it("omits --effort when not configured", async () => {
    const p = createClaudeCliProvider({ bin: FAKE_CLI, cwd, model: "m" });
    const out = (await p.compile(req())) as { _args: string[] };
    assert.ok(!out._args.includes("--effort"));
  });

  it("falls back to JSON in `result` when there is no structured_output", async () => {
    const out = (await provider().compile(req("SCENARIO:result-only"))) as { refinedPrompt: string };
    assert.equal(out.refinedPrompt, "P");
  });

  it("maps CLI failures to provider error kinds", async () => {
    const cases: Array<[string, string]> = [
      ["auth", "auth"],
      ["limit", "rate_limited"],
      ["429", "rate_limited"],
      ["overloaded", "upstream"],
      ["schema", "invalid_output"],
      ["refusal", "refusal"],
      ["garbage", "upstream"],
      ["bad-json", "invalid_output"],
    ];
    for (const [scenario, kind] of cases) {
      await assert.rejects(
        provider().compile(req(`SCENARIO:${scenario}`)),
        (e: unknown) => e instanceof ProviderError && e.kind === kind,
        `${scenario} → ${kind}`,
      );
    }
  });

  it("does not report usage when the model never ran (e.g. not logged in)", async () => {
    const usages: TokenUsage[] = [];
    await assert.rejects(provider().compile({ ...req("SCENARIO:auth"), onUsage: (u) => usages.push(u) }));
    assert.deepEqual(usages, []);
  });

  it("reports a missing binary as upstream", async () => {
    await assert.rejects(
      provider(join(workDir, "nope", "claude")).compile(req()),
      (e: unknown) => e instanceof ProviderError && e.kind === "upstream" && /not found/.test(e.message),
    );
  });

  it("kills the CLI and reports a timeout when the request is aborted", async () => {
    const ctrl = new AbortController();
    const started = Date.now();
    setTimeout(() => ctrl.abort(), 300);
    await assert.rejects(
      provider().compile(req("SCENARIO:hang", ctrl.signal)),
      (e: unknown) => e instanceof ProviderError && e.kind === "timeout",
    );
    assert.ok(Date.now() - started < 5000);
  });

  it("classifies auth before limits and uses the HTTP status when present", () => {
    assert.equal(classifyCliError({ is_error: true, api_error_status: 401, result: "x" }).kind, "auth");
    assert.equal(classifyCliError({ is_error: true, result: "Not logged in · Please run /login" }).kind, "auth");
    assert.equal(classifyCliError({ is_error: true, result: "Login expired · Please run /login" }).kind, "auth");
    assert.equal(classifyCliError({ is_error: true, result: "API Error: 401 Invalid authentication credentials" }).kind, "auth");
    assert.equal(classifyCliError({ is_error: true, result: "You've hit your limit · resets 3pm" }).kind, "rate_limited");
    assert.equal(
      classifyCliError({ is_error: true, result: "You've hit your session limit · resets 3:45pm" }).kind,
      "rate_limited",
    );
    assert.equal(classifyCliError({ is_error: true, result: "You've hit your weekly limit · resets Mon" }).kind, "rate_limited");
    assert.equal(classifyCliError({ is_error: true, result: "API Error: Request rejected (429)" }).kind, "rate_limited");
    assert.equal(classifyCliError({ is_error: true, result: "API Error: Repeated 529 Overloaded errors" }).kind, "upstream");
    assert.equal(classifyCliError({ is_error: true, subtype: "error_during_execution" }).kind, "upstream");
  });

  it("passes only a minimal environment", () => {
    const env = childEnv({
      HOME: "/h",
      USER: "u",
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_AUTH_TOKEN: "t",
      ANTHROPIC_BASE_URL: "http://proxy",
      OPENAI_API_KEY: "o",
      CLAUDE_CODE_OAUTH_TOKEN: "sub",
      PORT: "1",
    });
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sub", "subscription token (plan B) is forwarded");
    assert.equal(env.HOME, "/h");
    assert.equal(env.USER, "u");
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.PORT, undefined);
    assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1");
  });
});

describe("claude-cli config", () => {
  it("needs no API key, only the model and an executable claude binary", () => {
    const c = loadConfig({
      PROMPT_COMPILER_PROVIDER: "claude-cli",
      PROMPT_COMPILER_MODEL: "claude-sonnet-5-5",
      PROMPT_COMPILER_CLAUDE_BIN: FAKE_CLI,
    });
    assert.equal(c.provider, "claude-cli");
    assert.equal(c.configError, undefined);
    assert.equal(c.claudeBin, FAKE_CLI);
    assert.equal(createProvider(c)?.name, "claude-cli");
  });

  it("reports a missing or relative binary in Portuguese", () => {
    const base = { PROMPT_COMPILER_PROVIDER: "claude-cli", PROMPT_COMPILER_MODEL: "m" };
    assert.match(
      loadConfig({ ...base, PROMPT_COMPILER_CLAUDE_BIN: join(workDir, "nope") }).configError!,
      /Claude Code não foi encontrado/,
    );
    assert.match(loadConfig({ ...base, PROMPT_COMPILER_CLAUDE_BIN: "claude" }).configError!, /caminho absoluto/);
    assert.equal(createProvider(loadConfig({ ...base, PROMPT_COMPILER_CLAUDE_BIN: "claude" })), null);
  });

  it("never prices subscription calls as API calls", () => {
    const usage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    assert.equal(callCostUsd("claude-cli", "claude-sonnet-5-5", usage), null);
    assert.ok((callCostUsd("anthropic", "claude-sonnet-5-5", usage) ?? 0) > 0);
  });
});
