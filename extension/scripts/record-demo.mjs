/**
 * Records the README demo GIF with the REAL extension and a REAL backend.
 *
 *   node scripts/build.mjs --e2e
 *   # start a backend that accepts any unpacked extension id, on a spare port:
 *   (cd ../backend && PORT=8788 ALLOWED_ORIGINS='chrome-extension://*' npx tsx src/index.ts &)
 *   node scripts/record-demo.mjs            # writes ../docs/demo.gif
 *
 * Nothing here is staged: the text is typed into a real page, the real content script
 * captures the selection and the real backend refines it. Context menus cannot be clicked
 * by automation, so the refinement is triggered through the same entry point the menu uses
 * (exposed only in the --e2e build) — what you see replaced on screen is the genuine result.
 *
 * Requires ffmpeg on PATH.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const EXT_DIR = join(root, "dist-e2e");
const FIXTURES = join(root, "test/fixtures");
const OUT_DIR = join(root, "../docs");
const TMP = join(root, ".demo-tmp");

const ENDPOINT = process.env.DEMO_ENDPOINT ?? "http://127.0.0.1:8788";
const TARGET = process.env.DEMO_TARGET ?? "chatgpt";
const MESSY =
  process.env.DEMO_TEXT ?? "preciso escrever um email pro meu chefe pedindo pra trabalhar remoto na sexta, sem parecer folgado";

const VIEWPORT = { width: 1000, height: 620 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(EXT_DIR)) throw new Error(`build first: node scripts/build.mjs --e2e (missing ${EXT_DIR})`);
const health = await fetch(`${ENDPOINT}/api/health`).then(
  (r) => r.json(),
  () => null,
);
if (!health) throw new Error(`no backend on ${ENDPOINT} — see the header of this file`);
console.log(`backend: ${health.provider} · engine ${health.compilerVersion}`);

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// Serve the demo page over http:// so the extension treats it like any other site.
const fixtures = createServer((req, res) => {
  const file = join(FIXTURES, (req.url ?? "/").split("?")[0] === "/" ? "demo.html" : (req.url ?? "").slice(1));
  if (!file.startsWith(FIXTURES) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  createReadStream(file).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => fixtures.once("listening", r));
const pageUrl = `http://127.0.0.1:${fixtures.address().port}/`;

const context = await chromium.launchPersistentContext(join(TMP, "profile"), {
  headless: false,
  viewport: VIEWPORT,
  recordVideo: { dir: join(TMP, "video"), size: VIEWPORT },
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, "--hide-scrollbars"],
});
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await sw.evaluate(([endpoint, target]) => chrome.storage.sync.set({ endpoint, defaultTarget: target }), [ENDPOINT, TARGET]);

const page = await context.newPage();
await page.goto(pageUrl);
await page.waitForTimeout(900);

// 1. Type the messy prompt the way a person would.
await page.click("#composer");
await page.type("#composer", MESSY, { delay: 45 });
await wait(900);

// 2. Select everything — exactly what the person does before the right-click.
await page.evaluate(() => {
  const el = document.getElementById("composer");
  el.focus();
  el.setSelectionRange(0, el.value.length);
});
await wait(1100);

// 3. Refine (same entry point the context menu calls).
const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0].id, pageUrl);
await sw.evaluate(([id, target]) => globalThis.__promptRefinerTest.runRefinement(id, 0, target, "balanced"), [tabId, TARGET]);

// 4. Let the result and the "Desfazer" toast breathe.
await page.waitForFunction(() => document.getElementById("composer").value.length > 160, null, { timeout: 60_000 });
await page.evaluate(() => {
  const el = document.getElementById("composer");
  el.setSelectionRange(0, 0);
  el.scrollTop = 0;
});
await wait(3400);

const refined = await page.evaluate(() => document.getElementById("composer").value);
console.log(`\nprompt refinado (${refined.length} chars):\n${refined}\n`);

await context.close();
fixtures.close();

// 5. webm → gif, two-pass palette so the text stays readable.
const webm = join(
  TMP,
  "video",
  readdirSync(join(TMP, "video")).find((f) => f.endsWith(".webm")),
);
const palette = join(TMP, "palette.png");
const gif = join(OUT_DIR, "demo.gif");
const filters = "fps=11,scale=900:-1:flags=lanczos";
execFileSync("ffmpeg", ["-y", "-i", webm, "-vf", `${filters},palettegen=stats_mode=diff`, palette], { stdio: "ignore" });
execFileSync(
  "ffmpeg",
  ["-y", "-i", webm, "-i", palette, "-lavfi", `${filters} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3`, gif],
  { stdio: "ignore" },
);
rmSync(TMP, { recursive: true, force: true });

const mb = (execFileSync("stat", ["-f%z", gif]).toString().trim() / 1024 / 1024).toFixed(2);
console.log(`✓ ${gif} (${mb} MB)`);
