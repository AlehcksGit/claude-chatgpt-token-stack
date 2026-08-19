# Who wrote what

This repo ships the source of three other people's projects so the whole thing works from one .zip. They keep their own licenses and copyright; nothing here re-licenses anything. Only the glue (installer, scripts, `warpd.ts`, docs) is ours, and that's MIT (`LICENSE`).

## pxpipe - `upstream/pxpipe/` and `stack/bin/lib/warpd/{ca,connect,route,der}.ts`

- https://github.com/teamchong/pxpipe (npm: `pxpipe-proxy`)
- Snapshot: 0.13.1, repository `main` as downloaded 2026-08-18
- Copyright (c) 2026 claude-image-proxy contributors
- MIT - full text in `upstream/pxpipe/LICENSE` and `stack/bin/lib/warpd/LICENSE.pxpipe`
- Changes: none inside `upstream/pxpipe/`. Left out of the copy: `node_modules/`, `dist/`, `package-lock.json`, `eval/corpus/`, and the benchmark trajectory dumps `eval/deepswe/{results,results-retry,results-retry2,results-retry3,failed-authexpiry}/` (about 1.4 GB, outputs not source; they're in the upstream repo). The four files under `stack/bin/lib/warpd/` are copied verbatim from `upstream/pxpipe/src/warp/` with only their import specifiers changed to `.ts`; `warpd.ts` next to them is new.

## claude-token-efficient - `upstream/claude-token-efficient/` and `stack/CLAUDE.md`

- https://github.com/drona23/claude-token-efficient
- Snapshot: repository `main` as downloaded 2026-08-18
- Copyright (c) 2026 drona23
- MIT - full text in `upstream/claude-token-efficient/LICENSE`
- Changes: none inside `upstream/`. `stack/CLAUDE.md` is upstream's universal `CLAUDE.md` plus a condensed `profiles/CLAUDE.coding.md`, with an `Override` section and an `@RTK.md` line added (see `docs/HOW-IT-WORKS.md`, section 3).

## rtk - Rust Token Killer - `upstream/rtk/` and `stack/RTK.md`

- https://github.com/rtk-ai/rtk (https://www.rtk-ai.app)
- Snapshot: `develop` branch as downloaded 2026-08-18 (`Cargo.toml` 0.42.4); the installer pulls the winget release instead (`rtk-ai.rtk`, 0.45.0 at time of writing)
- Author: Patrick Szymkowiak
- Apache License 2.0 - full text in `upstream/rtk/LICENSE`
- Changes: none. `stack/RTK.md` is the file `rtk init` generates, untouched.
