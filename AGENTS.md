# AGENTS.md

This repo ships OpenCode plugins and a Roblox starter project. It is not a Roblox game: there is no Rojo project, no pesde workspace, and no Luau checks to run at the root. Work on macOS with zsh.

## Layout

- `plugins/roblox-dev/`: skills, the `reviewer` agent, the OpenCode adapter in `opencode/`, and the Claude Code hooks in `hooks/` kept for backward compatibility. `package.json` exports `opencode/server.js`.
- `plugins/pages/`: the optional `html-kit` skill, its OpenCode adapter, and its Claude gate.
- `template/`: the game project shipped to users as `roblox-game-template.zip`. Its `AGENTS.md` and its Rojo, selene, and StyLua checks apply to the user's game repo, not here. `template/tools/setup-toolchain.sh` is the tested toolchain installer.
- `evals/`: the OpenCode eval harness and saved historical results. Nothing in it ships.
- `opencode.json`: loads both local plugins for sessions in this repo.
- `SETUP.md`: an executable prompt for a fresh Apple Silicon Mac. Keep steps ordered, idempotent, and each with its "Done when" check.

## Commands

- `npm test` from the root (Node 22 or later, no dependencies). It runs every `*.test.mjs`: both hook adapters, the eval harness, the packaged-plugin contract, and release version checks.
- `npm run reload` calls the native `opencode service restart`. OpenCode reloads watched config and plugin files, but a local plugin dependency change may not appear until the service restarts.
- `npm run pack:plugins` writes npm tarballs to `dist/`. `npm run check:plugin-package -- --model <provider/model>` packs and extracts a plugin, loads the extracted artifact in a private OpenCode config, and runs a live skill-load check. It also reports whether the package's skill gate denied an edit.
- Evals run through the OpenCode CLI, not `claude -p`. Set `EVAL_MODEL=<provider/model>` and read `evals/README.md`. Each trial uses a private `OPENCODE_CONFIG_DIR` and `opencode run --standalone`; do not add user plugins, skills, or MCP servers to a trial.

## Skills and hooks

- A skill is `plugins/<plugin>/skills/<name>/SKILL.md` with YAML `name` and `description`. OpenCode uses the directory name as the skill ID, so references between skills use bare IDs such as `vide`, not `roblox-dev:vide`.
- `opencode/skills.mjs` registers the files with `ctx.skill.transform`. Do not copy skills into `.opencode/skills/`; that would create a second source that drifts.
- The gate and hint logic is shared. Adding or renaming a skill means changing `hooks/lib/gate.mjs` for the edit requirements, `PROMPT_HINTS` in both `hooks/skill-hints.mjs` and `opencode/edits.mjs`, and the tests in `hooks/test` and `opencode/test`.
- Both adapters must keep the same behavior: gate, after-edit lint, prompt and read hints, and the verify gate. The OpenCode adapter maps `edit`, `write`, and `patch` to the shared rules.
- Adding a skill also needs a row in the README table and a folder under `evals/`.
- Matt Pocock's skills are installed separately with the skills CLI and discovered under `~/.agents/skills`. Do not reinstall, remove, or edit that installation from this repo.

## Template

- Everything under `template/` ships to users. Changing behavior there usually means updating `SETUP.md` or `README.md` too.
- `.opencode/opencode.json` holds the five pre-approved check commands. `template/AGENTS.md` is the game repo's instruction file.
- Rojo is pinned twice: `template/rokit.toml` (7.7.1) and the `rojo` dev dependency in `template/pesde.toml` (7.7.0). Change both together.
- `template/places.json` must list exactly the folders in `template/places/`, with an id per experience. Each place needs a non-empty `src/ServerScriptService/Tests/Specs`, or CI fails it.
- Lune scripts in `template/tools/ci` run on Lune 0.10.5, which does not parse `const`; use `local`.
- LF only (`.gitattributes`); StyLua fails on CRLF.

## Release

- The tag appears in `SETUP.md` (the exact line `Release tag: \`vX.Y.Z\``) and in the README install, reviewer `curl`, and `tiged` commands. `SETUP.md` uses `TAG` placeholders for the rest. The release workflow greps `SETUP.md` for that exact line.
- Bump `version` in both `plugins/<plugin>/package.json` and `plugins/<plugin>/.claude-plugin/plugin.json` for every plugin whose files changed since the last tag. `tools/release.test.mjs` enforces that the two agree.
- Do not push, tag, or publish without the user's approval.
- The release workflow zips `template/` at the tag and requires `places.json` (or an older `default.project.json`) at its root. If publishing a release does not start the workflow, run `gh workflow run Release --ref main -f tag=vX.Y.Z`.
- This fork accepts PRs into `main`; the upstream project does not accept outside pull requests.
