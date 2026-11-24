# Skill evals

A harness that measures whether each `roblox-dev` skill helps. Every trial is a
headless OpenCode session (`opencode run`) in its own copy of a small Rojo game
project, under one of two setups:

- **with-skill:** a private OpenCode config that loads only a copy of the plugin under test.
- **baseline:** a private OpenCode config with no Roblox plugin.

Results are graded by automatic checks (`luau-lsp analyze`, `selene`, `stylua --check`, plus checks
each task declares) and by a blind judge that compares one with-skill and one baseline output at a
time. Aggregation reports mean, spread, and the with-skill minus baseline delta.

Nothing in `evals/` ships with the plugin: the plugin is `plugins/roblox-dev/` only.

## Layout

| Path | What it is |
|---|---|
| `harness/build-sandbox.mjs` | Builds the sandbox project into a folder outside the repo |
| `harness/sandbox-template/` | The sandbox's source files: Baseplate place, packages through pesde (see Task files), selene, StyLua |
| `harness/run-trials.mjs` | The runner |
| `harness/judge.mjs`, `harness/judge-prompt.md` | The blind judge and its prompt template |
| `harness/judge-facts.md` | Library facts every judge run gets, verified against the package source |
| `harness/aggregate.mjs` | Benchmark summary (pass rate, tokens, time, cost, delta) |
| `harness/export-results.mjs` | Copies a results folder's verdicts and diffs into the repo with local paths removed |
| `harness/prove-isolation.mjs` | Proves what each setup loads; writes `isolation/` |
| `harness/trigger-eval.mjs` | Description trigger tests and the train/test rewrite loop |
| `harness/fixtures/dummy-plugin/` | A throwaway `roblox-dev` plugin with two dummy skills and two dummy hooks |
| `harness/test/` | `node --test` tests, run by `npm test` |
| `isolation/` | Saved isolation evidence |
| `smoke/` | The smoke task and its results |
| `<skill>/` | Per skill: `tasks/*.json`, `triggers.json`, `results/<date>-<pass>/` |
| `PILOT.md`, `RESULTS.md` | The pilot's method and cost; the earlier results for every skill |

The harness is Node (ES modules, no dependencies), matching the repo's `npm test` setup.

## Requirements

- OpenCode 2.x, signed in, with a model you can call by `provider/model`.
- Node 22 or later, and git.
- The Rokit tools pinned in `harness/sandbox-template/rokit.toml` (rojo, pesde, luau-lsp, selene,
  StyLua) installed, so `rokit install` has nothing to fetch.
- Network access to build the sandbox (pesde packages and Roblox type definitions). Trials
  themselves need no network.

Set `EVAL_MODEL` to avoid repeating `--model`:

```sh
export EVAL_MODEL="opencode-go/deepseek-v4.1-flash"
```

## Isolation

Each trial gets its own `OPENCODE_CONFIG_DIR` containing one `opencode.json`, and runs with
`opencode run --standalone`. That private config:

- lists only the plugin under test, or no plugin for the baseline;
- sets `mcp.servers` to `{}`;
- denies every external directory except the copied plugin's folder;
- allows edits and reads in the project, and a narrow shell allowlist (`rojo sourcemap`, `luau-lsp
  analyze`, `selene`, `stylua`, and read-only git commands), and denies other shell commands.

The child environment also sets `OPENCODE_DISABLE_CLAUDE_CODE=1`,
`OPENCODE_DISABLE_PROJECT_CONFIG=1`, and strips `OPENCODE_*` and `CLAUDE_*` state from the launching
session. The shared database is kept so the model credentials still resolve; sessions are unique and
do not share history. `harness/opencode.mjs` writes the config and environment.

`checkIsolation` verifies the config lists only the expected plugin, has no MCP servers, and that
the trial loaded no skill outside the plugin under test. A contaminated trial is recorded as
`contaminated`, and `aggregate.mjs` refuses to summarize until it is rerun.

Run the proof after an OpenCode update:

```sh
node evals/harness/prove-isolation.mjs --sandbox <sandbox> --work <scratch>/iso --model "$EVAL_MODEL" --control
```

It runs a fixture plugin with a passphrase skill and two observable hooks, the baseline, and a
stateless judge, then writes evidence to `evals/isolation/`.

## Running evals

Keep every folder below outside the repo, in a place with no `AGENTS.md` or `.opencode` above it (a
temp folder works).

