import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config/env.js";

describe("loadConfig", () => {
  it("uses the explicit provider", () => {
    const c = loadConfig({
      PROMPT_COMPILER_PROVIDER: "openai",
      OPENAI_API_KEY: "k",
      ANTHROPIC_API_KEY: "a",
      PROMPT_COMPILER_MODEL: "m",
    });
    assert.equal(c.provider, "openai");
    assert.equal(c.configError, undefined);
  });
  it("works with only one key configured", () => {
    assert.equal(loadConfig({ OPENAI_API_KEY: "k", PROMPT_COMPILER_MODEL: "m" }).provider, "openai");
    assert.equal(loadConfig({ ANTHROPIC_API_KEY: "k", PROMPT_COMPILER_MODEL: "m" }).provider, "anthropic");
  });
  it("reports missing key, model or invalid provider", () => {
    assert.match(loadConfig({ PROMPT_COMPILER_PROVIDER: "anthropic", PROMPT_COMPILER_MODEL: "m" }).configError!, /chave/);
    assert.match(loadConfig({ ANTHROPIC_API_KEY: "k" }).configError!, /MODEL/);
    assert.match(loadConfig({ PROMPT_COMPILER_PROVIDER: "x", PROMPT_COMPILER_MODEL: "m" }).configError!, /inválido/);
    assert.match(loadConfig({}).configError!, /Nenhuma chave/);
  });
  it("applies safe defaults", () => {
    const c = loadConfig({});
    assert.equal(c.port, 8787);
    assert.equal(c.host, "127.0.0.1");
    assert.deepEqual(c.allowedOrigins, ["chrome-extension://*"]);
    assert.equal(c.effort, undefined);
    assert.equal(loadConfig({ PROMPT_COMPILER_EFFORT: "LOW" }).effort, "low");
  });
});
