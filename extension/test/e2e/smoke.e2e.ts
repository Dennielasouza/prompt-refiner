/**
 * End-to-end smoke test: real unpacked extension (dist-e2e) in Playwright's Chromium,
 * real backend HTTP server, deterministic fake compiler provider (no API key needed).
 *
 * Native context menus cannot be clicked by automation, so the test calls the same
 * runRefinement() the menu handler calls (exposed only in the e2e build).
 */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Page, type Worker } from "playwright";
import { loadConfig } from "../../../backend/src/config/env.js";
import type { CompilerProvider } from "../../../backend/src/providers/types.js";
import { buildServer } from "../../../backend/src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = join(here, "../../dist-e2e");
const FIXTURES = join(here, "../fixtures");

// --- Fake compiler provider, scripted per test ---------------------------------
type Mode = "ok" | "fail" | "multiline" | "file";
let mode: Mode = "ok";
let compileCalls = 0;
const requestBodies: Record<string, unknown>[] = [];

const provider: CompilerProvider = {
  name: "anthropic",
  async compile(req) {
    compileCalls++;
    if (mode === "fail") throw new Error("boom");
    if (mode === "file") await new Promise((r) => setTimeout(r, 400)); // long enough to see the loading toast
    const target = /sent to: ([^.(]+)/.exec(req.destinationInstruction)?.[1].trim() ?? "?";
    const refinedPrompt =
      mode === "multiline"
        ? "Analise a hierarquia visual do dashboard.\n\nListe os problemas encontrados e proponha melhorias."
        : mode === "file"
          ? "# Projeto\n\n## Comandos\n\n- `npm test`"
          : `REFINADO para ${target}`;
    return { intent: "x", taskType: "ux", complexity: 2, strategies: ["objective"], refinedPrompt, warnings: [] };
  },
};

let api: ReturnType<typeof buildServer>;
let apiUrl: string;
let fixtures: Server;
let fixturesUrl: string;
let context: BrowserContext;
let sw: Worker;
let page: Page;
const consoleErrors: string[] = [];

async function setEndpoint(endpoint: string) {
  await sw.evaluate((e) => chrome.storage.sync.set({ endpoint: e }), endpoint);
}

async function tabId(): Promise<number> {
  return sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id!, fixturesUrl);
}

async function refine(target: string, depth: "balanced" | "deep" = "balanced", kind?: "prompt" | "claude-md" | "agents-md") {
  const id = await tabId();
  await sw.evaluate(
    ([t, tgt, d, k]) =>
      (
        globalThis as unknown as {
          __promptRefinerTest: { runRefinement: (a: number, b: number, c: string, d: string, k?: string) => Promise<void> };
        }
      ).__promptRefinerTest.runRefinement(t as number, 0, tgt as string, d as string, (k ?? undefined) as string | undefined),
    [id, target, depth, kind ?? null] as const,
  );
}

async function toastText(): Promise<string> {
  return page.evaluate(
    () => document.getElementById("prompt-refiner-toast-host")?.shadowRoot?.querySelector(".toast")?.textContent ?? "",
  );
}

async function clickToastButton(label: string) {
  await page.evaluate((l) => {
    const buttons = document.getElementById("prompt-refiner-toast-host")!.shadowRoot!.querySelectorAll("button");
    [...buttons].find((b) => b.textContent === l)!.click();
  }, label);
}

function selectInField(id: string, needle: string) {
  return page.evaluate(
    ([elId, n]) => {
      const el = document.getElementById(elId) as HTMLTextAreaElement;
      el.focus();
      const start = el.value.indexOf(n);
      el.setSelectionRange(start, start + n.length);
    },
    [id, needle] as const,
  );
}

function selectInEditable(selector: string, needle: string) {
  return page.evaluate(
    ([sel, n]) => {
      const host = document.querySelector(sel) as HTMLElement;
      host.focus();
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const i = (node as Text).data.indexOf(n);
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(node, i);
          r.setEnd(node, i + n.length);
          const s = getSelection()!;
          s.removeAllRanges();
          s.addRange(r);
          return true;
        }
      }
      throw new Error(`text not found: ${n}`);
    },
    [selector, needle] as const,
  );
}

