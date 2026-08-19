# How it works (the long version)

Notes from the build, 2026-08-18. Windows 10 (19045), Claude Code CLI 2.1.222, Claude desktop app 1.32352 (bundled engine 2.1.229), Node 24.18, npm 11, rtk 0.45.0, pxpipe-proxy 0.13.1. `~` means `%USERPROFILE%`.

## 1. The picture

```
 you  ->  Claude Code (CLI or desktop app engine)
              |  PreToolUse hook: "rtk hook claude"           <- 1. rtk        (tool OUTPUT smaller)
              |  ~/.claude/CLAUDE.md (+ @RTK.md)               <- 2. rules      (model OUTPUT smaller)
              |  HTTPS_PROXY=127.0.0.1:47822 (settings.json env)
              v
          warpd :47822   CONNECT proxy; decrypts only api.anthropic.com, only /v1/messages*
              v
          pxpipe :47821  rewrites the request: old history + big tool docs -> images   <- 3. pxpipe  (CONTEXT smaller)
              v
          https://api.anthropic.com/v1/messages   (response streams back untouched)
```

Three different parts of the bill: rtk shrinks what tools dump into the context, the rules shrink what the model says, pxpipe shrinks what gets re-sent every single turn. They don't step on each other and none of them needs the other two - the installer flags let you pick.

## 2. rtk

- From winget (`rtk-ai.rtk`) plus ripgrep (`BurntSushi.ripgrep.MSVC`), which rtk uses under the hood.
- `rtk init -g` drops a `PreToolUse` hook into `~/.claude/settings.json`:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "rtk hook claude" } ] } ] } }
  ```
  On every Bash tool call Claude Code pipes the tool input to `rtk hook claude`; rtk hands back a rewritten command (`git status` -> `rtk git status`) when it knows the command, otherwise says pass. The model never sees the swap, just rtk's compact output. `rtk gain` / `rtk gain --history` is the ledger (`git status`: 41 -> 10 tokens, 76%).
- `~/.claude/RTK.md` is rtk's cheat-sheet for the model - what it covers, `rtk proxy <cmd>` to bypass. `~/.claude/CLAUDE.md` pulls it in with `@RTK.md`.
- The one trap: rtk's settings parser hates a UTF-8 BOM, and PowerShell 5.1's `Set-Content -Encoding UTF8` writes one. Every script here writes settings.json with `[System.IO.File]::WriteAllText(..., New-Object System.Text.UTF8Encoding($false))`. If you get "No hook installed" from `rtk hook claude`, that's why.
- The desktop app reads user settings too, so the hook fires there as well (checked: `git status` inside a desktop session comes back rtk-style and shows in `rtk gain --history`).

## 3. The rules file

`stack/CLAUDE.md` -> `~/.claude/CLAUDE.md`. It's stitched from claude-token-efficient:

- `## Approach` is upstream's universal `CLAUDE.md`, word for word. That's where "no emojis or em-dashes" and "do not guess APIs, versions, flags, commit SHAs" come from (a wrong guess plus a retry is the biggest real-world token sink there is).
- `## Output`, `## Code`, `## Review / Debug` are upstream's `profiles/CLAUDE.coding.md`, condensed - Output, Code, Review, Debugging and Simple Formatting folded together, a few lines dropped.
- `## Override` ("explicit user instructions always win") and the `@RTK.md` line at the end are ours.

Project-level `CLAUDE.md` files still stack on top; this only swaps the *global* one (old one saved as `CLAUDE.md.pre-token-stack.bak`). Other upstream profiles live in `upstream/claude-token-efficient/profiles/` - `compressed` is the aggressive one (upstream measured -62% output tokens on Opus) but drops the fabrication guards. `install.ps1 -Profile compressed|coding|analysis|agents` (or `install.sh --profile ...`) installs one of those verbatim plus the `@RTK.md` line, staged under `~/.claude/token-stack/`, instead of our combined default.

Checking it took: `claude -p "quote the first line of your global CLAUDE.md"`.

## 4. pxpipe

