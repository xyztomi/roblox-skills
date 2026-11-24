# AGENTS.md

This repo ships one OpenCode plugin and a Roblox starter project. It is not a Roblox game: there is
no Rojo project, no pesde workspace, and no Luau checks to run at the root. Work on macOS with zsh.

## Layout

- `plugins/roblox-dev/`: 13 skills, the OpenCode adapter in `opencode/`, shared rules in `lib/`, and the `reviewer` agent. `package.json` exports `opencode/server.js`.
- `template/`: a single-place game project shipped as `roblox-game-template.zip`. Its `AGENTS.md` and checks apply to the user's game repo, not here.
- `tools/`: doctor, reload, package, packaged-plugin check, and release checks.
- `opencode.json`: loads the local plugin for sessions in this repo.
- `SETUP.md`: a short project-creation checklist. It assumes the README toolchain and does not install it.

## Commands

- `npm test` from the root (Node 22 or later). It runs the OpenCode adapter tests and release checks.
- `npm run doctor` checks OpenCode, the plugin list, the pinned tools, and the template without installing anything.
- `npm run reload` calls `opencode service restart`. OpenCode watches local plugin files, but a dependency change may need this.
- `npm run pack:plugins` writes the npm tarball to `dist/`.
- `npm run check:plugin-package -- --model <provider/model>` packs the plugin, loads the tarball in a private OpenCode config, and runs a live skill-load and gate check.
- `npm run check:release` verifies the tag, README, template, and plugin version agree. Run it after tagging.

## Skills and hooks

- A skill is `plugins/roblox-dev/skills/<name>/SKILL.md` with YAML `name` and `description`. OpenCode uses the directory name as the ID, so references use bare IDs such as `vide`.
- `opencode/skills.mjs` registers the files with `ctx.skill.transform`. Do not copy skills into `.opencode/skills/`.
- The gate uses `lib/gate.mjs`; hints use `PROMPT_HINTS` in `opencode/edits.mjs`; after-edit uses `lib/lint.mjs`; verify uses `lib/verify.mjs`.
- Adding or renaming a skill means updating the gate, hints, OpenCode tests, and the README table.
- Do not add a second adapter or a compatibility layer. OpenCode is the only runtime.

## Template

- Everything under `template/` ships to users. `template/AGENTS.md` is the game repo's instruction file.
- The place is the repository root: `template/default.project.json` maps `template/src`.
- Rojo is pinned twice: `template/rokit.toml` (7.7.1) and the `rojo` dev dependency in `template/pesde.toml` (7.7.0). Change both together.
- LF only (`.gitattributes`); StyLua fails on CRLF.

## Release

- The tag appears in `SETUP.md`, the README install commands, the reviewer `curl`, and the `tiged` command.
- Bump `version` in `plugins/roblox-dev/package.json` for a changed plugin. The version is in the release tag.
- Merge to `main`, tag that commit, and publish a GitHub release. If the release event does not start the asset workflow, run `gh workflow run Release --ref main -f tag=vX.Y.Z`.
- Do not push, tag, or publish without the user's approval.
