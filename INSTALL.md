**English** | [Português](INSTALACAO.pt-BR.md)

# Installing Prompt Refiner

This is the install guide, and nothing else. What Prompt Refiner does, how to configure it and how it works inside are in the [README](README.md).

It is **one command** plus two things you do with the mouse. About 3 minutes.

> **Interface language:** the extension's menus, the settings page, the installer's output and the macOS messages are in Brazilian Portuguese. Your prompts are refined in whatever language you wrote them in.

---

## What you need

- **A Mac**, or any computer with Chrome. The ⌥⌥ gesture in apps is macOS only.
- **Node.js 22 or newer.** If you don't have it, the installer says so and where to get it.
- **One AI engine** — your Claude subscription (no key, no card) or an API key of your own. The installer checks this too and tells you if it's missing.

Nothing to check by hand. The installer verifies everything and stops with a clear message if something is missing.

---

## Step 1 — Install

Open the **Terminal** app, paste this line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | bash
```

> Use the **copy button** in the block's corner. The ``` backticks on screen are **not part of the command**.

That's it. It does everything itself, in six numbered stages, and finishes by **refining a real sentence** so you can see it work.

**Where it installs:** always `~/prompt-refiner`, no matter where you ran the command from. The installer prints that path on its **first** line and again at the **end**, together with the extension folder — that is the path you need in step 2. To install somewhere else, put `PROMPT_REFINER_DIR=~/another-folder` in front of the command.

**Downloaded the GitHub ZIP instead of using the command?** You can run `./instalar.sh` from inside the unzipped folder: it copies the project to `~/prompt-refiner` and carries on from there. If something is already installed at `~/prompt-refiner`, it stops and shows you the options — what it never does is install quietly inside your Downloads folder, where you would not find the extension afterwards.

**If it stops**, the message says why and what to do. You can run it as many times as you like: it detects what is already in place.

<details>
<summary><strong>Rather see what the script does before running it?</strong></summary>

It **never asks for your password** and **writes nothing outside your home folder**. The six stages: check the machine (Node and a free port), fetch dependencies, create the configuration, build the extension, start the backend, integrate with the Mac apps.

To read the whole script first:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | less
```

Press `q` to quit.

</details>

## Step 2 — Load the extension in Chrome

The installer cannot do this one: Chrome only accepts it through the interface.

1. Open `chrome://extensions`
2. Turn on **Developer mode**, top right
3. Click **Load unpacked**
4. Choose the folder `~/prompt-refiner/extension/dist` — the path the installer printed on its first and last line

> **Can't find the folder in Chrome's window?** Press **⌘⇧G**, paste `~/prompt-refiner/extension/dist` and hit Enter. The installer also prints the exact path at the end.
>
> It only exists **after** the installer has run — the installer creates it.

*Load unpacked* means Chrome runs the extension straight from that folder instead of from the Web Store. Nothing is verified by Google and it does not auto-update — you are trusting the code in that folder, which is all here to read.

## Step 3 — Allow the ⌥⌥ shortcut *(Mac only)*

1. Open **System Settings › Privacy & Security › Accessibility**
2. If **Prompt Refiner** is already listed, remove it with the **−** button
3. Click **+** and choose `~/Applications/Prompt Refiner.app`

> If you had installed it before, **removing and re-adding is required**. Toggling the switch off and on does not work, because to macOS every build is a different app.

---

## Done — how to use it

- **In Chrome:** select your text, right-click, and choose **Prompt Refiner › Refinar prompt**.
- **In any Mac app:** select your text and **double-tap ⌥ Option**. Hold **⇧ Shift** as well for deep mode.

The selected text is replaced by the refined prompt, right where it was. If anything fails, **your text is left untouched**.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| The prompt became `bash-3.2$` and a message about zsh appeared | The ``` backticks were copied along. Type `exit`, press Enter, and copy the command with the block's copy button |
| `command not found: node` | Node is not installed. Get the LTS build from [nodejs.org](https://nodejs.org) |
| `destination path ... already exists` | Only happens if you clone by hand: the folder is there from an earlier try. Run `cd ~/prompt-refiner && ./instalar.sh`. The one-command install handles this itself |
| The installer says Claude Code is not signed in | Run `claude`, type `/login`, pick the account with a subscription, then `/exit` |
| The installer says the port is taken | It stops **before** doing any work and prints the PID holding the port (almost always a forgotten `npm run dev` in some terminal). Close that terminal, or run `kill <PID>`, and run the installer again. If the port belongs to another program you want to keep, change `PORT=` in `backend/.env` |
| I installed, but I still get the previous version | Can't happen any more: the installer reinstalls the service on every run and checks that the version answering is the one in this folder. If it isn't, it stops and names both |
| I ran the installer from inside a ZIP and couldn't find the extension in Chrome | Can't happen any more: the install always lands in `~/prompt-refiner`, and that path is the first and the last thing on screen |
| The extension says *Desconectado* | Check that the port in **Endpoint da API** matches `backend/.env`. If you moved the project folder, run the installer again |
| ⌥⌥ does nothing | Accessibility is not granted, or it was granted to an older build. Redo step 3, removing with **−** before adding |
| ⌥⌥ opens Claude's quick entry | The Claude app uses the same gesture. Turn it off in Claude › Settings › System |

**To see what the backend logged:**

```bash
tail -20 ~/Library/Logs/PromptRefiner/backend.log
```

If none of that helps, [open an issue](https://github.com/Dennielasouza/prompt-refiner/issues) describing what appeared on screen. A screenshot is fine. **Don't paste your API key or the text of your prompts.**

---

## Uninstalling

The commands live inside the project folder, so **run them before deleting it**.

```bash
cd ~/prompt-refiner && npm run uninstall-hotkey -w desktop && npm run uninstall-services -w desktop && npm run uninstall-service -w backend
```

Then remove the extension in `chrome://extensions`, take Prompt Refiner out of the Accessibility list, and delete the `~/prompt-refiner` folder.

The usage history lives at `~/Library/Logs/PromptRefiner/backend.log` and none of those commands delete it — remove it by hand if you want it gone.