A local proxy for the Anthropic Messages API. Per request it takes the big, static bits of the context - older turns, tool/skill descriptions - draws them into PNGs with a fixed-width glyph atlas, and sends those as `image` blocks with a short text index, keeping the recent turns as text. Image input is way cheaper than the same text, so long sessions get 40-60% cheaper per request; the response streams back unchanged. Dashboard on http://127.0.0.1:47821/, logs in `~/.pxpipe/proxy.log` and `~/.pxpipe/events.jsonl`, `pxpipe stats` reads them offline. Design, security model and evals are in `upstream/pxpipe/docs/`.

Two ways to feed it:

1. **Base-URL mode**: run `pxpipe`, point the client at it with `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. Fine for terminal `claude`.
2. **Warp mode** (`pxpipe warp -- <cmd>`): pxpipe starts a child-only CONNECT proxy on a random port, makes a private CA (`~/.pxpipe/warp-ca.pem`), and launches `<cmd>` with `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` set. The child thinks it's talking to `https://api.anthropic.com`; the CONNECT proxy terminates TLS for that one host, diverts `/v1/messages*` into pxpipe, and blind-tunnels everything else. Dies with the child.

`stack/bin/lib/claude-px.ps1` (+ `.cmd`) is just mode 2 for `claude` with a dashboard hint. Still works, mostly redundant after section 5.

## 5. The desktop app detour

**First try, didn't work.** Claude Code applies the `env` block of `~/.claude/settings.json` to itself at startup, so `"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:47821"}` routes every *terminal* session through pxpipe with no launcher. The desktop app didn't budge: request counter flat, and a tool shell inside a desktop session showed `ANTHROPIC_BASE_URL=https://api.anthropic.com`.

**Why.** The desktop app (MSIX `Claude_pzs8sxrjxfjjc`) runs its own bundled engine, `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<version>\claude.exe`, through the Agent SDK. Its command line has `--setting-sources=user,project,local` (so settings.json IS read - the rtk hook proves it) but the app also pins `ANTHROPIC_BASE_URL=https://api.anthropic.com` in the engine's environment, and settings `env` doesn't override something the parent already set. No proxy or base-URL knob anywhere in the app's `config.json` / `claude_desktop_config.json` either.

**What does get through.** The engine's HTTP stack honors `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, and the app does *not* pre-set those - so settings.json can. That's exactly the pair warp mode uses; the only problem was warp's lifecycle (random port, tied to a child).

**So: warpd.** `stack/bin/lib/warpd/` is warp mode as a fixed-port daemon:

- `ca.ts`, `connect.ts`, `route.ts`, `der.ts` - lifted verbatim from `upstream/pxpipe/src/warp/` (MIT; import specifiers changed to `.ts`, nothing else)
- `warpd.ts` - ~60 lines: `createCertificateAuthority()` (reuses `~/.pxpipe/warp-ca.pem`), `createWarpHandlers({ routes: [ api.anthropic.com/v1/messages* -> http://127.0.0.1:47821 ] })`, `server.listen(47822, "127.0.0.1")`, prints the CA path
- runs under `node --experimental-transform-types` because `ca.ts` uses TypeScript constructor parameter properties, which Node's plain type-stripping won't take

`pxpipe-ctl desktop-on` then writes this into `~/.claude/settings.json` (backup: `settings.json.pre-pxpipe.bak`):

```json
{
  "env": {
    "HTTPS_PROXY": "http://127.0.0.1:47822",
    "NO_PROXY": "127.0.0.1,localhost",
    "NODE_EXTRA_CA_CERTS": "C:\\Users\\<you>\\.pxpipe\\warp-ca.pem"
  },
  "hooks": {
    "SessionStart": [ { "hooks": [ { "type": "command",
      "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"C:/Users/<you>/.local/bin/lib/pxpipe-ctl.ps1\" start -Quiet" } ] } ]
  }
}
```

`ANTHROPIC_BASE_URL` is left alone so Claude Code's own first-party checks stay happy. The SessionStart hook starts pxpipe and warpd if they aren't listening (silent, ~0.5 s when they are), so a reboot doesn't leave you with a dead proxy. Both merge into whatever else is in settings.json; `desktop-off` removes exactly those keys (and an old `ANTHROPIC_BASE_URL` key if one is there).

