import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Target } from "../../shared/api.js";
import { suggestionLine } from "../../shared/api.js";
import { recommend } from "../src/engine/recommendation.js";
import { type Complexity, TASK_TYPES, type TaskType } from "../src/engine/types.js";

describe("recommend", () => {
  it("suggests the smallest model and lowest effort for a trivial request", () => {
    assert.deepEqual(recommend(1, "general", "chatgpt"), { model: "Luna", effort: "low" });
    assert.deepEqual(recommend(1, "general", "claude"), { model: "Haiku 5.5", effort: "low" });
  });

  it("suggests more model and more effort as the request gets harder", () => {
    assert.deepEqual(recommend(3, "general", "claude"), { model: "Sonnet 5.5", effort: "medium" });
    assert.deepEqual(recommend(5, "general", "claude"), { model: "Fable 5.1", effort: "high" });
    assert.deepEqual(recommend(5, "general", "chatgpt"), { model: "Astra", effort: "high" });
  });

  it("never gets cheaper as complexity goes up — model AND effort, for every task type", () => {
    const effortRank = { low: 0, medium: 1, high: 2 } as const;
    const models = ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"];
    for (const taskType of TASK_TYPES) {
      let previous = [-1, -1];
      for (const c of [1, 2, 3, 4, 5] as Complexity[]) {
        const r = recommend(c, taskType, "claude");
        const now = [models.indexOf(r.model), effortRank[r.effort]];
        assert.ok(
          now[0] > previous[0] || (now[0] === previous[0] && now[1] >= previous[1]),
          `${taskType}: complexity ${c} got cheaper than ${c - 1} (${r.model}/${r.effort})`,
        );
        previous = now;
      }
    }
  });

  it("a lighter task type never costs more than general, and a harder one never costs less", () => {
    const effortRank = { low: 0, medium: 1, high: 2 } as const;
    const models = ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"];
    const cost = (c: Complexity, t: TaskType) => {
      const r = recommend(c, t, "claude");
      return models.indexOf(r.model) * 3 + effortRank[r.effort];
    };
    for (const c of [1, 2, 3, 4, 5] as Complexity[]) {
      const base = cost(c, "general");
      assert.ok(cost(c, "rewriting") <= base, `rewriting costs more than general at ${c}`);
      assert.ok(cost(c, "debugging") >= base, `debugging costs less than general at ${c}`);
    }
  });

  it("raises effort before model for task types that have to run or act", () => {
    // Same complexity as the general case, but code runs: effort goes up, the model does not.
    assert.deepEqual(recommend(3, "debugging", "claude"), { model: "Sonnet 5.5", effort: "high" });
    assert.deepEqual(recommend(3, "agent_task", "chatgpt"), { model: "Sol", effort: "high" });
  });

  it("drops the MODEL first for lighter task types, because that is where the money is", () => {
    // Haiku costs about a twentieth of Sonnet (config/pricing.ts); one effort level saves a fraction.
    // Visible above the floor: the rung falls and the effort stays where the base put it.
    assert.deepEqual(recommend(5, "classification", "claude"), { model: "Opus 5.5", effort: "high" });
    assert.deepEqual(recommend(4, "rewriting", "claude"), { model: "Sonnet 5.5", effort: "high" });
  });

  it("drops effort only once the model is already the smallest", () => {
    assert.deepEqual(recommend(2, "rewriting", "claude"), { model: "Haiku 5.5", effort: "low" });
  });

  it("reaches for a bigger model on a hard task type only when effort is already maxed", () => {
    // complexity 4 is the one level where the step moves the model — deliberate, not a side effect.
    assert.deepEqual(recommend(4, "coding", "claude"), { model: "Fable 5.1", effort: "high" });
    // At complexity 3 the step raises effort and leaves the rung alone.
    assert.deepEqual(recommend(3, "coding", "claude"), { model: "Sonnet 5.5", effort: "high" });
  });

  it("stays within the family and never falls off either end", () => {
    assert.deepEqual(recommend(5, "agent_task", "claude"), { model: "Fable 5.1", effort: "high" });
    assert.deepEqual(recommend(1, "rewriting", "claude"), { model: "Haiku 5.5", effort: "low" });
  });

  it("names the real Gemini model for the gemini destination", () => {
    assert.deepEqual(recommend(1, "general", "gemini"), { model: "3.5 Flash-Lite", effort: "low" });
    assert.deepEqual(recommend(5, "general", "gemini"), { model: "4 Argon", effort: "high" });
  });

  it("names every family when the destination is unknown — never a vague size", () => {
    // "um modelo rápido" is not something anyone can pick in a model menu.
    assert.deepEqual(recommend(1, "general", "generic"), {
      model: "Haiku 5.5 (Claude), Luna (ChatGPT) ou 3.5 Flash-Lite (Gemini)",
      effort: "low",
    });
    assert.deepEqual(recommend(5, "general", "generic"), {
      model: "Fable 5.1 (Claude), Astra (ChatGPT) ou 4 Argon (Gemini)",
      effort: "high",
    });
  });

  it("every suggestion survives the formatter and its length caps", () => {
    for (const target of ["chatgpt", "claude", "gemini", "codex", "claude-code", "generic"] as const) {
      for (const c of [1, 2, 3, 4, 5] as Complexity[]) {
        for (const taskType of TASK_TYPES) {
          const line = suggestionLine(recommend(c, taskType, target));
          assert.ok(line, `${target}/${c}/${taskType} produced no line`);
          assert.ok(line.length <= 120, `${target}/${c}/${taskType}: ${line.length} chars — ${line}`);
        }
      }
    }
  });

  it("the ultra tier is reachable, not decoration", () => {
    // A top rung nothing can reach is worse than no rung: it reads as a ladder the engine never uses.
    assert.equal(recommend(5, "general", "claude").model, "Fable 5.1");
    assert.equal(recommend(4, "coding", "claude").model, "Fable 5.1");
  });

  it("a three-rung family shares its middle model across two levels instead of inventing a name", () => {
    // Astra is the documented top of the OpenAI family; there is no fourth name to put above it.
    // Levels 1 and 2 therefore both land on Sol, separated by effort rather than by a made-up model.
    assert.deepEqual(recommend(3, "general", "chatgpt"), { model: "Sol", effort: "medium" });
    assert.deepEqual(recommend(4, "general", "chatgpt"), { model: "Sol", effort: "high" });
    assert.deepEqual(recommend(5, "general", "chatgpt"), { model: "Astra", effort: "high" });
  });

  it("never names a model outside the destination's own family", () => {
    const ladders = {
      claude: ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"],
      "claude-code": ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5", "Fable 5.1"],
      chatgpt: ["Luna", "Sol", "Astra"],
      codex: ["Luna", "Sol", "Astra"],
      gemini: ["3.5 Flash-Lite", "3.8 Flash", "4 Argon"],
    } as const;
    for (const [target, ladder] of Object.entries(ladders)) {
      for (const c of [1, 2, 3, 4, 5] as Complexity[]) {
        for (const taskType of TASK_TYPES) {
          const { model } = recommend(c, taskType, target as Target);
          assert.ok(ladder.includes(model as never), `${target}/${c}/${taskType} named ${model}`);
        }
      }
    }
  });

  it("the floor never lets a task that RUNS or ACTS land on the smallest model", () => {
    // Measured defect this closes: coding/debugging at complexity 1–2 used to suggest Haiku, the
    // tier where broken code shows up first. Economy that costs the answer is not economy.
    for (const taskType of ["coding", "implementation", "debugging", "agent_task", "automation"] as const) {
      for (const c of [1, 2, 3, 4, 5] as Complexity[]) {
        assert.notEqual(recommend(c, taskType, "claude").model, "Haiku 5.5", `${taskType} at ${c}`);
        assert.notEqual(recommend(c, taskType, "chatgpt").model, "Luna", `${taskType} at ${c}`);
        assert.notEqual(recommend(c, taskType, "gemini").model, "3.5 Flash-Lite", `${taskType} at ${c}`);
      }
    }
    assert.deepEqual(recommend(1, "coding", "claude"), { model: "Sonnet 5.5", effort: "medium" });
    assert.deepEqual(recommend(2, "coding", "claude"), { model: "Sonnet 5.5", effort: "high" });
  });

  it("the floor keeps anything the engine read as complexity 3+ at the middle rung or better", () => {
    // The compiler already judged the request non-trivial; a task-type hint does not overrule it.
    for (const taskType of TASK_TYPES) {
      for (const c of [3, 4, 5] as Complexity[]) {
        assert.notEqual(recommend(c, taskType, "claude").model, "Haiku 5.5", `${taskType} at ${c}`);
      }
    }
    // This is what changed: a rewrite the engine called complexity 3 no longer drops to the smallest.
    assert.deepEqual(recommend(3, "rewriting", "claude"), { model: "Sonnet 5.5", effort: "medium" });
    assert.deepEqual(recommend(3, "classification", "claude"), { model: "Sonnet 5.5", effort: "medium" });
  });

  it("the floor leaves the trivial case alone — that case is the whole point", () => {
    // A request that neither runs nor acts, and that the engine read as trivial, still gets the
    // smallest model. Flooring this away would leave the suggestion with no economy to offer.
    assert.deepEqual(recommend(1, "general", "claude"), { model: "Haiku 5.5", effort: "low" });
    assert.deepEqual(recommend(2, "writing", "claude"), { model: "Haiku 5.5", effort: "medium" });
    assert.deepEqual(recommend(1, "rewriting", "claude"), { model: "Haiku 5.5", effort: "low" });
    assert.deepEqual(recommend(2, "rewriting", "claude"), { model: "Haiku 5.5", effort: "low" });
  });

  it("uses the OpenAI family for Codex and the Anthropic one for Claude Code", () => {
    assert.equal(recommend(3, "coding", "codex").model, "Sol");
    assert.equal(recommend(3, "coding", "claude-code").model, "Sonnet 5.5");
  });
});

describe("suggestionLine", () => {
  it("formats a valid suggestion", () => {
    assert.equal(suggestionLine({ model: "Haiku 5.5", effort: "low" }), "Sugestão: Haiku 5.5, esforço baixo");
  });

  it("drops anything unexpected instead of showing a broken line", () => {
    // The endpoint is configurable, so the response is untrusted like every other field.
    for (const bad of [
      undefined,
      null,
      "Sonnet",
      {},
      { model: "Sonnet 5.5" },
      { model: "Sonnet 5.5", effort: "turbo" },
      { model: 42, effort: "low" },
      { model: "", effort: "low" },
      { model: "x".repeat(101), effort: "low" },
    ]) {
      assert.equal(suggestionLine(bad), undefined, `should have dropped ${JSON.stringify(bad)}`);
    }
  });
});
