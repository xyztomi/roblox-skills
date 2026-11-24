# AGENTS.md

A Roblox game kept in Git and synced into Studio by Rojo, worked on from OpenCode on macOS. The
place is the repository root: `default.project.json` maps `src/` into the DataModel. pesde installs
packages from `pesde.toml` into `roblox_packages/` (`ReplicatedStorage.Packages`) and Jest from
`test_packages/pesde.toml` into `ServerScriptService.Tests.Packages`. The Module Loader runs every
system: the two `Start` scripts turn on its tag discovery and start it, the `LOAD_MODULE` tag on
`Modules/Systems` marks what it loads, and `ExampleSystem` shows the layout a system follows.

The `roblox-dev` OpenCode plugin holds this project's conventions: Luau style, comments,
architecture, Rojo, testing, performance, and UI. Load the matching skill with the skill tool
before the first edit; the skill gate names the ones an edit needs.

## Commands

Run everything from the repository root.

- `rokit install` after `rokit.toml` changes, and `pesde install` after either `pesde.toml` changes.
- `rojo serve default.project.json` syncs the place into Studio. Connect from the Rojo plugin in
  your own dev place for it.
- Specs run in Studio against the dev place, once Rojo has synced the files.

A change is done when these all pass:

```
rojo build default.project.json -o game.rbxl
rojo sourcemap default.project.json -o sourcemap.json --absolute
luau-lsp analyze --platform=roblox --sourcemap=sourcemap.json --definitions:@roblox=globalTypes.None.d.luau --ignore="**/roblox_packages/**" src
selene src
stylua --check src
```

Run each one as its own command, with nothing chained before or after it (no `; echo $?`). The
project's `.opencode/opencode.json` lets these five run without asking only in exactly this form.
The sourcemap needs `--absolute`: Rojo writes paths relative to the project folder, and luau-lsp
reads them relative to the repo root.

`luau-lsp analyze` reads Roblox's types from `globalTypes.None.d.luau`. Download it once, and again
to pick up new engine APIs:
`curl -L -o globalTypes.None.d.luau https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau`

## Project specifics

- Rojo is pinned in `rokit.toml` (7.7.1) and in the `rojo` dev dependency in `pesde.toml` (7.7.0,
  the newest on pesde's registry). Change both together.
- Rojo 7.7.x can crash `rojo serve` when a folder is deleted or a folder module becomes a file
  module. Check that `rojo serve` is still running after those changes, and restart it if not.
- Write `IconTint` in a `.meta.json` with its type, `"IconTint": { "Color3": [1, 0, 0] }`. Every
  Rojo version accepts that form; 7.6.1 rejects the short one.
- `Workspace` sets `$ignoreUnknownInstances`, so Rojo syncs `src/Workspace` but leaves anything
  else in the place's Workspace alone. Things built in Studio stay out of Git until they're saved
  as files.
- `src/ServerScriptService/Tests/Packages/default.project.json` mounts
  `test_packages/roblox_packages` at `Tests.Packages`. Keep it in place.
