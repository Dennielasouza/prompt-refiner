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

/**
 * Keeps the event loop busy while `run` is awaited.
 *
 * The engine's timeout comes from `AbortSignal.timeout()`, which is unref'd: when a test's only
 * pending work is a provider promise that never settles, Node can drain the loop and report
 * "Promise resolution is still pending but the event loop has already resolved" before the abort
 * fires. A real request always has an open socket holding the loop; a test does not.
 */
export async function keepingEventLoopAlive<T>(run: () => Promise<T>): Promise<T> {
  const tick = setInterval(() => {}, 1_000);
  try {
    return await run();
  } finally {
    clearInterval(tick);
  }
}