```sh
# 1. Build the sandbox once (about 15 s).
node evals/harness/build-sandbox.mjs <scratch>/sandbox

# 2. Run trials: every task x setup x run, 5 at a time.
node evals/harness/run-trials.mjs --task evals/vide/tasks/a.json,evals/vide/tasks/b.json \
  --sandbox <scratch>/sandbox --out <scratch>/results/vide \
  --plugin-dir "<worktree>/plugins/roblox-dev" --setup both --runs 3 --concurrency 5 \
  --model "$EVAL_MODEL"

# 3. Blind judge: pairs with-skill run-i with baseline run-i.
node evals/harness/judge.mjs --results <scratch>/results/vide --model "$EVAL_MODEL"

# 4. Aggregate: writes benchmark.json and benchmark.md in the results folder.
node evals/harness/aggregate.mjs --results <scratch>/results/vide --skill-name vide \
  --skill-path "<worktree>/plugins/roblox-dev/skills/vide"

# 5. Save the verdicts and diffs to the repo without local paths (--full keeps every file,
#    --transcripts also keeps transcripts). Copy the trigger results in as triggers.json.
node evals/harness/export-results.mjs --results <scratch>/results/vide --dest evals/vide/results/<date>
```

Use one `--out` folder per skill. Rerunning `run-trials.mjs` with the same `--out` adds runs after
the existing ones instead of replacing them.

