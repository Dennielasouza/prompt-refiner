#!/usr/bin/env node
// Fake `claude` CLI for the claude-cli provider tests (no network, no real login).
// The scenario is chosen by the text received on stdin (the user message).
import { readFileSync } from "node:fs";

const stdin = readFileSync(0, "utf8");
const args = process.argv.slice(2);
const base = { type: "result", subtype: "success", is_error: false, api_error_status: null, stop_reason: "end_turn" };
const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 };
const out = (obj, code = 0) => {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
};
const valid = { taskType: "ux", complexity: 2, refinedPrompt: "P", warnings: [] };

if (stdin.includes("SCENARIO:hang")) setTimeout(() => {}, 60_000);
else if (stdin.includes("SCENARIO:auth")) {
  const zero = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  out(
    { ...base, is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed", usage: zero },
    1,
  );
} else if (stdin.includes("SCENARIO:limit")) {
  out({ ...base, is_error: true, result: "Claude AI usage limit reached|1760000000" }, 1);
} else if (stdin.includes("SCENARIO:429")) {
  out({ ...base, is_error: true, api_error_status: 429, result: "API Error" }, 1);
} else if (stdin.includes("SCENARIO:overloaded")) {
  out({ ...base, is_error: true, api_error_status: 529, result: "API Error: Overloaded" }, 1);
} else if (stdin.includes("SCENARIO:schema")) {
  out({ ...base, subtype: "error_max_structured_output_retries", is_error: true, result: "" }, 1);
} else if (stdin.includes("SCENARIO:refusal")) {
  out({ ...base, stop_reason: "refusal", result: "" });
} else if (stdin.includes("SCENARIO:garbage")) {
  process.stdout.write("not json at all\n");
  process.exit(2);
} else if (stdin.includes("SCENARIO:result-only")) {
  out({ ...base, result: JSON.stringify(valid), usage });
} else if (stdin.includes("SCENARIO:bad-json")) {
  out({ ...base, result: "sorry, here is your prompt" });
} else {
  // Echo what the provider sent so the test can check flags, cwd, env and stdin.
  out({
    ...base,
    result: "",
    structured_output: {
      ...valid,
      _args: args,
      _cwd: process.cwd(),
      _envKeys: Object.keys(process.env).sort(),
      _stdin: stdin,
    },
    usage,
  });
}
