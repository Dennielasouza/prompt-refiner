import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../../backend/src/config/env.js";
import type { CompilerProvider } from "../../backend/src/providers/types.js";
import { buildServer } from "../../backend/src/server.js";
import { targetForApp } from "../src/apps.js";
import { parseOptions, type RunDeps, type RunResult, run } from "../src/refine.js";

let fail = false;
const seen: Array<{ target: string; text: string }> = [];
const provider: CompilerProvider = {
  name: "anthropic",
  async compile(req) {
    if (fail) throw new Error("boom");
    // Instruction files (CLAUDE.md/AGENTS.md) may use different wording: tolerate it.
    const text = /<raw_prompt>\n([\s\S]*)\n<\/raw_prompt>/.exec(req.userMessage)?.[1] ?? "?";
    const target = /sent to: ([^.(]+)/.exec(req.destinationInstruction)?.[1].trim() ?? "?";
    seen.push({ target, text });
    return {
      intent: "",
      taskType: "general",
      complexity: 1,
      strategies: [],
      refinedPrompt: `Linha 1\n\nLinha 2 (${target})`,
      warnings: [],
    };
  },
};

const api = buildServer(loadConfig({ ANTHROPIC_API_KEY: "x", PROMPT_COMPILER_MODEL: "m" }), provider, false);
let endpoint = "";
before(async () => {
  await api.listen({ port: 0, host: "127.0.0.1" });
  endpoint = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;
});
after(() => api.close());

function deps(over: Partial<RunDeps> = {}) {
  const notes: string[] = [];
  const d: RunDeps = {
    endpoint,
    language: "pt-BR",
    frontmostBundleId: async () => "com.anthropic.claudefordesktop",
    feedback: async (style, title, detail) => void notes.push(`${style}: ${title}${detail ? ` | ${detail}` : ""}`),
    ...over,
  };
  return { d, notes };
}

const output = (r: RunResult) => (r.ok ? r.output : assert.fail(`expected success, got: ${r.reason}`));

describe("desktop refine (macOS Service)", () => {
  it("returns the refined prompt, keeping line breaks and the selection's trailing newline", async () => {
    const { d, notes } = deps();
    const out = output(await run("faz um resumo disso\n", "claude", d));
    assert.equal(out, "Linha 1\n\nLinha 2 (Claude)\n");
    assert.deepEqual(seen.at(-1), { target: "Claude", text: "faz um resumo disso\n" });
    assert.deepEqual(notes, ["progress: Refinando para Claude...", "success: Prompt refinado para Claude — ⌘Z desfaz"]);
  });

  it("sends depth=deep and labels the feedback", async () => {
    let body: any;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      const { d, notes } = deps();
      await run("x", "claude", d, "deep");
      assert.equal(body.depth, "deep");
      assert.deepEqual(notes, [
        "progress: Refinando para Claude (profundo)...",
        "success: Prompt refinado para Claude (profundo) — ⌘Z desfaz",
      ]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("sends --format only when given (backend default otherwise)", async () => {
    const bodies: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      await run("x", "claude", deps().d);
      await run("x", "claude", deps().d, "balanced", { format: "auto" });
      await run("x", "claude", deps().d, "balanced", { format: "markdown" });
      assert.equal("format" in bodies[0], false);
      assert.equal("kind" in bodies[0], false);
      assert.equal(bodies[1].format, "auto");
      assert.equal(bodies[2].format, "markdown");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("--kind claude-md/agents-md generates the instructions file with the implied target", async () => {
    const bodies: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      let asked = false;
      for (const [kind, target, file] of [
        ["claude-md", "claude-code", "CLAUDE.md"],
        ["agents-md", "codex", "AGENTS.md"],
      ] as const) {
        const { d, notes } = deps({
          frontmostBundleId: async () => {
            asked = true;
            return null;
          },
        });
        // --target is ignored for files; --format is never sent (always Markdown).
        assert.ok(output(await run("notas do projeto", "auto", d, "balanced", { kind, format: "auto" })).length > 0);
        const body = bodies.at(-1);
        assert.equal(body.kind, kind);
        assert.equal(body.target, target);
        assert.equal("format" in body, false);
        assert.equal("hostname" in body, false);
        assert.deepEqual(notes, [`progress: Gerando ${file}...`, `success: ${file} gerado — ⌘Z desfaz`]);
      }
      assert.equal(asked, false, "the frontmost app is not consulted for files");

      fail = true;
      const err = deps();
      const r = await run("notas", "auto", err.d, "balanced", { kind: "claude-md" });
      fail = false;
      assert.equal(r.ok, false);
      assert.match(err.notes.at(-1)!, /^error: Não foi possível gerar o CLAUDE\.md\. \| /);
      const empty = deps();
      assert.equal((await run("  ", "auto", empty.d, "balanced", { kind: "agents-md" })).ok, false);
      assert.match(empty.notes[0], /^info: Selecione as anotações sobre o projeto para gerar o AGENTS\.md\.$/);
    } finally {
      fail = false;
      globalThis.fetch = realFetch;
    }
  });

  it("parses --kind and --format", () => {
    assert.deepEqual(parseOptions(["--target", "auto"]), { kind: "prompt" });
    assert.deepEqual(parseOptions(["--kind", "claude-md"]), { kind: "claude-md" });
    assert.deepEqual(parseOptions(["--kind", "agents-md", "--format", "auto"]), { kind: "agents-md", format: "auto" });
    assert.deepEqual(parseOptions(["--format", "markdown"]), { kind: "prompt", format: "markdown" });
    assert.deepEqual(parseOptions(["--kind", "readme", "--format", "xml"]), { kind: "prompt" }, "invalid values are ignored");
  });

  it("auto mode picks the target from the frontmost app", async () => {
    assert.match(output(await run("x", "auto", deps({ frontmostBundleId: async () => "com.openai.codex" }).d)), /ChatGPT/);
    assert.match(
      output(await run("x", "auto", deps({ frontmostBundleId: async () => "com.tinyspeck.slackmacgap" }).d)),
      /general-purpose/,
    );
    assert.match(output(await run("x", "auto", deps({ frontmostBundleId: async () => null }).d)), /general-purpose/);
  });

  it("never infers Codex or Claude Code from an app", () => {
    for (const id of ["com.apple.Terminal", "com.googlecode.iterm2", "com.todesktop.230313mzl4w4u92", "com.microsoft.VSCode"]) {
      assert.equal(targetForApp(id), "generic");
    }
  });

  it("fails WITHOUT output (selection untouched) on empty, too long, backend error or backend down", async () => {
    const calls = seen.length;
    const empty = deps();
    assert.deepEqual(await run("   ", "claude", empty.d), { ok: false, reason: "Selecione o prompt que deseja refinar." });
    assert.deepEqual(empty.notes, ["info: Selecione o prompt que deseja refinar."]);

    const long = deps();
    const tooLong = await run("a".repeat(12_001), "claude", long.d);
    assert.equal(tooLong.ok, false);
    assert.deepEqual(long.notes, [
      "error: Não foi possível refinar o prompt. | A seleção tem 12.001 caracteres; o limite é 12.000.",
    ]);
    assert.equal(seen.length, calls, "backend not called");

    fail = true;
    const err = deps();
    const upstream = await run("texto original", "claude", err.d);
    assert.equal(upstream.ok, false);
    assert.doesNotMatch(JSON.stringify(upstream), /texto original/, "the selected text is never echoed");
    assert.match(err.notes.at(-1)!, /^error: Não foi possível refinar o prompt\. \| Erro interno do backend/);
    fail = false;

    const down = deps({ endpoint: "http://127.0.0.1:9" });
    const unavailable = await run("texto original", "claude", down.d);
    assert.deepEqual(unavailable, {
      ok: false,
      reason: "Não foi possível refinar o prompt. Backend indisponível em http://127.0.0.1:9.",
    });
    assert.equal(down.notes.at(-1), "error: Não foi possível refinar o prompt. | Backend indisponível em http://127.0.0.1:9.");
  });

  it("explains backend error codes and rejects invalid responses", async () => {
    const realFetch = globalThis.fetch;
    const respond = (status: number, body: unknown) =>
      (globalThis.fetch = (async () =>
        new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as typeof fetch);
    try {
      const cases: Array<[number, unknown, RegExp]> = [
        [503, { error: { code: "not_configured", message: "x" } }, /não está configurado/],
        [503, { error: { code: "rate_limited", message: "x" } }, /sobrecarregado/],
        [502, "<html>bad gateway</html>", /erro HTTP 502/],
        [200, { refinedPrompt: "   ", target: "claude" }, /resposta inválida/],
        [200, { refinedPrompt: "ok", target: "auto" }, /resposta inválida/],
      ];
      for (const [status, body, expected] of cases) {
        respond(status, body);
        const { d, notes } = deps();
        const result = await run("x", "claude", d);
        assert.equal(result.ok, false);
        assert.match(notes.at(-1)!, expected);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
