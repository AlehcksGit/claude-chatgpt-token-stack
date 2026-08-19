# claude-token-stack

A homebrewed kitbash of three token-saving projects for Claude Code, glued together in an afternoon with Claude's help so they all run at once - in the terminal *and* inside the Claude desktop app. One installer, full upstream source in the box, nothing clever of our own beyond the glue.

The three projects doing the actual work:

| Layer | What it trims | Project | By | License |
|---|---|---|---|---|
| 1 | CLI tool output (git, ls, cargo, npm, tests...) | [rtk - Rust Token Killer](https://github.com/rtk-ai/rtk) | Patrick Szymkowiak ([rtk-ai](https://github.com/rtk-ai)) | Apache-2.0 |
| 2 | How much the model talks (rules against preamble, boilerplate, sycophancy) | [claude-token-efficient](https://github.com/drona23/claude-token-efficient) | [drona23](https://github.com/drona23) | MIT |
| 3 | Context on the wire (renders old history / tool docs to images) | [pxpipe](https://github.com/teamchong/pxpipe) | [teamchong](https://github.com/teamchong) + the claude-image-proxy contributors | MIT |

Credit for the savings is all theirs. What this repo adds: an installer, a tiny daemon (`warpd`) that gets pxpipe under the desktop app (which turned out to be the hard part), a control script, a combined rules file, and a write-up of how it fits together. Only Windows 10 tested for now, because that is what it was built for/on; there's a bash port for Linux/macOS that has had much less mileage.

What it did on the machine it was built on (Windows 10, Claude Code 2.1.222 CLI / 2.1.229 desktop engine, Node 24, rtk 0.45.0, pxpipe 0.13.1):

- rtk: 62-76% fewer tokens on the commands it covers (`git status` went 41 -> 10 tokens)
- pxpipe: requests 46-52% smaller once a session has some history (`pxpipe stats`)
- claude-token-efficient: not re-measured here; upstream says 21-38% cheaper cost-to-green depending on model

## Install

You need: Windows 10/11, [Node.js](https://nodejs.org) 22.7+ (24 LTS was used), `winget` (already on Windows), and Claude Code CLI and/or the desktop app signed in.

1. Grab the .zip (green **Code** button -> **Download ZIP**) or `git clone`.
2. Unzip anywhere.
3. PowerShell in that folder (cd C:\<download folder>):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then restart the Claude desktop app and/or open a new terminal. That's it.

Flags if you want less: `-SkipRtk`, `-SkipPxpipe`, `-NoDesktop` (rules + rtk + scripts, but leave the desktop app alone), `-NoHook` (skip the rtk hook), `-PxpipeVersion x.y.z`. `-Profile compressed|coding|analysis|agents` swaps in one of the upstream rules profiles instead of the default.

Linux / macOS (lightly tested, from Git Bash on the same box): `bash install.sh` does the same job (brew/curl for rtk, npm for pxpipe, `~/.local/bin/pxpipe-ctl.sh` + `claude-px`), same flags in `--kebab-case`.

## What the installer actually does

Roughly two minutes, and it says what it's doing as it goes:

1. `winget install` rtk + ripgrep
2. `npm install -g pxpipe-proxy`
3. copies the rules to `~/.claude/CLAUDE.md` and `~/.claude/RTK.md` (your old ones, if any, are kept as `.pre-token-stack.bak`)
4. adds the rtk `PreToolUse` hook to `~/.claude/settings.json` (via `rtk init -g`, then rewrites the file without a BOM because rtk chokes on one)
5. drops `pxpipe-ctl` and `claude-px` into `~/.local/bin` and puts that on your user PATH
6. `pxpipe-ctl desktop-on`: adds `HTTPS_PROXY` / `NO_PROXY` / `NODE_EXTRA_CA_CERTS` plus a `SessionStart` hook to `settings.json` so every Claude Code process (terminal or desktop) routes through pxpipe automatically
7. starts pxpipe (:47821) and warpd (:47822) and runs a smoke test

Nothing machine-wide changes: no system proxy, no cert in the Windows store, no service. It's all inside `~/.claude/settings.json` and `~/.local/bin`.

## Day to day

Just use Claude like before. Things to poke at:

```
pxpipe-ctl status        who's running, always-on state, tokens saved (24h / 7d / all), autostart
pxpipe-ctl doctor        health check of all three layers; -Fix repairs what it can
pxpipe-ctl dashboard     opens http://127.0.0.1:47821/  (live requests, saved %, images)
rtk gain                 rtk's savings ledger; --history for per-command
pxpipe-ctl desktop-off   turn the always-on routing off (settings.json edit, restart the app)
pxpipe-ctl restart       if a session complains it can't reach the API (also happens on its own: warpd fails open and restarts pxpipe)
pxpipe-ctl update        npm update pxpipe + winget upgrade rtk, restart
pxpipe-ctl clean         drop rotated logs, trim events.jsonl to 30 days
pxpipe-ctl config        list/get/set/unset PXPIPE_* knobs in ~/.pxpipe/daemon.env
pxpipe-ctl autostart on  start warpd+pxpipe at logon (scheduled task) so the first session isn't slow
```

`claude-px` still exists (`pxpipe warp -- claude` with a dashboard hint) but with always-on you don't really need it.

Failure mode: if pxpipe dies, warpd notices and passes requests straight to Anthropic (uncompressed) while it restarts pxpipe with backoff. If warpd itself dies, the app can't reach the API until `pxpipe-ctl start` (any new session runs that automatically via the SessionStart hook).

## Is it working?

- Open the dashboard, ask Claude something: the request counter goes up. That's the desktop app or terminal, both.
- Ask Claude to run `git status`: the output comes back in rtk's compact format and `rtk gain --history` shows a row.
- `claude -p "quote the first line of your global CLAUDE.md"` returns the rules header.

## Undo

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1               # settings, hooks, scripts, rules; leaves rtk/pxpipe installed
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveTools  # also uninstalls rtk + pxpipe and deletes ~\.pxpipe
```

Backups the installer left: `~/.claude/settings.json.pre-pxpipe.bak`, `~/.claude/CLAUDE.md.pre-token-stack.bak`, `~/.claude/RTK.md.pre-token-stack.bak`.

## Good to know

- Everything is loopback (127.0.0.1). warpd only decrypts `api.anthropic.com`, only diverts `/v1/messages*`, and blind-tunnels the rest. Its CA lives in `~/.pxpipe/warp-ca.pem` and is trusted only by processes given `NODE_EXTRA_CA_CERTS`. See pxpipe's own `upstream/pxpipe/docs/SECURITY_MODEL.md` for its side.
- Tool shells started by Claude inherit `HTTPS_PROXY`, so `git`/`curl`/`npm` *run by Claude* pass through warpd's tunnel while it's up. Your own terminals are untouched.
- If the daemons die mid-session, API calls fail until `pxpipe-ctl start`. Every new session auto-starts them; a bare `pxpipe-ctl start` from any terminal also works.
- Windows PowerShell 5.1's default policy blocks `.ps1` scripts, so all commands are `.cmd` wrappers that pass `-ExecutionPolicy Bypass`.

## What's where

```
install.ps1 / uninstall.ps1   Windows;  install.sh  Linux/macOS
stack/CLAUDE.md          global rules (upstream's universal file + condensed coding profile + @RTK.md)
stack/RTK.md             rtk's cheat-sheet for the model (what rtk init generates)
stack/bin/               pxpipe-ctl, claude-px (.cmd + lib/*.ps1), pxpipe-ctl.sh (bash port)
stack/bin/lib/warpd/     fixed-port CONNECT proxy: 4 files vendored from pxpipe + the warpd.ts wrapper (fail-open, supervises pxpipe, /healthz)
docs/HOW-IT-WORKS.md     the long version, including the desktop-app detour
upstream/                full source: pxpipe (main, 0.13.1), claude-token-efficient (main), rtk (develop) + build notes
NOTICE.md                who wrote what and under which license
```

Glue is MIT (see `LICENSE`). Everything under `upstream/` and the four vendored `warpd` files keep their original licenses.

## Thanks

teamchong for pxpipe (and for making warp mode small enough to lift), drona23 for claude-token-efficient, Patrick Szymkowiak for rtk. Go star those.
