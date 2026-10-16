/**
 * End-to-end resilience tests: extension reloads with tabs already open, stale content-script
 * registrations, and pages the extension cannot script. Same setup as smoke.e2e.ts (dist-e2e,
 * real backend with a fake provider), but in its own browser because it reloads the extension.
 */
import assert from "node:assert/strict";
import { createReadStream, readFileSync, writeFileSync } from "node:fs";
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
const REGISTRATION_KEY = "__promptRefinerRegistration";
const SELECTED =
  "olha esse dashboard e ve o que ta ruim de ux principalmente hierarquia visual e fala como melhorar sem inventar coisa";

let compileCalls = 0;
let hold: Promise<void> | null = null; // when set, the fake provider waits for it

const provider: CompilerProvider = {
  name: "anthropic",
  async compile(req) {
    compileCalls++;
    if (hold) await hold;
    const target = /sent to: ([^.(]+)/.exec(req.destinationInstruction)?.[1].trim() ?? "?";
    return {
      intent: "x",
      taskType: "ux",
      complexity: 2,
      strategies: ["objective"],
      refinedPrompt: `REFINADO para ${target}`,
      warnings: [],
    };
  },
};

let api: ReturnType<typeof buildServer>;
let apiUrl: string;
let fixtures: Server;
let fixturesUrl: string;
let context: BrowserContext;
let sw: Worker;
let page: Page;
let original: string;
const consoleErrors: string[] = [];

function watchWorker(w: Worker) {
  w.on("console", (m) => m.type() === "error" && consoleErrors.push(`[sw] ${m.text()}`));
}

async function tabIdOf(url: string): Promise<number> {
  return sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id!, url);
}

function refineIn(tabId: number, frameId: number, target = "claude") {
  return sw.evaluate(
    ([t, f, tgt]) =>
      (
        globalThis as unknown as { __promptRefinerTest: { runRefinement: (a: number, b: number, c: string) => Promise<void> } }
      ).__promptRefinerTest.runRefinement(t as number, f as number, tgt as string),
    [tabId, frameId, target] as const,
  );
}

async function refine(target = "claude") {
  await refineIn(await tabIdOf(`${fixturesUrl}/*`), 0, target);
}

async function badge(tabId: number) {
  return sw.evaluate(
    async (t) => ({ text: await chrome.action.getBadgeText({ tabId: t }), title: await chrome.action.getTitle({ tabId: t }) }),
    tabId,
  );
}

async function toastText(): Promise<string> {
  return page.evaluate(
    () => document.getElementById("prompt-refiner-toast-host")?.shadowRoot?.querySelector(".toast")?.textContent ?? "",
  );
}

async function selectInTextarea() {
  await page.evaluate((n) => {
    const el = document.getElementById("textarea") as HTMLTextAreaElement;
    el.focus();
    const start = el.value.indexOf(n);
    el.setSelectionRange(start, start + n.length);
  }, SELECTED);
}

async function resetTextarea() {
  await page.evaluate((v) => {
    (document.getElementById("textarea") as HTMLTextAreaElement).value = v;
  }, original);
}

/** Refines the textarea selection in the already-open fixture tab and checks the result. */
async function refineAndCheck(label: string) {
  await resetTextarea();
  await selectInTextarea();
  const calls = compileCalls;
  await refine("claude");
  assert.equal(compileCalls, calls + 1, `${label}: backend called`);
  assert.equal(await page.inputValue("#textarea"), original.replace(SELECTED, "REFINADO para Claude"), label);
  assert.match(await toastText(), /Prompt refinado para Claude/, label);
}

/** Same as clicking "Recarregar" in chrome://extensions; resolves with the new service worker. */
async function reloadExtension(): Promise<void> {
  const old = sw;
  await old.evaluate(() => chrome.runtime.reload()).catch(() => {}); // the worker dies mid-call
  await waitForNewWorker(old);
}

