import { type AppConfig, loadConfig } from "../src/config/env.js";
import type { CompileRequest, CompilerProvider } from "../src/providers/types.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({ PROMPT_COMPILER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test", PROMPT_COMPILER_MODEL: "m" }),
    ...overrides,
  };
}

/** Fake provider: records requests and answers with a canned or computed payload. */
export function fakeProvider(answer: (req: CompileRequest) => unknown | Promise<unknown>) {
  const calls: CompileRequest[] = [];
  const provider: CompilerProvider = {
    name: "anthropic",
    async compile(req) {
      calls.push(req);
      return answer(req);
    },
  };
  return { provider, calls };
}

export const validOutput = (refinedPrompt = "Analise a hierarquia visual do dashboard.") => ({
  taskType: "ux",
  complexity: 2,
  strategies: ["objective", "grounding"],
  refinedPrompt,
  warnings: [],
});
