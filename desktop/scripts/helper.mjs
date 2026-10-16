// Builds and installs the "Prompt Refiner" menu bar helper (double tap ⌥ → refine selection).
//   node scripts/helper.mjs build      → dist/Prompt Refiner.app
//   node scripts/helper.mjs install    → ~/Applications + starts at login (LaunchAgent)
//   node scripts/helper.mjs uninstall
//   node scripts/helper.mjs test       → unit tests of the pure Swift logic (helper/*.swift)
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng } from "../../extension/scripts/icons.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const HELPER = join(here, "../helper");
const DIST = join(here, "../dist");
const APP_NAME = "Prompt Refiner.app";
const BUILT_APP = join(DIST, APP_NAME);
const INSTALLED_APP = join(homedir(), "Applications", APP_NAME);
const BUNDLE_ID = "com.promptrefiner.hotkey";
const EXECUTABLE = "PromptRefinerHotkey";
const AGENT = join(homedir(), "Library/LaunchAgents", `${BUNDLE_ID}.plist`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const swiftFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".swift"))
    .sort()
    .map((f) => join(dir, f));
/** Pure logic (Foundation only), shared by the app and the unit tests. */
const CORE = () => swiftFiles(HELPER);

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleExecutable</key><string>${EXECUTABLE}</string>
	<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
	<key>CFBundleName</key><string>Prompt Refiner</string>
	<key>CFBundleDisplayName</key><string>Prompt Refiner</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>0.1.0</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>CFBundleIconFile</key><string>AppIcon</string>
	<key>LSMinimumSystemVersion</key><string>13.0</string>
	<key>LSUIElement</key><true/>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;

/** Builds and signs in a temp folder (synced folders like ~/Desktop add attributes codesign rejects). */
function build() {
  const staged = join(mkdtempSync(join(tmpdir(), "pr-helper-")), APP_NAME);
  const macos = join(staged, "Contents/MacOS");
  const resources = join(staged, "Contents/Resources");
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(staged, "Contents/Info.plist"), infoPlist);

  // App icon from the same generator as the extension icons.
  const iconset = join(mkdtempSync(join(tmpdir(), "pr-icon-")), "AppIcon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), iconPng(size));
    writeFileSync(join(iconset, `icon_${size}x${size}@2x.png`), iconPng(size * 2));
  }
  run("/usr/bin/iconutil", ["-c", "icns", iconset, "-o", join(resources, "AppIcon.icns")]);

  run("/usr/bin/swiftc", [
    "-O",
    "-o",
    join(macos, EXECUTABLE),
    ...CORE(),
    ...swiftFiles(join(HELPER, "App")),
    "-framework",
    "AppKit",
  ]);
  // Ad-hoc signature: required for macOS to remember the Accessibility permission.
  run("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", BUNDLE_ID, staged]);
  rmSync(BUILT_APP, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(staged, BUILT_APP, { recursive: true });
  console.log(`✔ ${BUILT_APP}`);
  return staged;
}

function stopAgent() {
  try {
    execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, AGENT], { stdio: "ignore" });
  } catch {
    // not loaded
  }
}

function install() {
  if (process.platform !== "darwin") throw new Error("Somente macOS.");
  const staged = build();
  stopAgent();
  rmSync(INSTALLED_APP, { recursive: true, force: true });
  mkdirSync(dirname(INSTALLED_APP), { recursive: true });
  run("/usr/bin/ditto", [staged, INSTALLED_APP]);
  run("/usr/bin/codesign", ["--verify", "--strict", INSTALLED_APP]);

  mkdirSync(dirname(AGENT), { recursive: true });
  writeFileSync(
    AGENT,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>${BUNDLE_ID}</string>
	<key>ProgramArguments</key><array><string>${join(INSTALLED_APP, "Contents/MacOS", EXECUTABLE)}</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
	<key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`,
  );
  run("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, AGENT]);
  console.log(`✔ Instalado em ${INSTALLED_APP} (abre automaticamente ao iniciar o Mac).`);
  // Ad-hoc signature: every rebuild changes it, and macOS silently stops trusting the old grant.
  console.log("→ Permita o Prompt Refiner em Ajustes do Sistema › Privacidade e Segurança › Acessibilidade.");
  console.log(
    "  Após reinstalar, desligar e religar não basta: remova-o da lista (−) e adicione de novo ~/Applications/Prompt Refiner.app.",
  );
}

function uninstall() {
  stopAgent();
  rmSync(AGENT, { force: true });
  rmSync(INSTALLED_APP, { recursive: true, force: true });
  console.log("Prompt Refiner (atalho ⌥⌥) removido. Revogue a permissão em Acessibilidade se quiser.");
}

function test() {
  const out = join(mkdtempSync(join(tmpdir(), "pr-tap-")), "tests");
  run("/usr/bin/swiftc", ["-o", out, ...CORE(), join(HELPER, "Tests/main.swift")], { stdio: ["ignore", "ignore", "inherit"] });
  // Paths of the TypeScript sources the Swift code must stay in sync with.
  run(out, [join(here, "../src/apps.ts"), join(here, "../../shared/api.ts"), join(here, "../src/messages.ts")]);
}

const actions = { build, install, uninstall, test };
const action = actions[process.argv[2]];
if (!action) {
  console.error("Uso: node scripts/helper.mjs build|install|uninstall|test");
  process.exit(1);
}
if (!existsSync(HELPER)) throw new Error(`${HELPER} não encontrado`);
action();
