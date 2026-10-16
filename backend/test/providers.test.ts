import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAnthropicProvider } from "../src/providers/anthropic.js";
import { createOpenAIProvider } from "../src/providers/openai.js";
import { type CompileRequest, ProviderError } from "../src/providers/types.js";
import { validOutput } from "./helpers.js";

/** Mock fetch for the official SDKs: records the request and returns a canned response. */
function mockFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Headers; body: any }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}

const req = (): CompileRequest => ({
  coreInstruction: "CORE",
  depthInstruction: "DEPTH",
  destinationInstruction: "DEST",
  userMessage: "USER",
  schema: { type: "object" },
  signal: new AbortController().signal,
});

const anthropicMessage = (stop_reason: string, text: string) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "m",
  content: [{ type: "text", text }],
  stop_reason,
  usage: { input_tokens: 1, output_tokens: 1 },
});

describe("Anthropic provider", () => {
  const base = { apiKey: "k", maxOutputTokens: 1000, refusalFallback: true };

  it("sends structured-output request with cacheable system prompt and parses JSON", async () => {
    const { fn, calls } = mockFetch(200, anthropicMessage("end_turn", JSON.stringify(validOutput("P"))));
    const p = createAnthropicProvider({ ...base, model: "claude-haiku-4-5", effort: "low", fetch: fn });
    const usages: unknown[] = [];
    const out = (await p.compile({ ...req(), onUsage: (u) => usages.push(u) })) as { refinedPrompt: string };
    assert.equal(out.refinedPrompt, "P");
    assert.deepEqual(usages, [
      { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, thinkingBlocks: 0 },
    ]);
    const { url, headers, body } = calls[0];
    assert.match(url, /\/v1\/messages$/);
    assert.equal(headers.get("x-api-key"), "k");
    assert.equal(headers.get("anthropic-beta"), null, "no fallback beta for models without fallbacks");
    assert.equal(body.model, "claude-haiku-4-5");
    assert.deepEqual(body.system[0], { type: "text", text: "CORE", cache_control: { type: "ephemeral", ttl: "1h" } });
    assert.deepEqual(body.system[1], { type: "text", text: "DEPTH", cache_control: { type: "ephemeral" } });
    assert.equal(body.system[2].text, "DEST");
    assert.deepEqual(body.messages, [{ role: "user", content: "USER" }]);
    assert.deepEqual(body.output_config, { format: { type: "json_schema", schema: { type: "object" } }, effort: "low" });
    assert.equal(body.tool_choice, undefined, "no forced tool use (rejected by newer models)");
  });

  it("ignores thinking blocks in the answer but counts them for the log", async () => {
    const msg = anthropicMessage("end_turn", JSON.stringify(validOutput("P")));
    msg.content = [{ type: "thinking", thinking: "", signature: "s" } as never, ...msg.content];
    const { fn } = mockFetch(200, msg);
    const usages: Array<{ thinkingBlocks?: number }> = [];
    const out = (await createAnthropicProvider({ ...base, model: "claude-sonnet-5-5", fetch: fn }).compile({
      ...req(),
      onUsage: (u) => usages.push(u),
    })) as {
      refinedPrompt: string;
    };
    assert.equal(out.refinedPrompt, "P");
    assert.equal(usages[0].thinkingBlocks, 1);
  });

  it("adds the format block as a cached system part between depth and destination", async () => {
    const { fn, calls } = mockFetch(200, anthropicMessage("end_turn", JSON.stringify(validOutput())));
    await createAnthropicProvider({ ...base, model: "claude-haiku-4-5", fetch: fn }).compile({
      ...req(),
      formatInstruction: "FORMAT",
    });
    const system = calls[0].body.system;
    assert.deepEqual(
      system.map((b: { text: string }) => b.text),
      ["CORE", "DEPTH", "FORMAT", "DEST"],
    );
    assert.deepEqual(system[2].cache_control, { type: "ephemeral" });
    assert.equal(system[3].cache_control, undefined);
  });

  it("keeps depth and format cached for 1 h when asked, and reports 1 h writes", async () => {
    const msg = anthropicMessage("end_turn", JSON.stringify(validOutput()));
    msg.usage = {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 500,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 400 },
    } as never;
    const { fn, calls } = mockFetch(200, msg);
    const usages: Array<{ cacheWriteTokens: number; cacheWrite1hTokens?: number }> = [];
    await createAnthropicProvider({ ...base, model: "claude-haiku-4-5", fetch: fn }).compile({
      ...req(),
      formatInstruction: "FORMAT",
      longCacheDepth: true,
      onUsage: (u) => usages.push(u),
    });
    const ttl = calls[0].body.system.map((b: { cache_control?: { ttl?: string } }) => b.cache_control?.ttl ?? null);
    assert.deepEqual(ttl, ["1h", "1h", "1h", null]);
    assert.equal(usages[0].cacheWriteTokens, 500);
    assert.equal(usages[0].cacheWrite1hTokens, 400);
  });

  it("enables server-side refusal fallback on supported models", async () => {
    const { fn, calls } = mockFetch(200, anthropicMessage("end_turn", JSON.stringify(validOutput())));
    await createAnthropicProvider({ ...base, model: "claude-opus-5-5", fetch: fn }).compile(req());
    assert.match(calls[0].headers.get("anthropic-beta") ?? "", /server-side-fallback-2026-07-01/);
    assert.equal(calls[0].body.fallbacks, "default");
  });

  it("maps refusal, truncation, bad JSON and HTTP errors", async () => {
    const cases: Array<[number, unknown, string]> = [
      [200, anthropicMessage("refusal", ""), "refusal"],
      [200, anthropicMessage("max_tokens", "{"), "invalid_output"],
      [200, anthropicMessage("end_turn", "not json"), "invalid_output"],
      [401, { type: "error", error: { type: "authentication_error", message: "x" } }, "auth"],
      [429, { type: "error", error: { type: "rate_limit_error", message: "x" } }, "rate_limited"],
      [400, { type: "error", error: { type: "invalid_request_error", message: "x" } }, "upstream"],
    ];
    for (const [status, body, kind] of cases) {
      const { fn } = mockFetch(status, body);
      const p = createAnthropicProvider({ ...base, model: "claude-haiku-4-5", fetch: fn });
      await assert.rejects(
        p.compile(req()),
        (e: unknown) => e instanceof ProviderError && e.kind === kind,
        `${status} → ${kind}`,
      );
    }
  });
});

