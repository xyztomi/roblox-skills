# Roblox AI workflow setup

Release tag: `v0.2.0`

You are setting up the folder open in OpenCode as a Roblox game project for the viewer who pasted
the prompt. Wherever a command says `TAG`, replace it with the release tag above: the template,
the `roblox-dev` plugin, and the `pages` plugin all come from that tag.

## How to run this file

- Save this file as `$TMPDIR/roblox-setup/SETUP.md`. If you downloaded it into the project folder,
  move it there. That keeps it out of the game repo, and you re-read it from there after the restart.
- Work through the steps in order, and finish each one only when its "Done when" line holds.
- When a step's check passes, say so in one line and go to the next step. Steps without a check run
  every time, and their commands skip what's already done. That way a second run, or the run after
  the restart, changes nothing that's already done.
- Every command is zsh on macOS. Run it with your shell tool. When OpenCode asks for permission to
  run a command, ask the viewer to approve it; the permission prompts are theirs, not yours.
- Start every command block with this **PATH prelude**. Tools installed during this run reach your
  PATH only after the restart, and the prelude lets you call them by name before then:

  ```zsh
  eval "$(/opt/homebrew/bin/brew shellenv)"
  export PATH="$HOME/.rokit/bin:$HOME/.pesde/bin:$HOME/.local/bin:/opt/homebrew/opt/node@22/bin:$PATH"
  ```

- **Viewer:** marks something only the viewer can do. Tell them exactly what to click or type, then
  wait until they say it's done. Put commands they type in a plain chat message, where they can
  copy them; a question dialog's text can't be copied.
- **Stop and ask:** marks a decision that needs the viewer's accounts or choices. Ask with your
  question tool and offer the likely answers, then wait. Use it too for the questions a skill asks
  during setup. When a step needs both a command and a question, send the command in a chat message
  first, then ask.
