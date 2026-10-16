import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { describe, it } from "node:test";
import { MAX_INPUT_CHARS } from "../src/engine/types.js";
import { ProviderError } from "../src/providers/types.js";
import { buildServer } from "../src/server.js";
import { fakeProvider, testConfig, validOutput } from "./helpers.js";

const EXT = "chrome-extension://abcdefghijklmnop";

function post(app: ReturnType<typeof buildServer>, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/api/refine", payload: body as object, headers: { origin: EXT, ...headers } });
}

describe("POST /api/refine", () => {
  it("returns the refined prompt for a valid request", async () => {
    const { provider, calls } = fakeProvider(() => validOutput("Prompt final"));
    const app = buildServer(testConfig(), provider, false);
    const res = await post(app, { text: "texto original", target: "claude", language: "pt-BR" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "complexity",
      "depth",
      "format",
      "kind",
      "refinedPrompt",
      "strategies",
      "target",
      "taskType",
      "warnings",
    ]);
    assert.equal(body.depth, "balanced");
    assert.equal(body.refinedPrompt, "Prompt final");
    assert.equal(body.target, "claude");
    assert.equal(res.headers["access-control-allow-origin"], EXT);
    assert.equal(calls.length, 1);
  });

  it("accepts depth=deep", async () => {
    const { provider, calls } = fakeProvider(() => validOutput());
    const res = await post(buildServer(testConfig(), provider, false), { text: "x", target: "claude", depth: "deep" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().depth, "deep");
    assert.match(calls[0].depthInstruction, /mode="deep"/);
  });

  it("defaults format to the configured default and accepts format=auto", async () => {
    const { provider, calls } = fakeProvider(() => validOutput());
    const md = await post(buildServer(testConfig(), provider, false), { text: "x", target: "claude" });
    assert.equal(md.json().format, "markdown");
    assert.equal(md.json().kind, "prompt");
    assert.match(calls[0].formatInstruction ?? "", /mode="markdown"/);
    const auto = await post(buildServer(testConfig(), provider, false), { text: "x", target: "claude", format: "auto" });
    assert.equal(auto.json().format, "auto");
    assert.equal(calls[1].formatInstruction, "");
    const envAuto = await post(buildServer(testConfig({ defaultFormat: "auto" }), provider, false), {
      text: "x",
      target: "claude",
    });
    assert.equal(envAuto.json().format, "auto");
  });

  it("accepts instruction-file kinds and forces their target and format", async () => {
    const { provider, calls } = fakeProvider(() => validOutput("# Projeto\n\n- Rode `pnpm test`."));
    const app = buildServer(testConfig(), provider, false);
    const claudeMd = (await post(app, { text: "notas", target: "chatgpt", format: "auto", kind: "claude-md" })).json();
    assert.deepEqual([claudeMd.kind, claudeMd.target, claudeMd.format], ["claude-md", "claude-code", "markdown"]);
    assert.equal(claudeMd.refinedPrompt, "# Projeto\n\n- Rode `pnpm test`.");
    assert.match(calls[0].depthInstruction, /<instruction_file>/);
    const agentsMd = (await post(app, { text: "notes", target: "auto", kind: "agents-md" })).json();
    assert.deepEqual([agentsMd.kind, agentsMd.target, agentsMd.format], ["agents-md", "codex", "markdown"]);
    assert.match(calls[1].destinationInstruction, /AGENTS\.md/);
  });

  it("resolves auto target from hostname", async () => {
    const { provider } = fakeProvider(() => validOutput());
    const app = buildServer(testConfig(), provider, false);
    assert.equal((await post(app, { text: "x", target: "auto", hostname: "chatgpt.com" })).json().target, "chatgpt");
    assert.equal((await post(app, { text: "x", target: "auto", hostname: "example.org" })).json().target, "generic");
  });

  it("rejects invalid requests with 4xx and never calls the provider", async () => {
    const { provider, calls } = fakeProvider(() => validOutput());
    const app = buildServer(testConfig(), provider, false);
    const cases: Array<[unknown, number]> = [
      [{ target: "claude" }, 400], // missing text
      [{ text: "x" }, 400], // missing target
      [{ text: "x", target: "bard" }, 400], // invalid target
      [{ text: 5, target: "claude" }, 400],
      [{ text: "   ", target: "claude" }, 400],
      [{ text: "x", target: "claude", pageContent: "<html>" }, 400], // unexpected fields
      [{ text: "x", target: "auto", hostname: "bad host/<script>" }, 400],
      [{ text: "x", target: "claude", depth: "extreme" }, 400],
      [{ text: "x", target: "claude", format: "xml" }, 400],
      [{ text: "x", target: "claude", kind: "readme" }, 400],
      [{ text: "a".repeat(MAX_INPUT_CHARS + 1), target: "claude" }, 413],
    ];
    for (const [body, status] of cases) {
      const res = await post(app, body);
      assert.equal(res.statusCode, status, JSON.stringify(body).slice(0, 80));
      assert.ok(res.json().error.code);
    }
    const notJson = await app.inject({
      method: "POST",
      url: "/api/refine",
      payload: "text",
      headers: { "content-type": "text/plain" },
    });
    assert.equal(notJson.statusCode, 415);
    assert.equal(calls.length, 0);
  });

  it("maps provider errors to 5xx without leaking details", async () => {
    const cases: Array<[ProviderError, number]> = [
      [new ProviderError("upstream", "Anthropic API error 500"), 502],
      [new ProviderError("timeout", "t"), 504],
      [new ProviderError("rate_limited", "r"), 503],
      [new ProviderError("auth", "a"), 503],
      [new ProviderError("refusal", "r"), 422],
    ];
    for (const [err, status] of cases) {
      const { provider } = fakeProvider(() => Promise.reject(err));
      const res = await post(buildServer(testConfig(), provider, false), { text: "x", target: "claude" });
      assert.equal(res.statusCode, status);
      assert.equal(res.json().error.code, err.kind);
      assert.equal(res.json().error.message, "Não foi possível refinar o prompt.");
    }
  });

  it("returns 502 when the LLM answer is invalid", async () => {
    const { provider } = fakeProvider(() => ({ refinedPrompt: "  ", taskType: "ux" }));
    const res = await post(buildServer(testConfig(), provider, false), { text: "x", target: "claude" });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().error.code, "invalid_output");
  });

  it("returns 504 on timeout", async () => {
    const { provider } = fakeProvider(() => new Promise(() => {}));
    const res = await post(buildServer(testConfig({ timeoutMs: 30 }), provider, false), { text: "x", target: "claude" });
    assert.equal(res.statusCode, 504);
  });

  it("returns 503 when no provider is configured", async () => {
    const res = await post(buildServer(testConfig({ configError: "sem chave" }), null, false), { text: "x", target: "claude" });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, "not_configured");
  });

  it("logs token usage and estimated cost, but keeps them out of the response", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const provider = {
      name: "anthropic" as const,
      async compile(req: import("../src/providers/types.js").CompileRequest) {
        req.onUsage?.({ inputTokens: 100, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 0 });
        return validOutput();
      },
    };
    const app = buildServer(testConfig({ model: "claude-sonnet-5-5" }), provider, { level: "info", stream });
    const res = await post(app, { text: "x", target: "claude" });
    assert.equal(res.json().costUsd, undefined);
    assert.equal(res.json().outputTokens, undefined);
    const entry = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "prompt refined");
    assert.equal(entry.outputTokens, 500);
    assert.equal(entry.cacheReadTokens, 2000);
    assert.equal(entry.costUsd, (100 * 2 + 500 * 10 + 2000 * 0.2) / 1e6);
  });

  it("does not log prompt contents", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const secret = "SEGREDO-DO-USUARIO-123";
    const { provider } = fakeProvider(() => validOutput(`Prompt com ${secret}`));
    const app = buildServer(testConfig(), provider, { level: "debug", stream });
    assert.equal((await post(app, { text: `texto ${secret}`, target: "claude" })).statusCode, 200);
    const { provider: failing } = fakeProvider(() => ({ refinedPrompt: "" }));
    await post(buildServer(testConfig(), failing, { level: "debug", stream }), { text: `texto ${secret}`, target: "claude" });
    assert.ok(lines.length > 0);
    assert.ok(lines.every((l) => !l.includes(secret)));
    assert.ok(lines.some((l) => l.includes("prompt refined")));
  });
});

