# Roblox project setup

Release tag: `v0.2.1`

This is the project-creation path. It assumes the toolchain from `README.md` is already installed:
OpenCode, Node 22, Git, GitHub CLI, VS Code, Roblox Studio, Rokit, and pesde. Replace `TAG` in the
commands with the release tag above.

## 1. Create the repository

```sh
mkdir my-game && cd my-game
git init -b main
gh repo create <name> --private --source . --remote origin
```

Use `--public` instead of `--private` when needed.

## 2. Copy the template

```sh
npx tiged xyztomi/roblox-skills/template#TAG /tmp/roblox-template
cp -R /tmp/roblox-template/. .
```

Or download `roblox-game-template.zip` from the release and copy
`roblox-game-template/.` into the repository root.

## 3. Install the pinned project tools

```sh
rokit trust rojo-rbx/rojo lune-org/lune JohnnyMorganz/StyLua Kampfkarren/selene JohnnyMorganz/luau-lsp
rokit install
pesde install
curl -L -o globalTypes.None.d.luau \
  https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau
```

`rokit install` reads `rokit.toml`. `pesde install` reads `pesde.toml` and the `test_packages`
workspace. Both are idempotent.

## 4. Validate the place

Run each command on its own from the repository root:

```sh
rojo build places/main/default.project.json -o game.rbxl
rojo sourcemap places/main/default.project.json -o sourcemap.json --absolute
luau-lsp analyze --platform=roblox --sourcemap=sourcemap.json \
  --definitions:@roblox=globalTypes.None.d.luau \
  --ignore="**/roblox_packages/**" places/main/src
selene places tools
stylua --check places tools
```

All five must exit 0.

## 5. Install the OpenCode plugins and Studio MCP

```sh
opencode plugin add "github:xyztomi/roblox-skills#TAG::path:plugins/roblox-dev"
opencode plugin add "github:xyztomi/roblox-skills#TAG::path:plugins/pages"
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  "https://raw.githubusercontent.com/xyztomi/roblox-skills/TAG/plugins/roblox-dev/agents/reviewer.md"
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

Restart OpenCode and Studio once after the MCP install. `/reload` reloads plugins and skills in an
open session.

## 6. Connect Studio

```sh
rojo serve places/main/default.project.json
```

In Studio, open the Rojo plugin and connect. Open the MCP plugin and confirm it reports a connected
place. `ServerScriptService` should contain the `Start` script from the template.

## 7. Commit

```sh
git add -A
git commit -m "Start from the roblox-skills template (TAG)"
git push -u origin main
```

## CI

CI is optional. `template/tools/ci/README.md` covers the three Roblox experiences, the Open Cloud
API key, `places.json`, and the publish workflow. Until it is configured, the CI jobs skip.