- When a command fails, find the symptom in [Common problems](#common-problems), apply its fix, and
  run the step again. When nothing there matches, show the viewer the error and stop.
- Keys and tokens go only into the hidden-input script in [CI setup](#ci-setup-optional). Keep them
  out of messages, command lines, and command output.

## 1. Check the prerequisites

Check each item:

- The Mac is Apple Silicon: `uname -m` prints `arm64`.
- Homebrew is installed: `/opt/homebrew/bin/brew --version` runs. When it's missing:
  **Viewer:** run this in a terminal and enter the Mac password when asked, then reopen OpenCode:

  ```zsh
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```

  Then add Homebrew to the shell:

  ```zsh
  line='eval "$(/opt/homebrew/bin/brew shellenv)"'
  grep -qxF "$line" "$HOME/.zprofile" 2>/dev/null || echo "$line" >> "$HOME/.zprofile"
  ```

- OpenCode is installed and signed in: `opencode --version` prints `v2` or higher. The setup runs
  inside OpenCode, so this only fails when the viewer started the setup somewhere else.
  **Stop and ask** before installing it another way.
- Git is installed: `git --version` runs. When it's missing, run `xcode-select --install` and have
  the viewer click **Install** in the dialog.
- Roblox Studio is installed: `test -d /Applications/RobloxStudio.app`. When it's missing:
  **Viewer:** install **Roblox Studio** from <https://create.roblox.com/landing>, launch it once,
  and sign in.
- VS Code is installed: `test -d '/Applications/Visual Studio Code.app'`. When it's missing:
  **Viewer:** install it from <https://code.visualstudio.com>, or let step 2 install it with
  Homebrew.
- The project folder is empty, holds only `.opencode`, `.vscode`, or `.git`, or already holds the
  template (a `places.json`). When it holds anything else: **Stop and ask** whether this is the
  right folder.

Done when every item passes.

## 2. Install the GitHub CLI, Node.js, and VS Code

Node.js runs the Studio MCP server and the plugin's hooks, which need Node 22 or later.

Check: `gh --version`, `node --version` (a `v22` or higher), and `code --version` all run.

Run the line for each tool that's missing:

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="$HOME/.rokit/bin:$HOME/.pesde/bin:$HOME/.local/bin:/opt/homebrew/opt/node@22/bin:$PATH"
brew list gh >/dev/null 2>&1 || brew install gh
brew list node@22 >/dev/null 2>&1 || brew install node@22
brew list --cask visual-studio-code >/dev/null 2>&1 || brew install --cask visual-studio-code
```

Homebrew installs Node 22 in a private folder, so add it to the shell every time. These lines skip
what's already there:

```zsh
for line in 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' 'export PATH="/Applications/Visual Studio Code.app/Contents/Resources/app/bin:$PATH"'; do
  grep -qxF "$line" "$HOME/.zprofile" 2>/dev/null || echo "$line" >> "$HOME/.zprofile"
done
```

When Node is installed but older than 22: **Stop and ask** before upgrading it, since other projects
may use it. On a yes, run `brew upgrade node@22` and check again.

Done when the check passes.

## 3. Install Rokit and pesde

Both install for the current user without admin rights. The pinned installer checks
the existing versions first and skips what is already correct.

Check: `test -x "$HOME/.rokit/bin/rokit" && test -x "$HOME/.pesde/bin/pesde"`.

Otherwise, download this release's installer and run it:

```zsh
mkdir -p "$TMPDIR/roblox-setup"
curl -fsSL -o "$TMPDIR/roblox-setup/setup-toolchain.sh" "https://raw.githubusercontent.com/xyztomi/roblox-skills/TAG/template/tools/setup-toolchain.sh"
bash "$TMPDIR/roblox-setup/setup-toolchain.sh" --install
```

When it reports a version mismatch, **Stop and ask** before replacing an existing tool with
`--force`. When it reports a missing Homebrew, Node, VS Code, or Studio, fix that first.

Keep both tool folders on the shell's PATH:

```zsh
line='export PATH="$HOME/.rokit/bin:$HOME/.pesde/bin:$PATH"'
grep -qxF "$line" "$HOME/.zprofile" 2>/dev/null || echo "$line" >> "$HOME/.zprofile"
```

Done when `rokit --version` and `pesde --version` both print the pinned versions, 1.2.0 and 0.7.4.

## 4. Confirm OpenCode runs

Check: `opencode --version` prints `v2` or higher, and `opencode service status` reports a running
service.

When the service isn't running, run `opencode service restart` and check again. Do not edit the
service registration or the OpenCode database.

Done when both commands pass.

## 5. Sign in to GitHub

Check: this prints `success` and a scope list that includes `workflow`:

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
gh auth status --json hosts | python3 -c "import json,sys; h=json.load(sys.stdin)['hosts'].get('github.com', []); print('no github.com login' if not h else ' '.join(f\"{a['state']} {' '.join(a.get('scopes', []))}\" for a in h if a.get('active')))"
```

When `success` is missing: **Viewer:** open a terminal in VS Code (**Terminal > New Terminal**), run
this, and finish the sign-in in the browser:

```zsh
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
```

When it prints `success` without `workflow`: **Viewer:** run the same command with
`auth refresh --hostname github.com --scopes workflow` in place of everything after `gh`.
The `workflow` scope lets Git push the template's GitHub Actions workflow files.

Once the check passes, make gh the credential helper Git pushes with:

```zsh
gh auth setup-git
```

**Stop and ask** what the GitHub repo should be called (suggest the folder name, with spaces as
hyphens) and whether it's public or private, unless the viewer already said. When the viewer also
has to sign in, send the sign-in command first and ask right after it, so they can answer while
the browser sign-in runs.

Done when the check passes and you have the repo's name and visibility.

## 6. Copy the template

Check: `places.json`, `rokit.toml`, `pesde.toml`, and `AGENTS.md` exist in the project folder.

When a check fails, download this release's template:

```zsh
src="$TMPDIR/roblox-setup/template-TAG"
mkdir -p "$src"
if [ ! -d "$src/roblox-game-template" ]; then
  curl -fsSL -o "$src.zip" "https://github.com/xyztomi/roblox-skills/releases/download/TAG/roblox-game-template.zip"
  unzip -q -o "$src.zip" -d "$src"
fi
```

When `places.json` is missing, copy all of it:

```zsh
cp -R "$src/roblox-game-template/." .
```

When only some files are missing, copy those files from `$src/roblox-game-template` and leave the
rest alone.

The template's `pesde.toml` takes the place of `pesde init`, which needs a person typing answers.

Done when `places.json`, `rokit.toml`, `pesde.toml`, `.opencode/opencode.json`, and `AGENTS.md`
exist in the project folder.

## 7. Install the VS Code extensions

The template's `.vscode/extensions.json` lists them.

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="/Applications/Visual Studio Code.app/Contents/Resources/app/bin:$PATH"
python3 - <<'PY'
import json, subprocess
want = json.load(open('.vscode/extensions.json'))['recommendations']
have = {line.strip().lower() for line in subprocess.run(['code', '--list-extensions'], capture_output=True, text=True).stdout.splitlines()}
for ext in want:
    if ext.lower() not in have:
        subprocess.run(['code', '--install-extension', ext], check=False)
PY
```

**Viewer:** if VS Code asks whether to trust an extension's publisher, click **Trust**.

Done when `code --list-extensions` lists every ID in `extensions.json`. When one stays missing:
**Viewer:** open the Extensions view, search `@recommended`, and install it there.

## 8. Install the Roblox tools and run the checks

The template ships the same installer. It reads `rokit.toml` and `pesde.toml`, trusts the pinned
tools, installs them, runs `pesde install`, and downloads the Roblox type definitions when they are
missing. It is safe to run every time.

```zsh
bash tools/setup-toolchain.sh --project
```

When `pesde install` stops at a question: **Viewer:** run `pesde install` in the VS Code terminal and
answer it.

Then run the five commands under "A change is done when these all pass" in the project's
`AGENTS.md`.

Done when all five exit with code 0.

## 9. Install the Studio plugins, the OpenCode plugins, and the Studio MCP server

Run each block every time; each one skips or harmlessly repeats what's done.

The Rojo and MCP plugins for Studio (each overwrites its plugin file with the same version):

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
export PATH="$HOME/.rokit/bin:$HOME/.pesde/bin:$HOME/.local/bin:/opt/homebrew/opt/node@22/bin:$PATH"
rojo plugin install
npx -y @chrrxs/robloxstudio-mcp@latest --install-plugin
```

The OpenCode plugins, at user scope so they work in every folder. The `#TAG` pins them to this
release:

```zsh
opencode plugin add "github:xyztomi/roblox-skills#TAG::path:plugins/roblox-dev"
opencode plugin add "github:xyztomi/roblox-skills#TAG::path:plugins/pages"
```

The reviewer subagent, which OpenCode does not load from a plugin package:

```zsh
mkdir -p "$HOME/.config/opencode/agents"
curl -fsSL -o "$HOME/.config/opencode/agents/reviewer.md" \
  "https://raw.githubusercontent.com/xyztomi/roblox-skills/TAG/plugins/roblox-dev/agents/reviewer.md"
```

The Studio MCP server, at user scope so it works in every folder. An "already exists" error means
it's done:

```zsh
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

Done when `opencode plugin list` shows `roblox-dev` and `pages`, `opencode mcp list` shows
`robloxstudio`, and `~/.config/opencode/agents/reviewer.md` exists.

## 10. Create the GitHub repo

Set the Git identity from the viewer's GitHub account. The block fills in only a missing
`user.name` or `user.email`, so note which ones are missing before you run it:

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
if [ -z "$(git config --global --get user.name)" ] || [ -z "$(git config --global --get user.email)" ]; then
  name=$(gh api user --jq 'if .name then .name else .login end')
  email=$(gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"')
  [ -n "$(git config --global --get user.name)" ] || git config --global user.name "$name"
  [ -n "$(git config --global --get user.email)" ] || git config --global user.email "$email"
fi
```

When either was missing, tell the viewer: commits use their GitHub name and private GitHub noreply
address, and `git config --global user.name` or `user.email` changes them.

Make `main` the default branch name for new repos when nothing sets one:

```zsh
git config --global --get init.defaultBranch >/dev/null || git config --global init.defaultBranch main
```

Then commit and push, replacing `<name>` and `<public-or-private>` with the answers from step 5:

```zsh
if [ ! -d .git ]; then git init -b main; fi
if ! git rev-parse --verify --quiet HEAD >/dev/null; then
  git add -A
  git commit -m "Start from the roblox-skills template (TAG)"
fi
if [ -z "$(git remote)" ]; then
  gh repo create <name> --<public-or-private> --source . --push
else
  git push -u origin main
fi
```

Done when `git status -sb` starts with `## main...origin/main` and shows nothing ahead. This repo's
own instructions say to keep changes off `main`; that applies after setup, not to this first commit.

## 11. Restart OpenCode and Studio, once

A new OpenCode session loads the plugins and skills and connects the Studio MCP server, and Studio
loads plugins only at startup.

Check: `opencode plugin list` lists `roblox-dev` and `pages`, `opencode mcp list` lists a connected
`robloxstudio`, and a new terminal finds `rokit` with `command -v rokit`.

Otherwise, give the viewer these steps and stop until they're back:

1. Quit OpenCode completely.
2. Close every Roblox Studio window.
3. Reopen OpenCode on this folder and start a new session. Run `/reload` if the skills are missing.
4. Open a terminal in VS Code (**Terminal > New Terminal**), run `rokit --version`, and close it.
5. Open Roblox Studio and start a new **Baseplate**.

When the viewer resumes, re-read `$TMPDIR/roblox-setup/SETUP.md` and start again at step 1.

Done when the check passes.

## 12. Finish in the new session

Run all three checks first, and when more than one needs the viewer, ask for those actions in one
message.

1. Check: `~/.agents/skills/setup-matt-pocock-skills/SKILL.md` exists. When it does, leave the
   viewer's installation untouched. When it's missing: **Stop and ask** whether to install Matt
   Pocock's skills for OpenCode with
   `npx skills@latest add mattpocock/skills -a opencode`, including
   `setup-matt-pocock-skills` when the installer asks. Then, once per repo, ask OpenCode to run the
   `setup-matt-pocock-skills` skill (or type `@setup-matt-pocock-skills`), answer its questions with
   GitHub as the issue tracker and the default labels, and commit what it writes.
2. Check: the `robloxstudio` MCP server reports a connected Studio place. When it reports none:
   **Viewer:** in Studio's **Plugins** tab, open the MCP plugin and confirm it shows **Connected**.
3. Check through the MCP server: `ServerScriptService` holds the `Start` script. Otherwise:
   **Viewer:** in the VS Code terminal, run `rojo serve places/main/default.project.json`. Then,
   in the Baseplate, open **Plugins > Rojo** and click **Connect**.

Done when all three checks pass. Tell the viewer the setup is finished, list anything that still
needs them, and mention that CI setup is optional: they can ask for it any time.

## CI setup (optional)

Run this section when the viewer asks for it, once step 12 is done. Pull requests already run the
lint and type checks; this adds the specs in a CI experience, publishing to staging on each merge to
`main`, and publishing to production on each GitHub release. `tools/ci/README.md` explains each
part; walk the viewer through its Setup section like this:

1. **Viewer:** create three experiences in the Creator Dashboard: CI, staging, and production. A new
   game has one place, `main`, which is each experience's start place, so nothing more is needed.
   With more folders in `places/`, each experience needs a place for each.
2. **Viewer:** create an Open Cloud API key under **API Keys** in the Creator Dashboard, with exactly
   these permissions:
   - **universe-places**: **Write**, on the CI, staging, and production experiences.
   - **luau-execution-sessions**: **Write**, on the CI experience only.

   Don't add **assets**: it can't be restricted to experiences, so its Write reaches every asset
   the account can access. Keep **Restrict by Experience** on, leave **Restrict IP addresses**
   off, and set an expiration date. A key acts as the account that created it, so Roblox
   recommends a dedicated account for CI; `tools/ci/README.md` says what that account needs.
3. **Viewer:** store the key by running this in the VS Code terminal at the project root, and paste
   the key only into its hidden prompt:

   ```zsh
   bash tools/set-api-key.sh
   ```

   Check: `gh secret list` shows `ROBLOX_API_KEY`.
4. Ask the viewer for the Creator Dashboard URL of each place in each experience
   (`.../experiences/<universe id>/places/<place id>/...`), which holds both IDs. IDs aren't
   secret, so they can go in the chat. Put them in `places.json`, replacing each `null`:

   ```json
   {
     "universes": { "ci": <CI universe id>, "staging": <id>, "production": <id> },
     "places": {
       "main": { "ci": <CI place id>, "staging": <id>, "production": <id> }
     }
   }
   ```

   Check: `lune run tools/ci/build` builds every place without a `places.json:` error. Then commit
   and push: `git add places.json; git commit -m "Set up CI places"; git push`.

5. Tell the viewer how to retire the key, for example after trying CI with their own account: delete
   the secret with `gh secret delete ROBLOX_API_KEY` **and** revoke the key in the Creator Dashboard.
   Deleting the secret alone leaves the key working.

Done when `gh secret list` shows `ROBLOX_API_KEY` and the pushed `places.json` has no `null` left.

## Common problems

| Symptom | Fix |
|---|---|
| `brew` "command not found" | Start the block with the PATH prelude. When that works, add `eval "$(/opt/homebrew/bin/brew shellenv)"` to `~/.zprofile` and open a new terminal. |
| A tool "command not found" before the restart | Start the block with the PATH prelude. |
| A tool "command not found" after the restart | Check `~/.zprofile` for the brew, Node 22, and VS Code lines. **Viewer:** close every terminal and OpenCode window and reopen. |
| `xcode-select: error: command line tools are already installed` | Git is ready. Continue. |
| Homebrew says the formula is keg-only | Use `/opt/homebrew/opt/node@22/bin/node` or keep the Node line in `~/.zprofile`. |
| Rosetta or "bad CPU type" | The Mac is Intel or a tool is an x86 build. This setup targets Apple Silicon; **Stop and ask** before mixing architectures. |
| App is damaged or was blocked by macOS | **Viewer:** open **System Settings > Privacy & Security** and allow the app, or reinstall it from its official download. |
| Rokit: "has not been marked as trusted" | Run `rokit trust <tool>` with the tool the error names, then `rokit install`. |
| Rokit: "Failed to find tool ... in any project manifest" | Run the command in the project folder. For `pesde`, call `"$HOME/.pesde/bin/pesde"`. |
| Rokit: "os error 2" or "os error 3" | Run `rokit install`. |
| Rokit or pesde: "GitHub API" or "403" while downloading | GitHub's rate limit for anonymous downloads. Wait a few minutes and retry. |
| `rojo plugin install`: no Studio plugins folder | Studio isn't installed or hasn't run yet. **Viewer:** launch Studio once and sign in. |
| `rojo serve`: port 34872 already in use | Another `rojo serve` is running. Close it, or add `--port 34873` to the command and enter that port in the Rojo plugin. |
| `rojo serve` crashes after a folder is deleted or a folder module becomes a file | A known Rojo 7.7.x bug. Run `rojo serve` again and click **Connect**. |
| `stylua --check` reports a diff in every file | Files were checked out with CRLF line endings. Confirm `.gitattributes` holds `* text=auto eol=lf`, run `stylua src tools`, and commit. |
| selene flags `game`, `workspace`, and other Roblox globals | `selene.toml` needs `std = "roblox"`. The template's has it, so run selene from the project root. |
| luau-lsp shows no Roblox types or requires in the editor | Open VS Code on the project root, restart VS Code so Rojo is on its PATH, then run **Luau: Regenerate Sourcemap**. |
| `opencode plugin list` doesn't show `roblox-dev` | Check the plugin entry in `~/.config/opencode/opencode.json`. Run `opencode plugin list` again, then `opencode service restart`. |
| Skills are missing in a session | Run `opencode plugin list`; an entry can be disabled with a leading `-`. Start a new session or run `/reload`. |
| `opencode plugin add` fails while cloning over SSH | Use the `github:` form shown in step 9, which uses HTTPS. |
| `opencode mcp list` doesn't show `robloxstudio` | Run the `opencode mcp add` line from step 9 again. It is user-scope, so it belongs in `~/.config/opencode/opencode.json`. |
| The Studio MCP plugin never shows **Connected**, or reports a version mismatch | **Viewer:** quit every OpenCode session and every Studio window, then reopen both. If the plugin is missing, run `npx -y @chrrxs/robloxstudio-mcp@latest --install-plugin` first. |
| Rojo plugin: "different protocol version" | Run `rojo --version` in the project folder and expect 7.7.x, then `rojo plugin install` and restart Studio. When Studio also has the Creator Store Rojo plugin, uninstall that copy. |
| "Author identity unknown" on commit | Run the identity block in step 10. |
| Push rejected: "without `workflow` scope" | **Viewer:** run the `auth refresh` command from step 5, then push again. |
| `gh repo create`: the name already exists | **Stop and ask** for another name. |
| "Unable to create ... index.lock: File exists" | Retry once the other Git command finishes. When none is running, delete `.git/index.lock`. |
| A CI run fails | Find it under "When a run fails" in `tools/ci/README.md`. |
