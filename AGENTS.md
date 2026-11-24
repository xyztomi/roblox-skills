# AGENTS.md

This repo ships OpenCode plugins and a Roblox starter project. It is not a Roblox game: there is no Rojo project, no pesde workspace, and no Luau checks to run at the root. Work on macOS with zsh.

## Layout

- `plugins/roblox-dev/`: skills, the `reviewer` agent, Claude Code hooks in `hooks/`, and the OpenCode adapter in `opencode/`. `package.json` exports `opencode/server.js` as the plugin entrypoint.
- `plugins/pages/`: the optional `html-kit` skill, its Claude gate, and its OpenCode adapter.
- `template/`: the game project shipped to users as `roblox-game-template.zip`. Its `AGENTS.md` and its Rojo, selene, and StyLua checks apply to the user's game repo, not here.
- `evals/`: the eval harness and saved results. Nothing in it ships. Trials still run through `claude -p`, so they need Claude Code installed.
- `opencode.json`: loads both local plugins for sessions in this repo.
- `SETUP.md`: an executable prompt for a fresh Apple Silicon Mac, not prose docs. Keep steps ordered, idempotent, and each with its "Done when" check.

## Commands

- `npm test` from the root (Node 22 or later, no dependencies). It runs every `*.test.mjs`: both hook adapters, the page gates, and the eval harness. It passes on macOS and Linux.
- `opencode plugin list` after changing a plugin's `package.json` or `opencode/server.js`. OpenCode reloads watched config and plugin files; use `opencode service restart` when a change to an unwatched local dependency does not appear.
- Evals are expensive and need a logged-in Claude Code. Read `evals/README.md` first, build the sandbox outside the repo, and save results with `harness/export-results.mjs` so local paths are stripped.

## Skills and hooks

- A skill is `plugins/<plugin>/skills/<name>/SKILL.md` with YAML `name` and `description`. OpenCode uses the directory name as the skill ID, so references between skills use bare IDs such as `vide`, not `roblox-dev:vide`.
- `opencode/skills.mjs` registers the files with `ctx.skill.transform`. Do not copy skills into `.opencode/skills/`; that would create a second source that drifts.
- The gate and hint logic is shared. Adding or renaming a skill means changing `hooks/lib/gate.mjs` for the edit requirements, `PROMPT_HINTS` in both `hooks/skill-hints.mjs` and `opencode/edits.mjs`, and the tests in `hooks/test` and `opencode/test`.
- Both adapters must keep the same behavior: gate, after-edit lint, prompt and read hints, and the verify gate. The OpenCode adapter maps `edit`, `write`, and `patch` to the shared rules.
- Adding a skill also needs a row in the README table and a folder under `evals/`.

## Template

- Everything under `template/` ships to users. Changing behavior there usually means updating `SETUP.md` or `README.md` too.
- `.opencode/opencode.json` holds the five pre-approved check commands. `template/AGENTS.md` is the game repo's instruction file.
- Rojo is pinned twice: `template/rokit.toml` (7.7.1) and the `rojo` dev dependency in `template/pesde.toml` (7.7.0). Change both together.
- `template/places.json` must list exactly the folders in `template/places/`, with an id per experience. Each place needs a non-empty `src/ServerScriptService/Tests/Specs`, or CI fails it.
- Lune scripts in `template/tools/ci` run on Lune 0.10.5, which does not parse `const`; use `local`.
- LF only (`.gitattributes`); StyLua fails on CRLF.

## Release

- The tag appears in `SETUP.md` (the exact line `Release tag: \`vX.Y.Z\``), in the README install commands, and in the reviewer `curl`. The release workflow greps `SETUP.md` for that exact line.
- Bump `version` in both `plugins/<plugin>/package.json` and `plugins/<plugin>/.claude-plugin/plugin.json` for every plugin whose files changed since the last tag. Installs cache by version.
- The release workflow zips `template/` at the tag and requires `places.json` (or an older `default.project.json`) at its root.
- `README.md` says the repo does not accept outside pull requests; maintainers still work through branches and PRs into `main`.
