# roblox-skills

OpenCode plugins and a Rojo/pesde starter project for Roblox game development. This is a fork of
[Crusherfire Media's roblox-skills](https://github.com/Crusherfire-Media/roblox-skills), released
from [xyztomi/roblox-skills](https://github.com/xyztomi/roblox-skills).

## System

`plugins/roblox-dev` is an OpenCode server plugin. `opencode/server.js` registers the 13 skills
with `ctx.skill.transform` and installs four behaviors:

- **skill gate:** `tool.execute.before` blocks a Luau edit until the skills that edit needs are
  loaded.
- **after-edit:** `tool.execute.after` appends Luau convention findings to the tool result.
- **skill hints:** prompt, read, and compaction events queue a skill hint into the next model
  request.
- **verify gate:** `experimental.idle` runs luau-lsp, selene, and StyLua on the turn's edited files
  and sends findings back as a synthetic message.

The gate, lint, hint, and verify rules live in `plugins/roblox-dev/hooks/lib/`. The legacy Claude
Code hooks and manifest remain for compatibility, but OpenCode is the supported runtime. Skills
stay in `skills/` and are never copied.

`plugins/pages` adds the optional `html-kit` skill and a page gate. `plugins/roblox-dev/agents/reviewer.md`
is a read-only Roblox reviewer subagent.

`template/` is a game repo: Rojo 7.7.1, pesde with Module Loader, Jest Roblox specs, StyLua, selene,
luau-lsp, `.opencode/opencode.json`, and `AGENTS.md`. `places.json` maps every place folder to its
place in the CI, staging, and production experiences.

`evals/` is the OpenCode-native eval harness. Trials use a private `OPENCODE_CONFIG_DIR` and
`opencode run --standalone`; the judge uses stateless OpenCode generation. See `evals/README.md`.

## Requirements

macOS on Apple Silicon. Install these yourself and keep them on `PATH`:

- OpenCode 2.x, signed in to a provider
- Node.js 22 or later
- Git and GitHub CLI
- VS Code and Roblox Studio
- [Rokit](https://github.com/rojo-rbx/rokit) and [pesde](https://docs.pesde.dev/installation/)
- The tools pinned in `template/rokit.toml`: Rojo, Lune, luau-lsp, StyLua, selene

The template pins tools in `rokit.toml` and packages in `pesde.toml`. This repository does not
install or upgrade them.

## Install

Install the plugins from the release:

```sh
opencode plugin add 'github:xyztomi/roblox-skills#v0.2.1::path:plugins/roblox-dev'
opencode plugin add 'github:xyztomi/roblox-skills#v0.2.1::path:plugins/pages'
```

For a moving copy, replace `v0.2.1` with `main`. `opencode plugin update` moves a branch or range
forward; an exact tag stays put.

Install the reviewer subagent, which OpenCode does not load from a plugin package:

```sh
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  https://raw.githubusercontent.com/xyztomi/roblox-skills/v0.2.1/plugins/roblox-dev/agents/reviewer.md
```

Install a Studio MCP server, for example:

```sh
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

Restart Studio after the first MCP run. In OpenCode, `/reload` reloads plugins and skills.

To work on this checkout without installing it, point a game repo at the absolute plugin paths:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/roblox-skills/plugins/roblox-dev",
    "/absolute/path/to/roblox-skills/plugins/pages"
  ]
}
```

## Template

Copy the template and install its pinned project tools:

```sh
npx tiged xyztomi/roblox-skills/template#v0.2.1 my-game
cd my-game
rokit trust rojo-rbx/rojo lune-org/lune JohnnyMorganz/StyLua Kampfkarren/selene JohnnyMorganz/luau-lsp
rokit install
pesde install
curl -L -o globalTypes.None.d.luau \
  https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau
```

Or download `roblox-game-template.zip` from the latest release and use that folder.

Validate a place:

```sh
rojo build places/main/default.project.json -o game.rbxl
rojo sourcemap places/main/default.project.json -o sourcemap.json --absolute
luau-lsp analyze --platform=roblox --sourcemap=sourcemap.json \
  --definitions:@roblox=globalTypes.None.d.luau \
  --ignore="**/roblox_packages/**" places/main/src
selene places tools
stylua --check places tools
```

The template's `AGENTS.md` covers places, CI, and the project checks. `template/tools/ci/README.md`
covers Open Cloud setup and the publish workflow.

## Development

```sh
npm test                         # all node:test suites
npm run reload                   # native: opencode service restart
npm run pack:plugins             # npm tarballs in dist/
npm run check:plugin-package -- --model provider/model
```

OpenCode watches local plugin files, but a dependency change can require `npm run reload`. Use
`opencode plugin update` for installed packages.

The eval harness needs a model:

```sh
export EVAL_MODEL=provider/model
node evals/harness/build-sandbox.mjs /tmp/sandbox
node evals/harness/run-trials.mjs --task evals/vide/tasks/block-picker.json \
  --sandbox /tmp/sandbox --out /tmp/results --setup both --runs 1 --model "$EVAL_MODEL"
node evals/harness/judge.mjs --results /tmp/results --model "$EVAL_MODEL"
node evals/harness/aggregate.mjs --results /tmp/results --skill-name vide
```

## Release

The tag appears in `SETUP.md`, the README install commands, the reviewer `curl`, and the `tiged`
command. Bump `version` in both `plugins/<plugin>/package.json` and
`plugins/<plugin>/.claude-plugin/plugin.json` for every changed plugin. Merge to `main`, publish a
GitHub release on that commit, and run `gh workflow run Release --ref main -f tag=vX.Y.Z` if the
release event does not start the asset workflow.

## Layout

| Path | Purpose |
|---|---|
| `plugins/roblox-dev/` | Skills, OpenCode plugin, legacy Claude hooks, reviewer |
| `plugins/pages/` | `html-kit` skill and page gate |
| `template/` | Pinned Roblox game template |
| `evals/` | OpenCode eval harness and historical results |
| `tools/` | Reload, package, package-check, and release tests |
| `opencode.json` | Loads both local plugins in this repo |

## License

MIT. Original copyright and third-party notices are in `LICENSE` and `NOTICE.md`.
