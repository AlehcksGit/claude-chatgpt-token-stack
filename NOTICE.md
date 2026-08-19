# Third-party notices

This repository redistributes, unmodified except where stated, the source of three open-source projects. Each keeps its own license and copyright; nothing here re-licenses them.

## pxpipe - `upstream/pxpipe/` and `stack/bin/lib/warpd/{ca,connect,route,der}.ts`

- Project: https://github.com/teamchong/pxpipe (npm: `pxpipe-proxy`)
- Version vendored: 0.13.1 (repository `main` as downloaded 2026-08-18)
- Copyright (c) 2026 claude-image-proxy contributors
- License: MIT - full text in `upstream/pxpipe/LICENSE` and `stack/bin/lib/warpd/LICENSE.pxpipe`
- Modifications: none to `upstream/pxpipe/`. Omitted from the copy: `node_modules/`, `dist/`, `package-lock.json`, `eval/corpus/`, and the benchmark result dumps `eval/deepswe/{results,results-retry,results-retry2,results-retry3,failed-authexpiry}/` (about 1.4 GB of trajectories, not source; available in the upstream repository). The four files under `stack/bin/lib/warpd/` are copied verbatim from `upstream/pxpipe/src/warp/` with only their import specifiers changed to `.ts`; `warpd.ts` is new (MIT, this repo).

## claude-token-efficient - `upstream/claude-token-efficient/` and `stack/CLAUDE.md`

- Project: https://github.com/drona23/claude-token-efficient
- Version vendored: repository `main` as downloaded 2026-08-18
- Copyright (c) 2026 drona23
- License: MIT - full text in `upstream/claude-token-efficient/LICENSE`
- Modifications: none to `upstream/`. `stack/CLAUDE.md` is derived from its global profile with local tuning (see `docs/HOW-IT-WORKS.md`).

## rtk - Rust Token Killer - `upstream/rtk/` and `stack/RTK.md`

- Project: https://github.com/rtk-ai/rtk (https://www.rtk-ai.app)
- Version vendored: `develop` branch as downloaded 2026-08-18 (`Cargo.toml` 0.42.4); the installer uses the winget release (`rtk-ai.rtk`, 0.45.0 at time of writing)
- Author: Patrick Szymkowiak
- License: Apache License 2.0 - full text in `upstream/rtk/LICENSE`
- Modifications: none. `stack/RTK.md` is the file `rtk init` generates, unchanged.

## Everything else

`install.ps1`, `uninstall.ps1`, `stack/bin/**` (except the four vendored warp files), `docs/`, `README.md`: MIT, Copyright (c) 2026 Alex Carter - see `LICENSE`.

Claude, Claude Code and the Claude desktop app are products of Anthropic. This project is not affiliated with or endorsed by Anthropic.
