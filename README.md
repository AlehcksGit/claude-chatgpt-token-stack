# claude-token-stack

Three open-source token savers for Claude Code, wired together so they all run at once - in the terminal **and inside the Claude desktop app** - with a one-shot Windows installer and full upstream source included.

| Layer | What it cuts | Project | Author | License |
|---|---|---|---|---|
| 1 | CLI tool output (git, ls, cargo, npm, tests...) | [rtk - Rust Token Killer](https://github.com/rtk-ai/rtk) | Patrick Szymkowiak ([rtk-ai](https://github.com/rtk-ai)) | Apache-2.0 |
| 2 | Model verbosity (rules that stop preamble, boilerplate, sycophancy) | [claude-token-efficient](https://github.com/drona23/claude-token-efficient) | [drona23](https://github.com/drona23) | MIT |
| 3 | Context size on the wire (renders old history/tool docs to images) | [pxpipe](https://github.com/teamchong/pxpipe) | [teamchong](https://github.com/teamchong) and the claude-image-proxy contributors | MIT |

All credit for the savings goes to those three projects. This repo is the glue: an installer, a small daemon (`warpd`) that lets pxpipe reach the desktop app, a control script, tuned rule files, and the write-up of how it fits together. Not affiliated with Anthropic.

Measured on the machine this was built on (Windows 10, Claude Code 2.1.222 CLI / 2.1.229 desktop engine, Node 24, rtk 0.45.0, pxpipe 0.13.1):

- rtk: 62-76% fewer tokens on covered commands (`git status` 41 -> 10 tokens)
- pxpipe: 46-52% smaller requests once a session has history (`pxpipe stats`)
- claude-token-efficient: upstream benchmark reports 21-38% cheaper cost-to-green depending on model; not re-measured here

## Quick install (Windows)

Prerequisites: Windows 10/11, [Node.js](https://nodejs.org) 22.7+ (24 LTS recommended), `winget` (ships with Windows), Claude Code CLI and/or the Claude desktop app already signed in.

1. Download this repo as a .zip (green **Code** button -> **Download ZIP**) or `git clone` it.
2. Extract it anywhere.
3. Open PowerShell in the extracted folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

That installs rtk + ripgrep (winget), pxpipe (npm), copies the rules and scripts, adds `~\.local\bin` to your PATH, starts pxpipe + warpd, and switches on always-on routing. Then:

4. Restart the Claude desktop app and open a fresh terminal.

That is it. Nothing about how you use Claude changes. Everything is a normal file under your user profile; the [uninstaller](#uninstall--rollback) puts it all back.

Options: `-SkipRtk`, `-SkipPxpipe`, `-NoDesktop` (install but leave the always-on switch off), `-PxpipeVersion x.y.z`.

Offline note: the installer pulls rtk (winget) and pxpipe (npm) from their package registries. Full source of all three projects is in [`upstream/`](upstream/) if you would rather build them yourself - see `upstream/README.md`.

## Check it is working

```powershell
pxpipe-ctl status        # pxpipe :47821 + warpd :47822 running, always-on: ON
rtk gain                 # rtk's own savings meter
start http://127.0.0.1:47821/    # pxpipe dashboard: request counter climbs with every Claude turn
```

Inside a Claude session, `git status` output arriving in rtk's compact form proves layer 1; Claude answering without preamble proves layer 2; the dashboard counter proves layer 3.

## Daily commands

| Command | Does |
|---|---|
| `pxpipe-ctl status` | show both daemons + whether always-on is enabled |
| `pxpipe-ctl start` / `stop` / `restart` | manage pxpipe + warpd |
| `pxpipe-ctl desktop-on` / `desktop-off` | toggle always-on routing (edits `~/.claude/settings.json`) |
| `pxpipe-ctl dashboard` / `logs` | open the dashboard / tail the proxy log |
| `pxpipe stats` | pxpipe's offline savings report |
| `rtk gain` / `rtk gain --history` | rtk savings, per command |
| `claude-px ...` | run one Claude session through pxpipe without always-on (older per-launch route; still works) |

## How it works (short version)

Full detail with the dead ends: [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

- **rtk** installs a Claude Code `PreToolUse` hook (`rtk hook claude`) that silently rewrites Bash tool calls (`git status` -> `rtk git status`), so the model sees rtk's compact output. `~/.claude/RTK.md` teaches the model the rtk commands; `~/.claude/CLAUDE.md` includes it with `@RTK.md`.
- **claude-token-efficient** is a set of global rules. `stack/CLAUDE.md` is its global profile, lightly tuned (no em-dashes, no emojis, copy-paste-safe code, verify before asserting), living at `~/.claude/CLAUDE.md`.
- **pxpipe** is a local HTTP proxy in front of `api.anthropic.com/v1/messages`. It rewrites each request so old conversation history and big tool descriptions are sent as rendered images instead of text (image tokens are far cheaper per character), then streams the response back unchanged. It also runs a dashboard on http://127.0.0.1:47821/.
- **The desktop-app problem.** Terminal `claude` can be pointed at pxpipe with `ANTHROPIC_BASE_URL`. The desktop app cannot: its bundled engine gets `ANTHROPIC_BASE_URL=https://api.anthropic.com` set by the app itself, and `settings.json` env cannot override a variable the parent already set. What the engine *does* honor from `settings.json` is `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`.
- **warpd** (this repo, `stack/bin/lib/warpd/`) is pxpipe's own "warp" mode - a CONNECT proxy that decrypts only `api.anthropic.com` with a private per-user CA and diverts only `/v1/messages*` into pxpipe - repackaged as a fixed-port daemon on `127.0.0.1:47822`. Its four core files are vendored verbatim from pxpipe (MIT). `pxpipe-ctl desktop-on` writes `HTTPS_PROXY`, `NO_PROXY`, `NODE_EXTRA_CA_CERTS` into `~/.claude/settings.json` (Claude Code processes only, nothing machine-wide, nothing in the Windows cert store) plus a `SessionStart` hook that starts both daemons if they are not running. Verified against the desktop app's own engine binary and then live in a desktop session.

## Uninstall / rollback

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1            # revert settings + scripts + rules, keep rtk/pxpipe binaries
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveTools   # also winget-uninstall rtk and npm-uninstall pxpipe
```

Panic switch without the repo: `pxpipe-ctl desktop-off`, then restart the desktop app. Backups the installer made: `~/.claude/settings.json.pre-pxpipe.bak`, `~/.claude/CLAUDE.md.pre-token-stack.bak`, `~/.claude/RTK.md.pre-token-stack.bak`.

## Trade-offs, honestly

- pxpipe's history-as-images is lossy by design and adds latency (measured 7-13 s per turn with cache hits; 30-60 s for the first turn after a long gap while it renders). If it ever gets in the way: `pxpipe-ctl desktop-off`.
- If pxpipe or warpd dies mid-session, Claude Code's API calls fail until `pxpipe-ctl start` (sessions auto-start them, so this is rare).
- Inside a Claude session, tool shells inherit `HTTPS_PROXY`, so git/curl/npm run *by Claude* tunnel through warpd (blind TCP for non-Anthropic hosts). Transparent while it is up. Local http:// MCP servers are unaffected.
- A third-party proxy sits between Claude Code and Anthropic. Everything is local (127.0.0.1) and open source; read `upstream/pxpipe/docs/SECURITY_MODEL.md` before deciding that is fine for you.

## Repo layout

```
install.ps1 / uninstall.ps1      one-shot installer / reverter (Windows)
stack/CLAUDE.md, RTK.md          global rule files installed to ~/.claude/
stack/bin/                       pxpipe-ctl.cmd, claude-px.cmd (+ lib/*.ps1)  -> ~/.local/bin/
stack/bin/lib/warpd/             fixed-port warp daemon (4 files vendored from pxpipe, MIT)
docs/HOW-IT-WORKS.md             full technical write-up incl. what did not work
upstream/pxpipe/                 pxpipe 0.13.1 source (teamchong, MIT)  - eval result dumps (1.4 GB) omitted
upstream/claude-token-efficient/ drona23, MIT
upstream/rtk/                    rtk develop-branch source (rtk-ai, Apache-2.0)
NOTICE.md                        third-party attributions
```

## License

The glue in this repo (installer, scripts, docs, `warpd.ts`) is MIT, see [LICENSE](LICENSE). Everything under `upstream/` and the vendored files under `stack/bin/lib/warpd/` keep their original licenses and copyright - see [NOTICE.md](NOTICE.md).