describe("OpenAI provider", () => {
  const response = (status: string, content: unknown[]) => ({
    id: "resp_1",
    object: "response",
    status,
    model: "m",
    output: [{ type: "message", id: "m1", role: "assistant", status: "completed", content }],
  });

  it("sends a strict json_schema Responses request and parses output_text", async () => {
    const { fn, calls } = mockFetch(
      200,
      response("completed", [{ type: "output_text", text: JSON.stringify(validOutput("P")), annotations: [] }]),
    );
    const p = createOpenAIProvider({ apiKey: "k", model: "some-model", maxOutputTokens: 900, fetch: fn });
    const out = (await p.compile(req())) as { refinedPrompt: string };
    assert.equal(out.refinedPrompt, "P");
    const { url, headers, body } = calls[0];
    assert.match(url, /\/responses$/);
    assert.equal(headers.get("authorization"), "Bearer k");
    assert.equal(body.instructions, "CORE\n\nDEPTH\n\nDEST");
    assert.equal(body.input, "USER");
    assert.equal(body.max_output_tokens, 900);
    assert.deepEqual(body.text.format, { type: "json_schema", name: "refined_prompt", schema: { type: "object" }, strict: true });
    assert.equal(body.reasoning, undefined, "reasoning effort only when configured");
  });

  it("joins the format block into the instructions only when present", async () => {
    const { fn, calls } = mockFetch(
      200,
      response("completed", [{ type: "output_text", text: JSON.stringify(validOutput()), annotations: [] }]),
    );
    const p = createOpenAIProvider({ apiKey: "k", model: "some-model", maxOutputTokens: 900, fetch: fn });
    await p.compile({ ...req(), formatInstruction: "FORMAT" });
    await p.compile({ ...req(), formatInstruction: "" });
    assert.equal(calls[0].body.instructions, "CORE\n\nDEPTH\n\nFORMAT\n\nDEST");
    assert.equal(calls[1].body.instructions, "CORE\n\nDEPTH\n\nDEST");
  });

  it("maps refusal, incomplete output and HTTP errors", async () => {
    const cases: Array<[number, unknown, string]> = [
      [200, response("completed", [{ type: "refusal", refusal: "no" }]), "refusal"],
      [200, response("incomplete", [{ type: "output_text", text: "{", annotations: [] }]), "invalid_output"],
      [401, { error: { message: "bad key", type: "invalid_request_error" } }, "auth"],
      [500, { error: { message: "x" } }, "upstream"],
    ];
    for (const [status, body, kind] of cases) {
      const { fn } = mockFetch(status, body);
      const p = createOpenAIProvider({ apiKey: "k", model: "m", maxOutputTokens: 10, fetch: fn });
      await assert.rejects(
        p.compile(req()),
        (e: unknown) => e instanceof ProviderError && e.kind === kind,
        `${status} → ${kind}`,
      );
    }
  });
});
