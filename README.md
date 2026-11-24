# roblox-skills

OpenCode plugin and a Rojo/pesde template for Roblox game development. Fork of
[Crusherfire Media's roblox-skills](https://github.com/Crusherfire-Media/roblox-skills), maintained
from [xyztomi/roblox-skills](https://github.com/xyztomi/roblox-skills).

## What it is

`plugins/roblox-dev` is an OpenCode server plugin:

- registers 13 skills with `ctx.skill.transform`,
- gates Luau edits until the required skills are loaded,
- appends Luau convention findings to edited files,
- injects skill hints into the next model request,
- runs luau-lsp, selene, and StyLua at the end of a turn.

The shared rules live in `plugins/roblox-dev/lib/`. Skills live in `skills/` and are never copied.
`agents/reviewer.md` is a read-only Roblox reviewer subagent.

`template/` is a single-place game: `default.project.json` at the root, code under `src/`, packages
from `pesde.toml`, Jest from `test_packages/`, and an `.opencode/opencode.json` permission list for
the five checks. `template/AGENTS.md` is the game repo's instructions.

There is no eval suite. `tools/check-plugin-package.mjs` is the live check.

## Requirements

macOS on Apple Silicon. Install and keep on `PATH`:

- OpenCode 2.x, signed in to a provider
- Node.js 22 or later
- Git and GitHub CLI
- VS Code and Roblox Studio
- Rokit and pesde
- Rojo, Lune, luau-lsp, StyLua, and selene from `template/rokit.toml`

This repo does not install or upgrade the toolchain.

## Install

```sh
opencode plugin add 'github:xyztomi/roblox-skills#v0.2.2::path:plugins/roblox-dev'
```

For a moving copy, replace `v0.2.2` with `main`. `opencode plugin update` moves a branch or range
forward; an exact tag stays put.

Reviewer subagent:

```sh
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  https://raw.githubusercontent.com/xyztomi/roblox-skills/v0.2.2/plugins/roblox-dev/agents/reviewer.md
```

Studio MCP:

```sh
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

Restart Studio after the first MCP run. `/reload` reloads plugins and skills.

Local checkout:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/roblox-skills/plugins/roblox-dev"]
}
```

## Template

```sh
npx tiged xyztomi/roblox-skills/template#v0.2.2 my-game
cd my-game
rokit trust rojo-rbx/rojo lune-org/lune JohnnyMorganz/StyLua Kampfkarren/selene JohnnyMorganz/luau-lsp
rokit install
pesde install
curl -L -o globalTypes.None.d.luau \
  https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau
```

Validate:

```sh
rojo build default.project.json -o game.rbxl
rojo sourcemap default.project.json -o sourcemap.json --absolute
luau-lsp analyze --platform=roblox --sourcemap=sourcemap.json \
  --definitions:@roblox=globalTypes.None.d.luau \
  --ignore="**/roblox_packages/**" src
selene src
stylua --check src
```

## Development

```sh
npm test                         # unit and release tests
npm run doctor                   # check OpenCode, tools, and template
npm run reload                   # opencode service restart
npm run pack:plugins             # npm tarball in dist/
npm run check:plugin-package -- --model provider/model
                                 # live packaged plugin: skill load and gate
npm run check:release            # tag, README, and plugin version consistency
```

OpenCode watches local plugin files. If a dependency change does not appear, run `npm run reload`.
Use `opencode plugin update` for installed packages.

## Release

Set the tag in `SETUP.md`, the README install commands, the reviewer `curl`, and the `tiged`
command. Bump `version` in `plugins/roblox-dev/package.json`. Merge to `main`, tag that commit, and
publish a GitHub release. If the release event does not start the asset workflow:

```sh
gh workflow run Release --ref main -f tag=vX.Y.Z
```

Then run `npm run check:release`.

## Layout

| Path | Purpose |
|---|---|
| `plugins/roblox-dev/` | Skills, OpenCode plugin, shared rules, reviewer |
| `template/` | Pinned single-place Roblox project |
| `tools/` | Doctor, reload, package, package check, release checks |
| `opencode.json` | Loads the local plugin in this repo |

## License

MIT. Original copyright and third-party notices are in `LICENSE` and `NOTICE.md`.
