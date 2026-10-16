**English** | [Português](INSTALACAO.pt-BR.md)

# Installing Prompt Refiner

This is the install guide, and nothing else. What Prompt Refiner does, how to configure it and how it works inside are in the [README](README.md).

It is **one command** plus two things you do with the mouse. About 3 minutes.

> **Interface language:** the extension's menus, the settings page, the installer's output and the macOS messages are in Brazilian Portuguese. Your prompts are refined in whatever language you wrote them in.

---

## Before you start

> **Copying the commands:** hover over the grey block and use the **copy button** in its corner. The ``` backticks on screen are **not part of the command** — if they get copied too, your terminal opens another shell inside itself and it looks like everything failed.

You need:

- **A Mac, or any computer with Chrome.** The Mac app integration (the ⌥⌥ gesture) is macOS only.
- **Node.js 22 or newer.** To check, open the **Terminal** app and run:

  ```bash
  node --version
  ```

  A number like `v22.11.0` or higher means you are set. If it says *command not found*, install the **LTS** build from [nodejs.org](https://nodejs.org) — the installer does everything.

- **One AI engine.** Pick one; you don't need both:
  - **Your Claude subscription** (Pro or Max), with no API key and no card. This is the recommended path and the one the installer expects. It needs [Claude Code](https://code.claude.com) installed and signed in.
  - **Your own API key**, from Anthropic or OpenAI, billed per call. See the [README](README.md#engines).

---

## Install — one command

Open the **Terminal** app, paste the line below and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Dennielasouza/prompt-refiner/main/instalar.sh | bash
```

That's it. It downloads the project, installs everything, starts the backend and finishes by **refining a real sentence** so you can see it work. Six numbered stages along the way.

> **Copying:** hover over the grey block and use the **copy button** in its corner. The ``` backticks on screen are **not part of the command**.

If you would rather read the script before running it — which is what I'd do with any command from the internet — download and open it first:

```bash
git clone https://github.com/Dennielasouza/prompt-refiner.git ~/prompt-refiner && open ~/prompt-refiner/instalar.sh
```

then run:

```bash
cd ~/prompt-refiner && ./instalar.sh
```

**If it stops**, the message says why and what to do. You can run it as many times as you like: it detects what is already in place and skips it.

## Step 2 — Load the extension in Chrome

The installer cannot do this one: Chrome only accepts it through the interface.

1. Open `chrome://extensions`
2. Turn on **Developer mode**, top right
3. Click **Load unpacked**
4. Choose the folder `~/prompt-refiner/extension/dist`

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
| The installer says the port is in use | Something else holds 8787. Open `backend/.env`, change the `PORT=` line, and run the installer again |
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
