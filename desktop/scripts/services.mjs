// Installs/uninstalls the "Refinar prompt" and "Gerar CLAUDE.md/AGENTS.md" macOS Services (Quick Actions)
// in ~/Library/Services.
//   node scripts/services.mjs install     (run `npm run build -w desktop` first)
//   node scripts/services.mjs uninstall
// Each Service receives the selected text, runs dist/refine.mjs and replaces the selection with its output.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "../dist/refine.mjs");
const SERVICES_DIR = join(homedir(), "Library/Services");
const PBS = "/System/Library/CoreServices/pbs";

/** Menu order is alphabetical; "(" sorts first so Automático leads. */
const TARGETS = [
  ["chatgpt", "ChatGPT"],
  ["claude", "Claude"],
  ["gemini", "Gemini"],
  ["codex", "Codex"],
  ["claude-code", "Claude Code"],
];
export const SERVICES = [
  { target: "auto", depth: "balanced", name: "Refinar prompt (Automático)", shortcut: "@^~r" }, // ⌃⌥⌘R
  ...TARGETS.map(([target, label]) => ({ target, depth: "balanced", name: `Refinar prompt para ${label}` })),
  { target: "auto", depth: "deep", name: "Refinar prompt profundo (Automático)", shortcut: "@^~p" }, // ⌃⌥⌘P
  ...TARGETS.map(([target, label]) => ({ target, depth: "deep", name: `Refinar prompt profundo para ${label}` })),
  // Agent instruction files from notes about a project (target implied by the kind; no shortcuts).
  { kind: "claude-md", depth: "balanced", name: "Gerar CLAUDE.md" },
  { kind: "agents-md", depth: "balanced", name: "Gerar AGENTS.md" },
];

const cliArgs = (s) => (s.kind ? `--kind ${s.kind}` : `--target ${s.target} --depth ${s.depth}`);

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sh = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

function infoPlist(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict><key>default</key><string>${xml(name)}</string></dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSSendTypes</key>
			<array><string>public.utf8-plain-text</string></array>
			<key>NSReturnTypes</key>
			<array><string>public.utf8-plain-text</string></array>
			<key>NSTimeout</key>
			<string>60000</string>
			<key>NSIconName</key>
			<string>NSActionTemplate</string>
		</dict>
	</array>
</dict>
</plist>
`;
}

function documentWflow(command) {
  const uuid = () => crypto.randomUUID().toUpperCase();
  const arg = (i, name, value) =>
    `<key>${i}</key><dict><key>default value</key>${value}<key>name</key><string>${name}</string><key>required</key><string>0</string><key>type</key><string>0</string><key>uuid</key><string>${i}</string></dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key><string>534</string>
	<key>AMApplicationVersion</key><string>2.10</string>
	<key>AMDocumentVersion</key><string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict><key>Container</key><string>List</string><key>Optional</key><true/><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
				<key>AMActionVersion</key><string>2.0.3</string>
				<key>AMApplication</key><array><string>Automator</string></array>
				<key>AMParameterProperties</key>
				<dict><key>COMMAND_STRING</key><dict/><key>CheckedForUserDefaultShell</key><dict/><key>inputMethod</key><dict/><key>shell</key><dict/><key>source</key><dict/></dict>
				<key>AMProvides</key>
				<dict><key>Container</key><string>List</string><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict>
				<key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key><string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key><string>${xml(command)}</string>
					<key>CheckedForUserDefaultShell</key><true/>
					<key>inputMethod</key><integer>0</integer>
					<key>shell</key><string>/bin/zsh</string>
					<key>source</key><string></string>
				</dict>
				<key>BundleIdentifier</key><string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key><string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key><false/>
				<key>CanShowWhenRun</key><true/>
				<key>Category</key><array><string>AMCategoryUtilities</string></array>
				<key>Class Name</key><string>RunShellScriptAction</string>
				<key>InputUUID</key><string>${uuid()}</string>
				<key>Keywords</key><array><string>Shell</string><string>Script</string></array>
				<key>OutputUUID</key><string>${uuid()}</string>
				<key>UUID</key><string>${uuid()}</string>
				<key>UnlocalizedApplications</key><array><string>Automator</string></array>
				<key>arguments</key>
				<dict>${arg(0, "inputMethod", "<integer>0</integer>")}${arg(1, "CheckedForUserDefaultShell", "<false/>")}${arg(2, "source", "<string></string>")}${arg(3, "COMMAND_STRING", "<string></string>")}${arg(4, "shell", "<string>/bin/sh</string>")}</dict>
				<key>conversionLabel</key><integer>0</integer>
				<key>isViewVisible</key><integer>1</integer>
				<key>location</key><string>309.000000:305.000000</string>
				<key>nibPath</key><string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
			<key>isViewVisible</key><integer>1</integer>
		</dict>
	</array>
	<key>connectors</key><dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleIDsByPath</key><dict/>
		<key>applicationPaths</key><array/>
		<key>inputTypeIdentifier</key><string>com.apple.Automator.text</string>
		<key>outputTypeIdentifier</key><string>com.apple.Automator.text</string>
		<key>presentationMode</key><integer>11</integer>
		<key>processesInput</key><false/>
		<key>serviceInputTypeIdentifier</key><string>com.apple.Automator.text</string>
		<key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.text</string>
		<key>serviceProcessesInput</key><false/>
		<key>systemImageName</key><string>NSActionTemplate</string>
		<key>useAutomaticInputType</key><false/>
		<key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;
}

