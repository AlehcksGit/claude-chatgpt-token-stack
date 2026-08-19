# upstream/ - full source of the three projects

Unmodified snapshots of the upstream repositories as downloaded on 2026-08-18, so this repo works from a single .zip and the credit and licenses travel with it. Prefer the upstream repos for anything current.

| Folder | Project | Snapshot | License |
|---|---|---|---|
| `pxpipe/` | https://github.com/teamchong/pxpipe | `main`, package version 0.13.1 | MIT |
| `claude-token-efficient/` | https://github.com/drona23/claude-token-efficient | `main` | MIT |
| `rtk/` | https://github.com/rtk-ai/rtk | `develop`, Cargo.toml 0.42.4 (winget release used by the installer: 0.45.0) | Apache-2.0 |

Omitted from `pxpipe/` only: `node_modules/`, `dist/`, `package-lock.json`, `eval/corpus/`, and the benchmark trajectory dumps under `eval/deepswe/{results,results-retry,results-retry2,results-retry3,failed-authexpiry}/` (about 1.4 GB, outputs not sources; they are in the upstream repository). Everything else, including all of `src/`, `docs/`, `tests/`, `scripts/` and the eval harnesses, is here.

## Building from these sources instead of the registries

pxpipe (needs Node >= 20.19 and pnpm):
```powershell
cd upstream\pxpipe
pnpm install
pnpm run build          # -> dist/, bin/cli.js
npm install -g .        # provides the `pxpipe` command like the registry package
```

rtk (needs a Rust toolchain):
```powershell
cd upstream\rtk
cargo install --path .  # -> %USERPROFILE%\.cargo\bin\rtk.exe
```

claude-token-efficient needs no build; `stack/CLAUDE.md` is its universal `CLAUDE.md` plus a condensed `profiles/CLAUDE.coding.md` (see `docs/HOW-IT-WORKS.md`, section 3).

Then run `..\..\install.ps1 -SkipRtk -SkipPxpipe` (or with only one of the flags) to install just the rules, scripts, hooks and always-on routing around what you built.
