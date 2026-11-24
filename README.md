# roblox-skills

OpenCode plugins and a starter project for Roblox game development, forked from
[Crusherfire Media's roblox-skills](https://github.com/Crusherfire-Media/roblox-skills) and
released from [xyztomi/roblox-skills](https://github.com/xyztomi/roblox-skills). The workflow keeps
your game in Git, syncs it into Studio with Rojo, and gives OpenCode the skills, checks, and Studio
access to work on it.

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

Matt Pocock's engineering skills work in OpenCode through the skills CLI. Install them once with
`npx skills@latest add mattpocock/skills -a opencode`; OpenCode discovers them under
`~/.agents/skills`. They are separate from this repo and are not reinstalled or modified here.

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
has the numbers from the earlier harness. The current harness runs trials through the OpenCode CLI
and the judge through OpenCode's stateless generation, so it needs OpenCode and a model, not Claude
Code. It is development tooling and does not ship with the plugin.

## One-prompt setup

The setup runs on an Apple Silicon Mac. First install [OpenCode](https://opencode.ai/docs/),
[Homebrew](https://brew.sh), and [Roblox Studio](https://create.roblox.com/landing), and sign in to
Studio once. You also need a GitHub account.

Open an empty folder in OpenCode and paste:

```
Set up this folder as a Roblox game project with the xyztomi Roblox AI workflow. Download the latest `SETUP.md` from `https://github.com/xyztomi/roblox-skills/releases/latest/download/SETUP.md` with `curl -L` and follow it step by step. Skip anything that's already installed, and stop and ask me before any step that needs my accounts or keys.
```

OpenCode follows the [`SETUP.md`](SETUP.md) attached to the latest release. Along the way you sign in
to GitHub, choose a name and visibility for your repo, and restart OpenCode and Studio once. CI
setup is a separate, optional step: ask for it when you're ready.

## Manual install

Install the v0.2.0 release:

```
opencode plugin add 'github:xyztomi/roblox-skills#v0.2.0::path:plugins/roblox-dev'
opencode plugin add 'github:xyztomi/roblox-skills#v0.2.0::path:plugins/pages'
```

For a moving copy, replace `v0.2.0` with `main`. `opencode plugin update` moves a branch or range
forward; an exact tag stays put. OpenCode caches packages by version.

Install the reviewer subagent, which OpenCode does not load from a plugin package:

```
mkdir -p ~/.config/opencode/agents
curl -fsSL -o ~/.config/opencode/agents/reviewer.md \
  https://raw.githubusercontent.com/xyztomi/roblox-skills/v0.2.0/plugins/roblox-dev/agents/reviewer.md
```

To use this checkout without installing it, add the absolute plugin folders to a game repo's
`.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "/absolute/path/to/roblox-skills/plugins/roblox-dev",
    "/absolute/path/to/roblox-skills/plugins/pages"
  ]
}
```

The Studio MCP, which needs Node.js 22 or later:

```
opencode mcp add robloxstudio --global -- npx -y @chrrxs/robloxstudio-mcp@latest --auto-install-plugin
```

In an OpenCode session that's already open, `/reload` loads new skills and plugins. The MCP server
loads in the next conversation you start. Restart Studio after the first MCP run so it loads the
MCP's Studio plugin.

For the template, download
[`roblox-game-template.zip`](https://github.com/xyztomi/roblox-skills/releases/latest/download/roblox-game-template.zip)
from the latest release. It holds only `template/`, with no history. Unzip it, rename the folder,
run `bash tools/setup-toolchain.sh --all`, and read the template's `AGENTS.md` for the checks. From a
terminal with Node.js, `npx tiged xyztomi/roblox-skills/template#v0.2.0 my-game` copies the
same files.

## Develop

- Run the tests with `npm test` (Node.js 22 or later). They cover both hook adapters, the eval
  harness, the packaged-plugin contract, and release version consistency.
- `opencode.json` loads both local plugins for sessions in this repo. Check them with
  `opencode plugin list`.
- OpenCode reloads watched config and plugin files. When a local plugin dependency change does not
  appear, run `npm run reload`; that calls the native `opencode service restart`. For installed
  packages, use `opencode plugin update`.
- `npm run pack:plugins` writes the npm tarballs to `dist/`. `npm run check:plugin-package --
  --model <provider/model>` packs `roblox-dev`, extracts the tarball, loads it in a private OpenCode
  config, and runs a live session that loads its skill; it also reports whether the package's skill
  gate denied an edit.
- Run an eval with `EVAL_MODEL=<provider/model>` and the commands in `evals/README.md`. The harness
  uses private config directories and `opencode run --standalone`, so user plugins, skills, and MCP
  servers do not enter a trial.
- To release, set the new tag in `SETUP.md` (its "Release tag" line), in the README install commands
  and `tiged` command, and in the reviewer `curl`. Bump `version` in
  `plugins/<plugin>/package.json` and
  `plugins/<plugin>/.claude-plugin/plugin.json` for every plugin whose files changed since the last
  tag (`git diff --stat <last-tag> -- plugins` lists them): installs are cached by version, so an
  unchanged version keeps the old copy. Commit that to `main`, then publish a GitHub release with a
  new tag on that commit. The Release workflow attaches `roblox-game-template.zip` and `SETUP.md` to
  it. If the release event does not start it, run
  `gh workflow run Release --ref main -f tag=vX.Y.Z`. For a release without the zip, run the same
  command with that tag.

## Contributing

This fork accepts pull requests against `main`. The upstream project does not accept external pull
requests; fork it and make it your own. The MIT license allows it.

## License

[MIT](LICENSE)