**Proof it works.** (1) Ran the desktop engine binary itself (`...\claude-code\2.1.229\claude.exe -p "..."`) with `ANTHROPIC_BASE_URL=https://api.anthropic.com` pinned in its env and *no* proxy vars in the shell: request showed up in pxpipe via warpd, compressed. (2) The live desktop session that made the change re-routed itself with no restart (Claude Code hot-reloads settings.json): counter 6 -> 11 within a few turns, `pxpipe stats` 46% saved, 7-13 s per turn with cache hits.

**Scope / security.** Only Claude Code processes see those variables (settings.json, not the Windows environment). The private CA is trusted only by processes handed `NODE_EXTRA_CA_CERTS`; nothing goes into the Windows cert store. warpd decrypts only `api.anthropic.com` and only forwards `/v1/messages*` into pxpipe; other hosts (claude.ai connectors, MCP endpoints, telemetry) are blind TCP tunnels; WebSocket upgrades to api.anthropic.com are spliced through. `NO_PROXY` keeps loopback (local MCP servers, the dashboard) direct; local `http://` MCP servers weren't affected anyway since only `HTTPS_PROXY` is set.

**Side effects.** Tool shells inside a Claude session inherit `HTTPS_PROXY`, so `git`/`curl`/`npm` *run by Claude* go through warpd's blind tunnel - invisible while it's up. The desktop app's small side calls (auto-mode classifier, title generation) also go through the pipe; they're under pxpipe's compression threshold and pass untouched, which is why `requests` climbs faster than `compressed_requests` on the dashboard.

**When it breaks.** Daemon dies mid-session -> API calls fail until `pxpipe-ctl start` (from any terminal; the `.cmd` wrapper works under the default Restricted PowerShell policy). Want out -> `pxpipe-ctl desktop-off` + restart the app.

## 6. pxpipe-ctl

`stack/bin/pxpipe-ctl.cmd` -> `lib/pxpipe-ctl.ps1` (`.cmd` so it runs under any execution policy). Fixed ports: pxpipe 47821, warpd 47822. State under `~/.pxpipe/` (`proxy.log`, `warpd.err.log`, `events.jsonl`, `warp-ca.pem`).

| Command | Does |
|---|---|
| `setup` | the question/answer front end (`setup.cmd` in the repo): shows every piece with its state and path, add / remove / toggle one at a time, or the 3-question quick install. Runs from the copy of the scripts staged in `~/.claude/token-stack/src` so it works after the zip is gone. Only ever calls install.ps1 / uninstall.ps1 / pxpipe-ctl |
| `start [-Quiet]` | start pxpipe, warpd and the monitor if not listening (what the SessionStart hook calls; the monitor is best-effort) |
| `stop` / `restart` | stop / restart all three |
| `status` | daemons, PIDs, dashboard URL, always-on state, savings (24h / 7d / all-time from `events.jsonl` + `rtk gain`), autostart state |
| `doctor [-Fix]` | checks node/rtk/pxpipe/warpd/hook/rules/CA/settings; `-Fix` applies safe repairs (start daemons, re-run desktop-on, `rtk init -g`) |
| `desktop-on` / `desktop-off` | write / remove the env block + SessionStart hook in settings.json (UTF-8, no BOM, backup kept) |
| `dashboard` | open http://127.0.0.1:47821/ (pxpipe's own page) |
| `monitor [open|stop]` | the all-in-one page on http://127.0.0.1:47823/ (section 7) |
| `logs [-All]` | tail `proxy.log` + warpd logs; logs rotate on every start (`.1 .2 .3` kept) |
| `clean [-All]` | drop rotated logs, trim `events.jsonl` to 30 days (`-All`: delete it), clear >5 MB logs while stopped |
| `update` | `npm i -g pxpipe-proxy@latest` + `winget upgrade rtk-ai.rtk`, then restart |
| `config list/get/set/unset` | persistent daemon env in `~/.pxpipe/daemon.env`, applied to pxpipe + warpd on start (e.g. `config set PXPIPE_MODELS off`) |
| `autostart on/off/status` | Windows logon task via `schtasks` (`pxpipe-ctl.sh`: systemd user unit or launchd agent) |