async function waitForNewWorker(old: Worker): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const next = context.serviceWorkers().find((w) => w !== old && w.url().endsWith("/background.js"));
    if (next) {
      sw = next;
      break;
    }
    if (Date.now() > deadline) throw new Error("new service worker did not start after reload");
    await new Promise((r) => setTimeout(r, 100));
  }
  watchWorker(sw);
  await sw.evaluate(() => (globalThis as { __promptRefinerTest?: unknown }).__promptRefinerTest !== undefined);
}

before(async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [join(here, "../../scripts/build.mjs"), "--e2e"], { stdio: "ignore" });

  api = buildServer({ ...loadConfig({ ANTHROPIC_API_KEY: "x", PROMPT_COMPILER_MODEL: "fake" }) }, provider, false);
  await api.listen({ port: 0, host: "127.0.0.1" });
  apiUrl = `http://127.0.0.1:${(api.server.address() as AddressInfo).port}`;

  fixtures = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    createReadStream(join(FIXTURES, "index.html")).pipe(res);
  });
  await new Promise<void>((r) => fixtures.listen(0, "127.0.0.1", r));
  fixturesUrl = `http://localhost:${(fixtures.address() as AddressInfo).port}`;

  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
  sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  watchWorker(sw);
  await sw.evaluate((e) => chrome.storage.sync.set({ endpoint: e }), apiUrl);

  // Unpacked extensions are only re-enabled after a reload in developer mode, as for the user.
  const manager = await context.newPage();
  await manager.goto("chrome://extensions");
  await manager.evaluate(
    () =>
      new Promise<void>((resolve) =>
        (
          chrome as unknown as { developerPrivate: { updateProfileConfiguration: (c: object, cb: () => void) => void } }
        ).developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve),
      ),
  );
  await manager.close();

  page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[page] ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`[page] ${e.message}`));
  await page.goto(fixturesUrl);
  original = await page.inputValue("#textarea");
});

after(async () => {
  await context?.close();
  await api?.close();
  fixtures?.close();
});