const bundlePath = (name) => join(SERVICES_DIR, `${name}.workflow`);
const statusKey = (name) => `(null) - ${name} - runWorkflowAsService`;

function install() {
  if (process.platform !== "darwin") throw new Error("Os Serviços só existem no macOS.");
  if (!existsSync(CLI)) throw new Error(`${CLI} não existe. Rode "npm run build -w desktop" antes.`);
  // Services run with a minimal PATH: pin the node binary used to install.
  const command = `${sh(process.execPath)} ${sh(CLI)}`;
  for (const s of SERVICES) {
    const contents = join(bundlePath(s.name), "Contents");
    mkdirSync(contents, { recursive: true });
    writeFileSync(join(contents, "Info.plist"), infoPlist(s.name));
    writeFileSync(join(contents, "document.wflow"), documentWflow(`${command} ${cliArgs(s)}`));
    execFileSync("/usr/bin/plutil", ["-lint", "-s", join(contents, "Info.plist"), join(contents, "document.wflow")]);
    console.log(`✔ ${s.name}`);
  }
  setShortcuts();
  execFileSync(PBS, ["-update"]);
  console.log(`\nServiços instalados em ${SERVICES_DIR}. Atalhos: ⌃⌥⌘R = equilibrado, ⌃⌥⌘P = profundo (Automático).`);
}

/**
 * Edits the user's Services preferences (the "pbs" domain that System Settings › Keyboard ›
 * Shortcuts › Services writes) touching only our own keys. Converting through JSON keeps
 * non-ASCII names (e.g. "Automático") intact, which `defaults -dict-add` does not.
 */
function editServicesPrefs(edit) {
  let prefs = {};
  try {
    const json = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], {
      input: execFileSync("/usr/bin/defaults", ["export", "pbs", "-"]),
    });
    prefs = JSON.parse(json.toString("utf8"));
  } catch {
    // no prefs yet (or not JSON-convertible: leave untouched)
    try {
      execFileSync("/usr/bin/defaults", ["export", "pbs", "-"], { stdio: "ignore" });
      console.warn("Não foi possível editar as preferências de Serviços; configure o atalho manualmente.");
      return;
    } catch {}
  }
  prefs.NSServicesStatus ??= {};
  const status = prefs.NSServicesStatus;
  // Drop any previous entry of ours (including ones written with mangled names).
  for (const key of Object.keys(status)) if (key.startsWith("(null) - Refinar prompt")) delete status[key];
  edit(prefs, status);
  const xmlPlist = execFileSync("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", "-"], { input: JSON.stringify(prefs) });
  execFileSync("/usr/bin/defaults", ["import", "pbs", "-"], { input: xmlPlist });
}

function setShortcuts() {
  editServicesPrefs((prefs, status) => {
    for (const s of SERVICES.filter((x) => x.shortcut)) {
      status[statusKey(s.name)] = { enabled_context_menu: true, enabled_services_menu: true, key_equivalent: s.shortcut };
      prefs.ServicesShortcutsPresent = true;
    }
  });
}

function removeShortcuts() {
  editServicesPrefs(() => {});
}

function uninstall() {
  for (const s of SERVICES) rmSync(bundlePath(s.name), { recursive: true, force: true });
  removeShortcuts();
  execFileSync(PBS, ["-update"]);
  console.log("Serviços do Prompt Refiner removidos.");
}

const cmd = process.argv[2];
if (cmd === "install") install();
else if (cmd === "uninstall") uninstall();
else if (cmd) {
  console.error("Uso: node scripts/services.mjs install|uninstall");
  process.exit(1);
}
