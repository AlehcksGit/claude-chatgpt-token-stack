# upstream/ - the three projects, full source

Straight snapshots of the upstream repos as downloaded 2026-08-18, so this thing works from a single .zip and the credit and licenses ride along. For anything current, go to the real repos.

| Folder | Project | Snapshot | License |
|---|---|---|---|
| `pxpipe/` | https://github.com/teamchong/pxpipe | `main`, package 0.13.1 | MIT |
| `claude-token-efficient/` | https://github.com/drona23/claude-token-efficient | `main` | MIT |
| `rtk/` | https://github.com/rtk-ai/rtk | `develop`, Cargo.toml 0.42.4 (installer uses the winget release, 0.45.0) | Apache-2.0 |

Only thing trimmed is in `pxpipe/`: `node_modules/`, `dist/`, `package-lock.json`, `eval/corpus/`, and the benchmark trajectory dumps under `eval/deepswe/{results,results-retry,results-retry2,results-retry3,failed-authexpiry}/` (about 1.4 GB of outputs, not source; they're upstream). All of `src/`, `docs/`, `tests/`, `scripts/` and the eval harnesses are here.

## Building from here instead of the registries

pxpipe (Node >= 20.19 and pnpm):
```powershell
cd upstream\pxpipe
pnpm install
pnpm run build          # -> dist/, bin/cli.js
npm install -g .        # gives you the `pxpipe` command like the registry package would
```

rtk (Rust toolchain):
```powershell
cd upstream\rtk
cargo install --path .  # -> %USERPROFILE%\.cargo\bin\rtk.exe
```

claude-token-efficient has nothing to build; `stack/CLAUDE.md` is its universal `CLAUDE.md` plus a condensed `profiles/CLAUDE.coding.md` (see `docs/HOW-IT-WORKS.md`, section 3).

Then `..\..\install.ps1 -SkipRtk -SkipPxpipe` (or just one flag) installs the rules, scripts, hooks and always-on routing around what you built.
