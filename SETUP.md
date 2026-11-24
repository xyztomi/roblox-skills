# Roblox project setup

Release tag: `v0.2.2`

This assumes the toolchain in `README.md` is installed. Replace `TAG` below with the release tag.

## 1. Create the repository

```sh
mkdir my-game && cd my-game
git init -b main
gh repo create <name> --private --source . --remote origin
```

## 2. Copy the template

```sh
npx tiged xyztomi/roblox-skills/template#TAG /tmp/roblox-template
cp -R /tmp/roblox-template/. .
```

Or download `roblox-game-template.zip` from the release and copy
`roblox-game-template/.` into the repository root.

## 3. Install project tools

```sh
rokit trust rojo-rbx/rojo lune-org/lune JohnnyMorganz/StyLua Kampfkarren/selene JohnnyMorganz/luau-lsp
rokit install
pesde install
curl -L -o globalTypes.None.d.luau \
  https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau
```

## 4. Validate

```sh
rojo build default.project.json -o game.rbxl
rojo sourcemap default.project.json -o sourcemap.json --absolute
luau-lsp analyze --platform=roblox --sourcemap=sourcemap.json \
  --definitions:@roblox=globalTypes.None.d.luau \
  --ignore="**/roblox_packages/**" src
selene src
stylua --check src
```

All five must exit 0.

## 5. Install the plugin and MCP

```sh
opencode plugin add "github:xyztomi/roblox-skills#TAG::path:plugins/roblox-dev"
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  "https://raw.githubusercontent.com/xyztomi/roblox-skills/TAG/plugins/roblox-dev/agents/reviewer.md"
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

## 6. Connect Studio

```sh
rojo serve default.project.json
```

Connect the Rojo plugin in Studio, then confirm the MCP plugin reports a connected place.
`ServerScriptService` should contain the `Start` script.

## 7. Commit

```sh
git add -A
git commit -m "Start from the roblox-skills template (TAG)"
git push -u origin main
```