describe("extension resilience", () => {
  it("keeps working in an already-open tab after the extension is reloaded", async () => {
    await refineAndCheck("before reload");
    await reloadExtension();
    // Same tab, page NOT reloaded: the old content script is orphaned, the new one must take over.
    await refineAndCheck("after 1st reload");
    await reloadExtension();
    await refineAndCheck("after 2nd reload");
  });

  it("injecting twice in the same live context handles each message once", async () => {
    const tabId = await tabIdOf(`${fixturesUrl}/*`);
    await sw.evaluate((t) => chrome.scripting.executeScript({ target: { tabId: t }, files: ["content.js"] }), tabId);
    await sw.evaluate((t) => chrome.scripting.executeScript({ target: { tabId: t }, files: ["content.js"] }), tabId);
    const calls = compileCalls;
    await refineAndCheck("after double injection");
    assert.equal(compileCalls, calls + 1);
    // A second listener would apply the result twice (or fail with "selection changed").
    assert.equal((await page.inputValue("#textarea")).split("REFINADO").length - 1, 1);
  });

  it("self-heals when a stale registration would make the new script skip its listener", async () => {
    const tabId = await tabIdOf(`${fixturesUrl}/*`);
    // In the extension's isolated world: remove the live listener but leave a registration that
    // claims to be alive (what a stale guard flag looks like). Injection alone can't recover.
    const planted = await sw.evaluate(
      async ([t, key]) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: t as number },
            args: [key as string],
            // Array-wrapped so tsx's keepNames doesn't add __name() calls, which don't exist in the page.
            func: [
              (k: string) => {
                const slot = window as unknown as Record<string, { build: string; dispose: () => void }>;
                const live = slot[k];
                live.dispose();
                slot[k] = { build: live.build, alive: Boolean.bind(null, true), dispose: Object } as never;
                return live.build;
              },
            ][0],
          })
        )[0].result,
      [tabId, REGISTRATION_KEY] as const,
    );
    assert.ok(planted, "content script registration exists");
    await refineAndCheck("after stale registration");
    const b = await badge(tabId);
    assert.equal(b.text, "", "no failure badge after self-heal");
  });

  it("does not spin forever when the extension is reloaded mid-refinement", async () => {
    await resetTextarea();
    await selectInTextarea();
    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const tabId = await tabIdOf(`${fixturesUrl}/*`);
    const running = refineIn(tabId, 0).catch(() => {}); // its worker dies on reload
    try {
      await page.waitForFunction(() =>
        /Refinando/.test(document.getElementById("prompt-refiner-toast-host")?.shadowRoot?.textContent ?? ""),
      );
      await reloadExtension();
      await page.waitForFunction(
        () =>
          /foi atualizado ou recarregado/.test(
            document.getElementById("prompt-refiner-toast-host")?.shadowRoot?.textContent ?? "",
          ),
        null,
        { timeout: 5000 },
      );
      assert.match(await toastText(), /O refinamento foi interrompido/);
      assert.equal(await page.inputValue("#textarea"), original, "text untouched");
    } finally {
      hold = null;
      release();
      await running;
    }
    await refineAndCheck("after interrupted refinement");
  });

  it("flags the extension icon when the page can't be scripted, and clears it on the next success", async () => {
    const tabId = await tabIdOf(`${fixturesUrl}/*`);

    // A frame that is gone by the time the menu click is handled.
    await refineIn(tabId, 987654);
    let b = await badge(tabId);
    assert.equal(b.text, "!");
    assert.match(b.title, /^Prompt Refiner — não funciona nesta página: a página mudou ou foi fechada/);

    // Internal pages (chrome://) can never be scripted.
    const allTabs = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!));
    const before = await allTabs();
    const internal = await context.newPage();
    await internal.goto("chrome://version");
    const internalTab = (await allTabs()).find((id) => !before.includes(id))!;
    await refineIn(internalTab, 0);
    const ib = await badge(internalTab);
    assert.equal(ib.text, "!");
    assert.match(ib.title, /páginas internas do navegador/);
    await internal.close();

    // Success in the first tab clears its badge and restores the default tooltip.
    await refineAndCheck("after failures");
    b = await badge(tabId);
    assert.equal(b.text, "");
    assert.equal(b.title, "Prompt Refiner — configurações");
  });

  it("shows the backend error toast after a reload when the backend is down", async () => {
    await sw.evaluate(() => chrome.storage.sync.set({ endpoint: "http://127.0.0.1:9" }));
    await resetTextarea();
    await selectInTextarea();
    await refine("claude");
    assert.match(await toastText(), /Não foi possível refinar o prompt\.Backend indisponível/);
    assert.equal(await page.inputValue("#textarea"), original);
    await sw.evaluate((e) => chrome.storage.sync.set({ endpoint: e }), apiUrl);
  });

  it("tells a frame when a newer refinement in the same tab replaces its own", async () => {
    await resetTextarea();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const f = document.createElement("iframe");
          f.id = "pr-frame";
          f.src = "/?frame";
          f.onload = () => resolve();
          document.body.append(f);
        }),
    );
    const frame = page.frames().find((f) => f.url().endsWith("?frame"))!;
    const frameText = () => frame.evaluate(() => (document.getElementById("textarea") as HTMLTextAreaElement).value);
    const frameOriginal = await frameText();
    await frame.evaluate((n) => {
      const el = document.getElementById("textarea") as HTMLTextAreaElement;
      el.focus();
      const start = el.value.indexOf(n);
      el.setSelectionRange(start, start + n.length);
    }, SELECTED);
    const tabId = await tabIdOf(`${fixturesUrl}/*`);
    const frameId = await sw.evaluate(
      async (t) =>
        (await chrome.scripting.executeScript({ target: { tabId: t, allFrames: true }, func: [() => location.search][0] })).find(
          (r) => r.result === "?frame",
        )!.frameId,
      tabId,
    );

    let release!: () => void;
    hold = new Promise<void>((r) => (release = r));
    const calls = compileCalls;
    const first = refineIn(tabId, frameId);
    try {
      while (compileCalls === calls) await new Promise((r) => setTimeout(r, 50)); // first request is at the backend
      hold = null;
      await refineAndCheck("main frame supersedes the iframe"); // frame 0, same tab
      await first;
      const toast = await frame.evaluate(
        () => document.getElementById("prompt-refiner-toast-host")?.shadowRoot?.querySelector(".toast")?.textContent ?? "",
      );
      assert.match(toast, /Um novo refinamento foi iniciado nesta aba/);
      assert.equal(await frameText(), frameOriginal, "iframe text untouched");
    } finally {
      hold = null;
      release();
      await first.catch(() => {});
      await page.evaluate(() => document.getElementById("pr-frame")?.remove());
    }
  });

  it("the keyboard shortcut refines the selection inside an iframe (not the top frame)", async () => {
    await resetTextarea();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const f = document.createElement("iframe");
          f.id = "pr-frame";
          f.src = "/?frame";
          f.onload = () => resolve();
          document.body.append(f);
        }),
    );
    const frame = page.frames().find((f) => f.url().endsWith("?frame"))!;
    const frameText = () => frame.evaluate(() => (document.getElementById("textarea") as HTMLTextAreaElement).value);
    const frameOriginal = await frameText();
    try {
      await frame.evaluate((n) => {
        const el = document.getElementById("textarea") as HTMLTextAreaElement;
        el.focus();
        const start = el.value.indexOf(n);
        el.setSelectionRange(start, start + n.length);
      }, SELECTED);
      const tabId = await tabIdOf(`${fixturesUrl}/*`);
      await sw.evaluate(
        (t) =>
          (
            globalThis as unknown as { __promptRefinerTest: { runShortcut: (t: number) => Promise<void> } }
          ).__promptRefinerTest.runShortcut(t),
        tabId,
      );
      assert.notEqual(await frameText(), frameOriginal, "iframe selection was refined");
      assert.ok(!(await frameText()).includes(SELECTED));
      assert.equal(await page.inputValue("#textarea"), original, "top frame untouched");
    } finally {
      await page.evaluate(() => document.getElementById("pr-frame")?.remove());
    }
  });

  it("accepts capture/apply from an older background that does not send `kind`", async () => {
    // What a worker from the previous build sends after dist was rebuilt but not reloaded.
    await resetTextarea();
    await selectInTextarea();
    const tabId = await tabIdOf(`${fixturesUrl}/*`);
    const captured = await sw.evaluate(async (t) => {
      await chrome.scripting.executeScript({ target: { tabId: t }, files: ["content.js"] });
      return chrome.tabs.sendMessage(t, { type: "pr:capture", opId: "old-1", target: "claude", depth: "balanced" });
    }, tabId);
    assert.equal((captured as { ok: boolean }).ok, true, "old capture message answered");
    await sw.evaluate(
      (t) =>
        chrome.tabs.sendMessage(t, {
          type: "pr:apply",
          opId: "old-1",
          refinedPrompt: "REFINADO para Claude",
          target: "claude",
          depth: "balanced",
        }),
      tabId,
    );
    assert.equal(await page.inputValue("#textarea"), original.replace(SELECTED, "REFINADO para Claude"));
    assert.match(await toastText(), /Prompt refinado para Claude/);
  });

  it("reloads itself when the extension was rebuilt on disk but not reloaded", async () => {
    // Simulate `npm run build` while Chrome keeps running: new build id in the files on disk,
    // while the running worker keeps the old one (Chrome does not reload unpacked workers).
    const files = ["background.js", "content.js"].map((f) => join(EXT_DIR, f));
    const running = /"0\.1\.0-[0-9a-f-]{36}"/.exec(readFileSync(files[1], "utf8"))![0];
    const next = `"0.1.0-${crypto.randomUUID()}"`;
    for (const f of files) writeFileSync(f, readFileSync(f, "utf8").replaceAll(running, next));

    const old = sw;
    await refineAndCheck("with a stale worker"); // still works with the old worker
    await waitForNewWorker(old); // …which then reloads the extension by itself
    await refineAndCheck("after the automatic reload");
    // Worker and files now match: no further reload (the worker is still alive after the delay).
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await sw.evaluate(() => 1 + 1), 2, "no reload loop");
  });

  it("produced no console errors in the page or the service worker", () => {
    assert.deepEqual(consoleErrors, []);
  });
});
