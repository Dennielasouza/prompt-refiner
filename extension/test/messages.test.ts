import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRefineResponse } from "../src/api.js";
import { isLastFailure } from "../src/feedback.js";
import { isCaptureResponse, isToBackground, isToContent, kindOf } from "../src/messages.js";
import { DEFAULT_SETTINGS, getSettings, isLocalEndpoint, normalizeEndpoint } from "../src/settings.js";

describe("message validation", () => {
  it("accepts well-formed messages only", () => {
    assert.ok(isToContent({ type: "pr:capture", opId: "1", target: "auto", depth: "balanced", kind: "prompt" }));
    assert.ok(isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "x", target: "claude", depth: "deep", kind: "prompt" }));
    assert.ok(!isToContent({ type: "pr:capture", opId: "1", target: "auto", kind: "prompt" }), "depth is required");
    assert.ok(!isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "x", target: "claude", depth: "max", kind: "prompt" }));
    assert.ok(isToContent({ type: "pr:error", opId: "1" }));
    // kind: prompt or an instructions file; validated when present.
    assert.ok(isToContent({ type: "pr:capture", opId: "1", target: "claude-code", depth: "balanced", kind: "claude-md" }));
    assert.ok(
      isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "# x", target: "codex", depth: "balanced", kind: "agents-md" }),
    );
    assert.ok(!isToContent({ type: "pr:capture", opId: "1", target: "auto", depth: "balanced", kind: null }));
    assert.ok(!isToContent({ type: "pr:capture", opId: "1", target: "auto", depth: "balanced", kind: "readme" }));
    assert.ok(
      !isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "x", target: "claude", depth: "balanced", kind: "CLAUDE.md" }),
    );
    assert.ok(!isToContent({ type: "pr:capture", opId: "1", target: "bard", depth: "balanced", kind: "prompt" }));
    assert.ok(
      !isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "", target: "claude", depth: "balanced", kind: "prompt" }),
    );
    assert.ok(
      !isToContent({ type: "pr:apply", opId: "1", refinedPrompt: "x", target: "auto", depth: "balanced", kind: "prompt" }),
    );
    assert.ok(!isToContent({ type: "pr:eval", opId: "1" }));
    assert.ok(!isToContent(null));
    assert.ok(isToBackground({ type: "pr:cancel", opId: "1" }));
    assert.ok(!isToBackground({ type: "pr:cancel" }));
    assert.ok(isCaptureResponse({ ok: false, reason: "no_selection" }));
    assert.ok(!isCaptureResponse({ ok: true }));
    assert.ok(isCaptureResponse({ ok: true, text: "x", hostname: "a.com" }));
    assert.ok(isCaptureResponse({ ok: true, text: "x", hostname: "a.com", build: "0.1.0-abc" }));
    assert.ok(!isCaptureResponse({ ok: true, text: "x", hostname: "a.com", build: 1 }));
  });
  it("accepts messages from an older background that did not send kind (rebuilt, not reloaded)", () => {
    // Chrome keeps the old service worker running while content.js is read from disk: this exact
    // message shape from the previous build used to be dropped, so every right-click failed.
    const capture = { type: "pr:capture", opId: "1", target: "auto", depth: "balanced" };
    const apply = { type: "pr:apply", opId: "1", refinedPrompt: "x", target: "claude", depth: "deep" };
    assert.ok(isToContent(capture));
    assert.ok(isToContent(apply));
    assert.equal(kindOf(capture as never), "prompt");
    assert.equal(kindOf({ kind: "agents-md" }), "agents-md");
  });
  it("validates the stored last failure", () => {
    assert.ok(isLastFailure({ title: "Prompt Refiner — x", at: 1 }));
    assert.ok(!isLastFailure({ title: "x" }));
    assert.ok(!isLastFailure({ title: "x".repeat(501), at: 1 }));
    assert.ok(!isLastFailure(null));
  });
  it("validates backend responses", () => {
    assert.ok(
      isRefineResponse({ refinedPrompt: "p", target: "gemini", taskType: "x", complexity: 1, strategies: [], warnings: [] }),
    );
    assert.ok(
      isRefineResponse({
        refinedPrompt: "# P",
        target: "claude-code",
        depth: "balanced",
        format: "markdown",
        kind: "claude-md",
        taskType: "x",
        complexity: 1,
        strategies: [],
        warnings: [],
      }),
    );
    assert.ok(!isRefineResponse({ refinedPrompt: " ", target: "gemini" }));
    assert.ok(!isRefineResponse({ refinedPrompt: "p", target: "auto" }));
    assert.ok(!isRefineResponse("p"));
  });
});

describe("settings", () => {
  it("normalizes endpoints", () => {
    assert.equal(normalizeEndpoint("http://localhost:8787/"), "http://localhost:8787");
    assert.equal(normalizeEndpoint(" https://api.exemplo.com/refiner/ "), "https://api.exemplo.com/refiner");
    assert.equal(normalizeEndpoint("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
    // Plain http off the local machine would send the selection in the clear.
    assert.equal(normalizeEndpoint("http://exemplo.com/refiner"), null);
    assert.equal(normalizeEndpoint("ftp://x"), null);
    assert.equal(normalizeEndpoint("javascript:alert(1)"), null);
    assert.equal(normalizeEndpoint("http://user:pw@host"), null);
    assert.equal(normalizeEndpoint("nada"), null);
  });
  it("defaults the prompt format to Markdown and validates stored values", async () => {
    assert.equal(DEFAULT_SETTINGS.format, "markdown");
    const stored: Record<string, unknown> = {};
    const g = globalThis as unknown as { chrome?: unknown };
    const previous = g.chrome;
    g.chrome = { storage: { sync: { get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...stored }) } } };
    try {
      assert.equal((await getSettings()).format, "markdown");
      stored.format = "auto";
      assert.equal((await getSettings()).format, "auto");
      stored.format = "xml";
      assert.equal((await getSettings()).format, "markdown", "unknown values fall back to the default");
    } finally {
      g.chrome = previous;
    }
  });
  it("detects local endpoints", () => {
    assert.ok(isLocalEndpoint("http://localhost:8787"));
    assert.ok(isLocalEndpoint("http://127.0.0.1:8787"));
    assert.ok(!isLocalEndpoint("http://exemplo.com"));
  });
});