before(async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [join(here, "../../scripts/build.mjs"), "--e2e"], { stdio: "ignore" });

  api = buildServer({ ...loadConfig({ ANTHROPIC_API_KEY: "x", PROMPT_COMPILER_MODEL: "fake" }) }, provider, false);
  api.addHook("preHandler", async (req) => {
    if (req.url === "/api/refine") requestBodies.push(req.body as Record<string, unknown>);
  });
  await api.listen({ port: 0, host: "127.0.0.1" });
  apiUrl = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;

  fixtures = createServer((req, res) => {
    const file = req.url === "/editors" ? "editors.html" : "index.html";
    res.setHeader("content-type", "text/html; charset=utf-8");
    createReadStream(join(FIXTURES, file)).pipe(res);
  });
  await new Promise<void>((r) => fixtures.listen(0, "127.0.0.1", r));
  fixturesUrl = `http://localhost:${(fixtures.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  sw.on("console", (m) => m.type() === "error" && consoleErrors.push(`[sw] ${m.text()}`));
  await setEndpoint(apiUrl);

  page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[page] ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`[page] ${e.message}`));
  await page.goto(fixturesUrl);
});

after(async () => {
  await context?.close();
  await api?.close();
  fixtures?.close();
});

describe("extension smoke test", () => {
  it("loads as an MV3 extension, opens options on install and creates the menus", async () => {
    assert.match(sw.url(), /^chrome-extension:\/\/[a-p]{32}\/background\.js$/);
    const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
    assert.equal(manifest.manifest_version, 3);
    // contextMenus.update() fails for unknown ids → proves every item exists.
    const targets = ["auto", "chatgpt", "claude", "gemini", "codex", "claude-code"];
    const ids = [
      "prompt-refiner",
      "prompt-refiner-deep",
      ...targets.flatMap((t) => [`prompt-refiner:${t}`, `prompt-refiner-deep:${t}`]),
      "prompt-refiner-file",
      "prompt-refiner-file:claude-md",
      "prompt-refiner-file:agents-md",
    ];
    for (const id of ids) await sw.evaluate((i) => chrome.contextMenus.update(i, {}), id);
    await assert.rejects(sw.evaluate(() => chrome.contextMenus.update("prompt-refiner:bard", {})));
    await assert.rejects(sw.evaluate(() => chrome.contextMenus.update("prompt-refiner-file:readme", {})));
    assert.ok(
      context.pages().some((p) => p.url().endsWith("/options.html")),
      "options page opened on install",
    );
  });

  it("options page reports connection status", async () => {
    const options = context.pages().find((p) => p.url().endsWith("/options.html"))!;
    await options.reload();
    await options.click("#test");
    await options.waitForFunction(() => /Conectado/.test(document.getElementById("status")!.textContent!));
    await setEndpoint("http://127.0.0.1:9");
    await options.reload();
    await options.click("#test");
    await options.waitForFunction(() => /Não conectado/.test(document.getElementById("status")!.textContent!));
    await setEndpoint(apiUrl);
  });

  it("refines a partial textarea selection for Claude, keeping surrounding text, then undoes", async () => {
    const original = await page.inputValue("#textarea");
    const selected =
      "olha esse dashboard e ve o que ta ruim de ux principalmente hierarquia visual e fala como melhorar sem inventar coisa";
    await selectInField("textarea", selected);
    requestBodies.length = 0;
    await refine("claude");

    const value = await page.inputValue("#textarea");
    assert.equal(value, original.replace(selected, "REFINADO para Claude"));
    assert.match(await toastText(), /Prompt refinado para Claude.*Desfazer/);
    const caret = await page.evaluate(() => (document.getElementById("textarea") as HTMLTextAreaElement).selectionStart);
    assert.equal(caret, original.indexOf(selected) + "REFINADO para Claude".length);

    // Only the selection (+ language and settings) is sent; no hostname for explicit targets.
    assert.equal(requestBodies.length, 1);
    assert.deepEqual(Object.keys(requestBodies[0]).sort(), ["depth", "format", "language", "target", "text"]);
    assert.equal(requestBodies[0].depth, "balanced");
    assert.equal(requestBodies[0].format, "markdown", "Markdown is the default format");
    assert.equal(requestBodies[0].text, selected);

    await clickToastButton("Desfazer");
    await page.waitForFunction((o) => (document.getElementById("textarea") as HTMLTextAreaElement).value === o, original);
  });

  it("deep mode sends depth=deep and labels the toasts", async () => {
    const original = await page.inputValue("#textarea");
    await selectInField("textarea", "Contexto antes da seleção.");
    requestBodies.length = 0;
    await refine("claude", "deep");
    assert.equal(requestBodies[0].depth, "deep");
    assert.match(await toastText(), /Prompt refinado para Claude \(profundo\)/);
    await clickToastButton("Desfazer");
    await page.waitForFunction((o) => (document.getElementById("textarea") as HTMLTextAreaElement).value === o, original);
  });

  it("sends the format chosen in the options (auto)", async () => {
    const original = await page.inputValue("#textarea");
    await sw.evaluate(() => chrome.storage.sync.set({ format: "auto" }));
    try {
      await selectInField("textarea", "Contexto antes da seleção.");
      requestBodies.length = 0;
      await refine("claude");
      assert.equal(requestBodies[0].format, "auto");
      assert.match(await toastText(), /Prompt refinado para Claude/);
      await clickToastButton("Desfazer");
      await page.waitForFunction((o) => (document.getElementById("textarea") as HTMLTextAreaElement).value === o, original);
    } finally {
      await sw.evaluate(() => chrome.storage.sync.remove("format"));
    }
  });

  it("generates a CLAUDE.md / AGENTS.md from the selection (kind, implied target, no hostname/format), then undoes", async () => {
    const original = await page.inputValue("#textarea");
    const selected = "Contexto antes da seleção.";
    const file = "# Projeto\n\n## Comandos\n\n- `npm test`";
    mode = "file";
    try {
      for (const [kind, target, name] of [
        ["claude-md", "claude-code", "CLAUDE.md"],
        ["agents-md", "codex", "AGENTS.md"],
      ] as const) {
        await selectInField("textarea", selected);
        requestBodies.length = 0;
        // The target argument is ignored for files: it is implied by the kind.
        const running = refine("auto", "balanced", kind);
        await page.waitForFunction(
          (n) =>
            document
              .getElementById("prompt-refiner-toast-host")
              ?.shadowRoot?.querySelector(".toast")
              ?.textContent?.includes(`Gerando ${n}...`),
          name,
        );
        await running;
        assert.equal(requestBodies.length, 1);
        assert.deepEqual(Object.keys(requestBodies[0]).sort(), ["depth", "kind", "language", "target", "text"], kind);
        assert.equal(requestBodies[0].kind, kind);
        assert.equal(requestBodies[0].target, target);
        assert.equal(requestBodies[0].text, selected);
        assert.equal(await page.inputValue("#textarea"), original.replace(selected, file));
        assert.match(await toastText(), new RegExp(`^✓${name.replace(".", "\\.")} geradoDesfazer`));
        await clickToastButton("Desfazer");
        await page.waitForFunction((o) => (document.getElementById("textarea") as HTMLTextAreaElement).value === o, original);
      }
    } finally {
      mode = "ok";
    }
  });

  it("refines an <input> and a controlled (React-like) textarea", async () => {
    await selectInField("input", "traduz isso pro ingles: bom dia equipe.");
    await refine("chatgpt");
    assert.equal(await page.inputValue("#input"), "Antes. REFINADO para ChatGPT Depois.");

    await selectInField("react", "resume esse texto em 3 bullets");
    await refine("gemini");
    assert.equal(await page.textContent("#react-state"), "REFINADO para Gemini", "framework saw the input event");
  });

  it("refines a contenteditable paragraph in Automático mode without touching other paragraphs", async () => {
    await selectInEditable("#ce", "cria um endpoint de login");
    requestBodies.length = 0;
    await refine("auto");
    const paragraphs = await page.$$eval("#ce p", (ps) => ps.map((p) => p.textContent));
    assert.deepEqual(paragraphs, [
      "Primeiro parágrafo (não deve mudar).",
      "REFINADO para a modern general-purpose LLM no meu projeto express com jwt e testes, nao mexe no resto",
      "Último parágrafo (não deve mudar).",
    ]);
    assert.equal(requestBodies[0].hostname, "localhost", "auto mode sends the hostname");
    assert.match(await toastText(), /^✓Prompt refinadoDesfazer/);
    await clickToastButton("Desfazer");
    await page
      .waitForFunction(() => document.querySelectorAll("#ce p")[1].textContent!.startsWith("cria um endpoint"), null, {
        timeout: 3000,
      })
      .catch(async () => assert.fail(`undo failed: toast=${await toastText()} html=${await page.innerHTML("#ce")}`));
    assert.deepEqual(await page.$$eval("#ce p", (ps) => ps.length), 3);
  });

  it("refuses password fields and empty selections without calling the backend", async () => {
    const calls = compileCalls;
    await page.focus("#password");
    await page.evaluate(() => (document.getElementById("password") as HTMLInputElement).select());
    await refine("claude");
    assert.match(await toastText(), /campos de senha/);

    await page.evaluate(() => {
      const el = document.getElementById("textarea") as HTMLTextAreaElement;
      el.focus();
      el.setSelectionRange(3, 3);
    });
    await refine("claude");
    assert.match(await toastText(), /Selecione o prompt que deseja refinar\./);
    assert.equal(compileCalls, calls);
  });

  it("keeps the original text on backend errors", async () => {
    const original = await page.inputValue("#textarea");
    await selectInField("textarea", "Contexto antes");
    mode = "fail";
    await refine("claude");
    mode = "ok";
    assert.equal(await page.inputValue("#textarea"), original);
    assert.match(await toastText(), /Não foi possível refinar o prompt\./);

    await setEndpoint("http://127.0.0.1:9");
    await selectInField("textarea", "Contexto antes");
    await refine("claude");
    assert.equal(await page.inputValue("#textarea"), original);
    assert.match(await toastText(), /Backend indisponível/);
    await setEndpoint(apiUrl);
  });

  it("works with real rich editors (Tiptap/ProseMirror, Quill, Lexical)", async (t) => {
    await page.goto(`${fixturesUrl}/editors`);
    const ready = await page
      .waitForFunction(() => (window as unknown as { editorsReady?: boolean }).editorsReady, null, { timeout: 15000 })
      .catch(() => null);
    if (!ready) return t.skip("CDN editors unavailable (offline?)");
    mode = "multiline";
    const needle = "olha esse dashboard e ve o que ta ruim de ux.";
    const expected = [
      "Primeiro parágrafo.",
      "Antes. Analise a hierarquia visual do dashboard.",
      "",
      "Liste os problemas encontrados e proponha melhorias. Depois.",
      "Último parágrafo.",
    ];
    const results: Record<string, string> = {};

    for (const [name, selector, read] of [
      ["tiptap", "#tiptap .ProseMirror", "tiptap"],
      ["quill", "#quill .ql-editor", "quill"],
      ["lexical", "#lexical", "lexical"],
    ] as const) {
      await selectInEditable(selector, needle);
      await refine("claude");
      assert.match(await toastText(), /Prompt refinado para Claude/, name);
      results[name] = await page.evaluate((which) => {
        const w = window as unknown as Record<string, any>;
        if (which === "tiptap") return w.tiptap.getText({ blockSeparator: "\n" });
        if (which === "quill") return w.quill.getText().replace(/\n$/, "");
        return w.lexical.getEditorState().read(() => (document.getElementById("lexical") as HTMLElement).innerText);
      }, read);
      // Each editor's own model must contain the new text, with surrounding text intact.
      const lines = results[name].split("\n").filter(Boolean);
      assert.deepEqual(lines, expected.filter(Boolean), `${name}: ${JSON.stringify(results[name])}`);

      await clickToastButton("Desfazer");
      await page.waitForTimeout(300);
      const restored = await page.evaluate((s) => (document.querySelector(s) as HTMLElement).innerText, selector);
      assert.ok(restored.includes(`Antes. ${needle} Depois.`), `${name} undo: ${JSON.stringify(restored)}`);
    }
    mode = "ok";
  });

  it("produced no console errors in the page or the service worker", () => {
    assert.deepEqual(consoleErrors, []);
  });
});