describe("CORS and health", () => {
  it("answers preflight for extension origins", async () => {
    const app = buildServer(testConfig(), fakeProvider(() => validOutput()).provider, false);
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/refine",
      headers: { origin: EXT, "access-control-request-method": "POST" },
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["access-control-allow-origin"], EXT);
    assert.match(String(res.headers["access-control-allow-headers"]), /Content-Type/);
  });
  it("rejects web page origins", async () => {
    const app = buildServer(testConfig(), fakeProvider(() => validOutput()).provider, false);
    const res = await post(app, { text: "x", target: "claude" }, { origin: "https://evil.example" });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
  it("supports an exact-origin allowlist", async () => {
    const app = buildServer(testConfig({ allowedOrigins: [EXT] }), fakeProvider(() => validOutput()).provider, false);
    assert.equal((await post(app, { text: "x", target: "claude" })).statusCode, 200);
    assert.equal((await post(app, { text: "x", target: "claude" }, { origin: "chrome-extension://other" })).statusCode, 403);
  });
  it("reports health", async () => {
    const ok = await buildServer(testConfig(), fakeProvider(() => validOutput()).provider, false).inject("/api/health");
    assert.equal(ok.json().status, "ok");
    assert.equal(ok.json().provider, "anthropic");
    const bad = await buildServer(testConfig({ configError: "PROMPT_COMPILER_MODEL não está definido." }), null, false).inject(
      "/api/health",
    );
    assert.equal(bad.json().status, "misconfigured");
    assert.match(bad.json().message, /MODEL/);
    assert.ok(!JSON.stringify(bad.json()).includes("test")); // never echoes keys
  });
});
