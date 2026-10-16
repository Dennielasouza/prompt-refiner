// Builds the unpacked extension into extension/dist.
//   node scripts/build.mjs           production build
//   node scripts/build.mjs --watch   rebuild on change
//   node scripts/build.mjs --e2e     test build (dist-e2e): adds localhost host permissions for the smoke test

import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { iconPng } from "./icons.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");
const e2e = process.argv.includes("--e2e");
const out = join(root, e2e ? "dist-e2e" : "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

cpSync(join(root, "static"), out, { recursive: true, filter: (src) => !src.endsWith("manifest.json") });
const manifest = JSON.parse(readFileSync(join(root, "static/manifest.json"), "utf8"));
if (e2e) {
  // Playwright cannot click native context menus, so activeTab is never granted in tests.
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*"];
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
for (const size of [16, 32, 48, 128]) writeFileSync(join(out, `icons/${size}.png`), iconPng(size));

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: watch || e2e ? "inline" : false,
  minifySyntax: true, // drops `if (__E2E__)` blocks; keeps names readable
  legalComments: "none",
  logLevel: "info",
  // __BUILD_ID__ lets a freshly injected content script tell its own registration apart from
  // one left in the page by a previous build (see src/registration.ts).
  define: { __E2E__: JSON.stringify(e2e), __BUILD_ID__: JSON.stringify(`${manifest.version}-${randomUUID()}`) },
};
const builds = [
  { entryPoints: [join(root, "src/background.ts")], outfile: join(out, "background.js"), format: "esm" },
  // Injected via chrome.scripting.executeScript({ files }) → must be a classic script.
  { entryPoints: [join(root, "src/content.ts")], outfile: join(out, "content.js"), format: "iife" },
  { entryPoints: [join(root, "src/options.ts")], outfile: join(out, "options.js"), format: "iife" },
];

if (watch) {
  for (const b of builds) await (await esbuild.context({ ...common, ...b })).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b })));
  console.log(`Extension built at ${out}`);
}
