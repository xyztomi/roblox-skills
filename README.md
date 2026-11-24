# roblox-skills

OpenCode plugins and a starter project for Roblox game development, from
[Crusherfire Media](https://github.com/Crusherfire-Media). The workflow keeps your game in Git,
syncs it into Studio with Rojo, and gives OpenCode the skills, checks, and Studio access to work
on it.

## What's here

### The `roblox-dev` plugin

In `plugins/roblox-dev`. Skills load by ID, such as `vide` or `luau-style-guide`.

| Skill | What it covers |
|---|---|
| `luau-style-guide` | Luau style and typing, based on Roblox's style guide |
| `code-comments` | Which comments to write and keep, plus a cleanup pass |
| `game-architecture` | Systems run by [Module Loader](https://github.com/ActualFire-Games/module-loader): layout, realms, lifecycle, and requires |
| `rojo-workflow` | How files map into the place, `rojo serve`, syncback, pesde packages, and one worktree per agent |
| `roblox-testing` | Jest Roblox specs, in Studio and in CI |
| `roblox-performance` | Designing systems that scale, and finding and fixing lag |
| `rbx-perf-profiling` | Reading MicroProfiler data through LibMP |
| `game-ui-design` | Player-facing UI for phones, tablets, PCs, consoles, and VR |
| `figma-to-roblox` | Porting a Figma design into Roblox UI |
| `vide` | Vide, the reactive UI library |
| `vide-charm` | Charm state in Vide UI |
| `vide-performance` | Keeping Vide UI fast |
| `vide-ui-labs` | UI Labs stories for Vide components |

**Hooks** (details in `plugins/roblox-dev/hooks/README.md`):

- `skill-gate` holds back a Luau edit until the skills it needs are loaded.
- `after-edit` flags new lines that break Luau conventions.
- `skill-hints` suggests skills from your prompt and the files the agent reads.
- `verify-gate` runs `luau-lsp analyze`, selene, and StyLua on the Luau files the agent edited before
  it finishes a turn.

The OpenCode adapter is `plugins/roblox-dev/opencode/server.js`; the Claude Code hook scripts are
still in `plugins/roblox-dev/hooks/` and share the same rules.

**Reviewer:** the `reviewer` subagent checks larger Luau changes for Roblox-specific problems
(remotes, data saving, yields, architecture) and returns ranked findings. For general correctness,
use `/code-review`.

The skills work with any Studio MCP. The setup below adds
[Chrrxs/robloxstudio-mcp](https://github.com/Chrrxs/robloxstudio-mcp); Roblox's
[built-in Studio MCP](https://create.roblox.com/docs/studio/mcp) is the option with nothing to
install.

### The `pages` plugin (optional)

In `plugins/pages`. Its `html-kit` skill writes HTML pages, such as a plan for a Roblox system,
with themed components from one shared `kit.js`. A page holds only content, so it costs about as
many tokens as markdown and opens in any browser. The plugin's gate holds back a new HTML page until
the skill is loaded. It's [agent-html-kit](https://github.com/leex279/agent-html-kit) (MIT), restyled.

### The starter template

`template/` is a game project ready to sync: Rojo 7.7.1, pesde with Module Loader, Jest Roblox
specs, StyLua, selene, luau-lsp, VS Code settings, an `AGENTS.md`, and GitHub Actions workflows.
Each place in the experience is a folder under `places/`, and `places.json` maps each one to its
place in the CI, staging, and production experiences. Every pull request runs the lint and type
checks. After the optional CI setup in `template/tools/ci/README.md`, pull requests also run every
place's specs (in a CI experience, through Open Cloud), a merge to `main` publishes every place to
staging, and a GitHub release publishes them to production.

### Evals

`evals/` measures each skill against runs without it, with a blind judge. Twelve of the 13 skills
beat the baseline and `game-architecture` comes out even; [`evals/RESULTS.md`](evals/RESULTS.md)
has the numbers. The harness still runs its trials through `claude -p`, so it needs Claude Code
installed; it is development tooling and does not ship with the plugin.

## One-prompt setup

The setup runs on an Apple Silicon Mac. First install [OpenCode](https://opencode.ai/docs/),
[Homebrew](https://brew.sh), and [Roblox Studio](https://create.roblox.com/landing), and sign in to
Studio once. You also need a GitHub account.

Open an empty folder in OpenCode and paste:

```
Set up this folder as a Roblox game project with the Crusherfire Roblox AI workflow. Download the latest `SETUP.md` from `https://github.com/Crusherfire-Media/roblox-skills/releases/latest/download/SETUP.md` with `curl -L` and follow it step by step. Skip anything that's already installed, and stop and ask me before any step that needs my accounts or keys.
```

OpenCode follows the [`SETUP.md`](SETUP.md) attached to the latest release. Along the way you sign in
to GitHub, choose a name and visibility for your repo, and restart OpenCode and Studio once. CI
setup is a separate, optional step: ask for it when you're ready.

## Manual install

The plugin, pinned to a release tag (use `main` to follow development):

```
opencode plugin add 'github:Crusherfire-Media/roblox-skills#v0.2.0::path:plugins/roblox-dev'
opencode plugin add 'github:Crusherfire-Media/roblox-skills#v0.2.0::path:plugins/pages'
```

Until the v0.2.0 release is published, use `main` in place of `v0.2.0` in these commands.

To upgrade, update the entries with `opencode plugin update`, or add them again with a newer tag.
OpenCode caches packages by their installed version, so use the tag or a changed branch.

Install the reviewer subagent, which OpenCode does not load from a plugin package:

```
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  https://raw.githubusercontent.com/Crusherfire-Media/roblox-skills/v0.2.0/plugins/roblox-dev/agents/reviewer.md
```

The Studio MCP, which needs Node.js 22 or later:

```
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

In an OpenCode session that's already open, `/reload` loads new skills and plugins. The MCP server
loads in the next conversation you start. Restart Studio after the first MCP run so it loads the
MCP's Studio plugin.

For the template, download
[`roblox-game-template.zip`](https://github.com/Crusherfire-Media/roblox-skills/releases/latest/download/roblox-game-template.zip)
from the latest release. It holds only `template/`, with no history. Unzip it, rename the folder,
install [Rokit](https://github.com/rojo-rbx/rokit#installation) and
[pesde](https://docs.pesde.dev/installation/), and run `rokit install` and `pesde install` in that
folder. The template's `AGENTS.md` lists the checks. From a terminal with Node.js,
`npx tiged Crusherfire-Media/roblox-skills/template#v0.2.0 my-game` copies the same files.

## Develop

- Run the tests with `npm test` (Node.js 22 or later). They cover both the Claude Code hooks and the
  OpenCode adapters.
- Load the local plugins in this repo with `opencode.json`: run `opencode plugin list` and check that
  `roblox-dev` and `pages` are listed.
- To release, set the new tag in `SETUP.md` (its "Release tag" line), in this README (the manual
  install commands and the `tiged` command), and in the reviewer `curl` command. Bump `version` in
  `plugins/<plugin>/package.json` and `plugins/<plugin>/.claude-plugin/plugin.json` for every plugin
  whose files changed since the last tag (`git diff --stat <last-tag> -- plugins` lists them):
  installs are cached by version, so an unchanged version keeps the old copy. Commit that to `main`,
  then publish a GitHub release with a new tag on that commit. The Release workflow attaches
  `roblox-game-template.zip` and `SETUP.md` to it; for a release without the zip, run the workflow by
  hand with its tag.

## Contributing

This repo doesn't accept pull requests. Fork it and make it your own. The MIT license allows it.

## License

[MIT](LICENSE)