warpd itself (`stack/bin/lib/warpd/warpd.ts`) supervises pxpipe: if `/healthz` on 47821 stops answering it restarts pxpipe with backoff (1 s -> 30 s) and, while pxpipe is down, forwards `/v1/messages` straight to `api.anthropic.com` uncompressed rather than failing the request. `PXPIPE_WARP_PORT`, `PXPIPE_PORT`, `PXPIPE_CLI`, `PXPIPE_LOG_OUT/ERR` are the knobs.

## 7. The monitor (:47823)

`stack/bin/lib/monitor.js`, plain Node, no dependencies, one page, refreshes every 5 s. It exists to answer the question the three separate dashboards can't: *is each layer actually paying for itself right now?*

What it reads:

- pxpipe `/stats` and `~/.pxpipe/events.jsonl` (the last 8 MB) for per-request `baseline_tokens` vs `actual_tokens`, images sent, transform ms, reason
- warpd `/healthz` (mode divert/passthrough, supervisor restarts, uptime)
- `rtk gain --json` + `~/.claude/settings.json` (hook present?) for layer 1
- `~/.claude/CLAUDE.md` + `RTK.md` for layer 2 (present, imports, size)

Verdicts on the cards: pxpipe = `saving` / `check` (30%+ of requests negative) / `COSTING` (24h net negative) / `no data`; warpd = `compressing` / `passthrough (fail-open)`; rtk = `saving` / `idle` / `no hook`; rules = `active` / `partial` / `missing`. The pxpipe card also prints the row that matters most: **24h costing more than saving** - how many requests came back with `actual > baseline` and how many tokens that lost in total. On this box after a day: 3 requests out of 403, 301 tokens lost against 148.9M saved. Those three were tiny Haiku classifier calls where the image overhead was bigger than the text it replaced; pxpipe already passes most of them through untouched.

The ledger at the bottom is per-request: time, model, baseline, actual (already includes the image tokens), saved %, images, transform ms, total ms, reason (`collapsed` / `passthrough` / `error`). It's meant for a glance, not a spreadsheet.

Cost the monitor adds: one Node process, ~30 MB, reads files on a timer. It doesn't sit in the request path at all, so it can never make a request slower or break one.

## 8. Numbers from this box

- rtk: 62.8% overall on the first four covered commands; `git status` 76%.
- pxpipe (desktop session, ~110k chars of history -> 42-45 images): 46-52% saved per request; first turn after a switch 30-60 s (render + cache miss), then 7-13 s with cache hits.
- pxpipe, a day later (long desktop session, ~690k baseline tokens -> 53 images): 84-86% per request, 80.8% net over 24 h / 403 requests, 3 requests negative (301 tokens). ~1.4 s render per request. From the monitor.
- claude-token-efficient: not benchmarked locally; upstream says 21-38% cheaper cost-to-green depending on model.

## 9. Rough edges

- rtk covers a fixed list of commands; the rest pass through unfiltered (`rtk gain --history` shows 0% for those).
- warpd is only battle-tested on Windows. The TypeScript is portable; `stack/bin/pxpipe-ctl.sh` + `install.sh` are the Linux/macOS port (start/stop/status/health/doctor/savings/desktop-on|off/config/autostart via systemd user unit or launchd plist). They were exercised from Git Bash on the Windows box, not on a real Linux/mac install yet.
- pxpipe's image rendering is lossy for very old context on purpose. Exact identifiers survive (pxpipe appends a plain-text fact sheet of paths/hashes/versions/ids next to every image and tells the model to quote from it), prose can get paraphrased. If a task needs exact recall of something far back, have the model re-read the source file instead of trusting its memory of the picture.
- pxpipe adds ~1.4 s of render time per request on a long session (`xform ms` on the monitor). It's a latency cost, not a token cost, and it disappears when the request is small enough to pass through.
- The rules layer can't be measured at runtime (no A/B in one session), so its card only says active/missing. Upstream's benchmark is the number to trust for that one.
- Only layer 2 reaches the claude.ai chat, and only by pasting `stack/chat-preferences.md` into your preferences (`setup.cmd` -> 7 puts it on the clipboard and opens the settings page; there is nothing to detect, so setup always shows it as "manual"). There's no proxy trick for the chat and we're not going to try one.
- Built in one sitting with Claude driving; expect the odd sharp corner. Issues welcome.