Other runner flags: `--setup with-skill|baseline`, `--timeout-minutes` (default: the task's, else
20), and `--keep-projects` (keeps each trial's project copy for inspection).

### What a trial records

```
<out>/eval-<id>-<name>/eval_metadata.json
<out>/eval-<id>-<name>/<with_skill|without_skill>/run-<n>/
  run.json          status, config, skills loaded, hook evidence, tokens, cost, wall time, changed files
  grading.json      automatic checks in the historical grading.json shape
  timing.json       total_tokens and total_duration_seconds
  metrics.json      private config, session, isolation, tool calls, token breakdown, hook evidence
  transcript.jsonl  the OpenCode JSON event stream
  outputs/          changes.diff, the changed files, and the final message
<out>/eval-<id>-<name>/judge/pair-<n>/
  mapping.json      which run is A and which is B (written outside the judge's view)
  comparison.json   the judge's scores in the historical comparison.json shape
```

A trial's status is `ok`, `failed`, `timeout`, or `contaminated`. Failed and timed-out trials stay in
the results: every grading starts with the expectation "The trial finished without an error or
timeout", and a trial that breaks before grading still gets a `grading.json` that fails it.

### Hook evidence

OpenCode has no hook event stream, so `run.json` and `metrics.json` record each hook's effect:

- `skill-gate`: a tool call failed with a "Load ... with the skill tool" message.
- `after-edit`: a tool result carried a "Luau convention check" warning.
- `verify-gate`: the session contains the synthetic message "Luau checks before this turn ends".

The prompt and read hints are injected into the model request and are not persisted; the live smoke
tests in the repository cover them.

### Trial permissions

Trials use OpenCode's permission rules. Edits and reads inside the project are allowed, external
directories are denied except the copied plugin, and shell commands are denied except the narrow
allowlist in `lib/opencode.mjs`. Anything else that would prompt is denied.

## Task files

One JSON file per task, for example `evals/vide/tasks/block-picker.json`:

```json
{
  "id": 1,
  "name": "block-picker",
  "skill": "vide",
  "prompt": "Add a Vide UI that lets the player pick the block type to place ...",
  "setup_files": [{ "from": "fixtures/Placement.luau", "to": "src/ReplicatedStorage/Shared/Placement.luau" }],
  "auto_checks": ["luau-lsp", "selene", "stylua"],
  "checks": [
    { "type": "any_file_matches", "dir": "src", "ext": ".luau", "pattern": "require\\(.*Vide", "text": "The UI requires Vide" },
    { "type": "file_not_matches", "path": "src/StarterPlayer/StarterPlayerScripts/Main.client.luau", "pattern": "Instance\\.new\\(\"ScreenGui\"" },
    { "type": "command", "run": ["lune", "run", "tools/check"], "expect_exit": 0 }
  ],
  "rubric": ["Uses Vide components and sources idiomatically", "Fits phones and monitors"],
  "judge_facts": ["Vide 0.4.1 (vide/src/source.luau): setting a source to its current number, string, or frozen table doesn't rerun its bindings"],
  "timeout_minutes": 20
}
```

- `id`, `name`, `prompt`, and `rubric` (1 to 12 criteria for the judge) are required.
- `skill` names the skill expected to load in with-skill; `run.json` records whether it did.
- `setup_files` (paths relative to the task file) are copied into the project and committed before
  the trial, so the diff shows only the trial's work.
- `auto_checks` defaults to all three and runs on the trial's changed Luau files. A trial that
  changes no Luau file fails them. Use `[]` for tasks with no code changes.
- `checks` types: `file_exists`, `file_absent`, `file_matches`, `file_not_matches` (`path`,
  `pattern`, optional `flags`), `any_file_matches` (`dir`, `pattern`, optional `ext`), and `command`
  (`run` as an argument array, no shell; optional `expect_exit`, `timeout_seconds`). Paths must be
  relative and stay inside the project.
- `judge_facts` (optional, at most 12 strings of at most 600 characters each) adds library facts
  for this task's judge runs. They go into the judge prompt after the global facts from
  `harness/judge-facts.md`, one bullet each, and `eval_metadata.json` keeps them. A fact is library
  ground truth that you verified against the installed package source, named with its version and
  source file (for example "Charm 0.11.1 `listen` (charm/src/init.luau) runs its callback once
  right away"). Never put a skill's rules or conventions here: the judge would then grade the
  baseline against the skill it didn't have. Facts every task needs belong in `judge-facts.md`.

The sandbox is a Baseplate place: `Workspace.Baseplate` (top at Y = 0) and a `SpawnLocation`, with
code under `src/`. pesde installs these from Wally, and the sandbox `README.md` lists each with its
require path:

| Package | Version | In the place |
|---|---|---|
| `centau/vide` | 0.4.1 | `ReplicatedStorage.Packages.Vide` |
| `littensy/charm` | 0.11.1 | `ReplicatedStorage.Packages.Charm` |
| `littensy/vide-charm` | 0.4.1 | `ReplicatedStorage.Packages.VideCharm` |
| `littensy/charm-sync` | 0.4.1 | `ReplicatedStorage.Packages.CharmSync` |
| `pepeeltoro41/ui-labs` (UI Labs utilities) | 2.4.2 | `ReplicatedStorage.Packages.UILabs` |
| `crusherfire/module-loader` | 4.0.1 | `ReplicatedStorage.Packages.ModuleLoader` |
| `roblox/jest` | 3.20.1 | `ServerScriptService.Tests.Packages.Jest` |
| `roblox/jest-globals` | 3.20.1 | `ServerScriptService.Tests.Packages.JestGlobals` |

The Jest packages come from a pesde workspace member, `test_packages/`, so they mount in
`ServerScriptService.Tests.Packages`, where the `roblox-testing` skill expects them, rather than in
`ReplicatedStorage.Packages`. Their own dependencies resolve to the newest compatible release (3.21.0 for
`jest-core` and the rest), as `wally install` would. Specs go in
`src/ServerScriptService/Tests/Specs/` beside `jest.config.luau` (`testMatch = { "**/*.spec" }`);
the project's `globIgnorePaths` keeps that folder from also mapping a second time through
`src/ServerScriptService`. Specs can't run without Studio, so trials only type-check, lint, and
format them.

## Trigger tests

```sh
node evals/harness/trigger-eval.mjs eval --eval-set evals/vide/triggers.json \
  --plugin-dir plugins/roblox-dev --skill vide --model "$EVAL_MODEL" \
  --runs-per-query 3 --num-workers 5 --out <scratch>/vide-triggers.json
```

Each query gets a private config with a plugin copy whose target description is replaced, then runs
one OpenCode session. A run counts as triggered when the session calls the `skill` tool for the
target before any `edit`, `write`, or `patch`, or reads that skill's `SKILL.md`, within eight tool
calls. The eval set uses:

```json
[{ "query": "...", "should_trigger": true }]
```

`loop` mode splits the set into train and test with a seeded shuffle, evaluates both, asks the model
for a new description from the failed train queries, and keeps the best test result:

```sh
node evals/harness/trigger-eval.mjs loop --eval-set evals/vide/triggers.json \
  --plugin-dir plugins/roblox-dev --skill vide --model "$EVAL_MODEL" \
  --max-iterations 5 --holdout 0.4 --seed 42 --out <scratch>/vide-loop.json
```

## Smoke test

`smoke/block-catalog.json` is a tiny task (add a block type catalog module) run against the fixture
plugin, whose `block-catalog` skill sets a file path, a type, and colors from a `references/` file.
The results in `smoke/results/` predate the OpenCode harness and are kept as historical evidence.

## Known limits

- Trials share the OpenCode database so the model credentials resolve. Isolation comes from the
  private config, not from a separate database.
- The judge is a stateless generation with no tools and no session, which is the closest OpenCode
  equivalent of the old no-tool judge. OpenCode does not report token and cost usage for that
  endpoint, so judge usage is recorded as zero.
- OpenCode has no structured-output flag. The judge prompt carries a JSON Schema and the final text
  is parsed; an invalid answer is retried once, then marked failed.
- Trials can't use Studio. Tasks have to be judgeable from files.
