import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateCostUsd } from "../src/config/pricing.js";

describe("estimateCostUsd", () => {
  it("prices every token class for known models", () => {
    // Sonnet 5.5: 1M input $2, 1M output $10, 1M cache read $0.20, 1M cache write $2.50
    const usage = { inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 3000, cacheWriteTokens: 4000 };
    assert.equal(estimateCostUsd("claude-sonnet-5-5", usage), (1000 * 2 + 2000 * 10 + 3000 * 0.2 + 4000 * 2.5) / 1e6);
  });
  it("prices 1 h cache writes at 2× input", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 4000, cacheWrite1hTokens: 3000 };
    assert.equal(estimateCostUsd("claude-sonnet-5-5", usage), (1000 * 2.5 + 3000 * 4) / 1e6);
  });
  it("returns null for unknown models", () => {
    assert.equal(
      estimateCostUsd("some-other-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      null,
    );
    assert.equal(estimateCostUsd(null, { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }), null);
  });
});
