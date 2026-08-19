# How claude-token-stack works

Built and verified 2026-08-18 on Windows 10 (19045), Claude Code CLI 2.1.222, Claude desktop app 1.32352 (bundled engine 2.1.229), Node 24.18, npm 11, rtk 0.45.0, pxpipe-proxy 0.13.1. Paths below use `~` for `%USERPROFILE%`.

## 1. The three layers and where they sit

```
 you  ->  Claude Code (CLI or desktop app engine)
              |  PreToolUse hook: "rtk hook claude"           <- Layer 1  rtk        (tool OUTPUT smaller)
              |  ~/.claude/CLAUDE.md (+ @RTK.md)               <- Layer 2  rules      (model OUTPUT smaller)
              |  HTTPS_PROXY=127.0.0.1:47822 (settings.json env)
              v
          warpd :47822   CONNECT proxy; decrypts only api.anthropic.com, only /v1/messages*
              v
          pxpipe :47821  rewrites request: old history + big tool docs -> images   <- Layer 3  pxpipe  (CONTEXT smaller)
              v
          https://api.anthropic.com/v1/messages   (response streamed back untouched)
```

Each layer attacks a different part of the bill: rtk shrinks what tools print into the context, the rules shrink what the model prints, pxpipe shrinks what is re-sent every turn. They do not overlap and none of them needs the others.

## 2. Layer 1 - rtk (Rust Token Killer)

- Installed from winget (`rtk-ai.rtk`) plus ripgrep (`BurntSushi.ripgrep.MSVC`, which rtk uses).
- `rtk init -g` adds a `PreToolUse` hook to `~/.claude/settings.json`:
  ```json
  { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "rtk hook claude" } ] } ] } }
  ```
  On every Bash tool call, Claude Code pipes the tool input JSON to `rtk hook claude`; rtk answers with an updated command (`git status` -> `rtk git status`) when it has a filter for it, otherwise passes it through. The model never sees the rewrite, only rtk's compact output. `rtk gain` / `rtk gain --history` show the ledger (measured here: `git status` 41 -> 10 tokens, 76%).
- `~/.claude/RTK.md` is rtk's own cheat-sheet for the model (which commands are covered, `rtk proxy <cmd>` to bypass filtering); `~/.claude/CLAUDE.md` pulls it in with the line `@RTK.md`.
- Gotcha found on the way: rtk's settings parser rejects a UTF-8 BOM. PowerShell 5.1's `Set-Content -Encoding UTF8` writes one; every script here writes settings.json with `[System.IO.File]::WriteAllText(..., New-Object System.Text.UTF8Encoding($false))`. Symptom if you get it wrong: `rtk hook claude` reports "No hook installed".
- The desktop app loads user settings too, so the hook is active there as well (verified: `git status` inside a desktop session comes back in rtk's format and shows up in `rtk gain --history`).

## 3. Layer 2 - claude-token-efficient rules

`stack/CLAUDE.md` is assembled from claude-token-efficient and installed as `~/.claude/CLAUDE.md`:

- `## Approach` = upstream's universal `CLAUDE.md`, verbatim (that is where "no emojis or em-dashes" and "do not guess APIs, versions, flags, commit SHAs" come from - the biggest real-world token sink is a wrong guess followed by a retry)
- `## Output`, `## Code`, `## Review / Debug` = upstream `profiles/CLAUDE.coding.md`, condensed (its Output, Code, Review, Debugging and Simple Formatting sections merged, a few lines dropped)
- `## Override` ("explicit user instructions always win") and the `@RTK.md` include line at the end are ours

Project-level `CLAUDE.md` files still apply on top - this only replaces the *global* file (the installer backs up any existing one as `CLAUDE.md.pre-token-stack.bak`). Upstream's other profiles (compressed, analysis, agents...) are in `upstream/claude-token-efficient/profiles/` if you want a different base; the compressed one is the aggressive option (upstream measured -62% output tokens on Opus) at the cost of the fabrication guards.

Verification is trivial: a fresh `claude -p "quote the first line of your global CLAUDE.md"` returns it.

## 4. Layer 3 - pxpipe

pxpipe is a local proxy for the Anthropic Messages API. For each request it takes the parts of the context that are big and static - older conversation turns, tool/skill descriptions - renders them to PNG in a fixed-width glyph atlas, and sends them as `image` content blocks with a short text index, keeping the recent turns as text. Image input is priced far below the equivalent text, so long sessions get 40-60% cheaper per request; the response is streamed back unchanged. It also runs a dashboard (http://127.0.0.1:47821/), writes `~/.pxpipe/proxy.log` and `~/.pxpipe/events.jsonl`, and `pxpipe stats` reports offline. Its design, security model and evals are in `upstream/pxpipe/docs/`.

pxpipe has two ways to get traffic:

1. **Base-URL mode**: run `pxpipe` and point the client at it with `ANTHROPIC_BASE_URL=http://127.0.0.1:47821`. Simple; works for terminal `claude`.
2. **Warp mode** (`pxpipe warp -- <cmd>`): pxpipe starts a child-only CONNECT proxy on a random port, generates a private CA (`~/.pxpipe/warp-ca.pem`), and launches `<cmd>` with `HTTPS_PROXY` + `NODE_EXTRA_CA_CERTS` set. The child talks to `https://api.anthropic.com` as normal; the CONNECT proxy terminates TLS only for that host, diverts `/v1/messages*` into the pxpipe pipeline, and blind-tunnels everything else. It dies with the child.

`stack/bin/lib/claude-px.ps1` (+ `.cmd`) is a launcher for mode 2 - `claude-px` is `pxpipe warp -- claude` with a dashboard hint. Still works, now redundant given section 5.

## 5. Getting pxpipe under the desktop app (the part that took the day)

**What was tried first and why it failed.** Claude Code applies the `env` block of `~/.claude/settings.json` to its own process at startup, so `"env": {"ANTHROPIC_BASE_URL": "http://127.0.0.1:47821"}` routes every *terminal* session through pxpipe with no launcher. The desktop app never moved: its request counter stayed flat and a tool shell inside a desktop session showed `ANTHROPIC_BASE_URL=https://api.anthropic.com`.

**Why.** The desktop app (MSIX `Claude_pzs8sxrjxfjjc`) runs its own bundled engine, `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<version>\claude.exe`, through the Agent SDK. Its command line includes `--setting-sources=user,project,local` (so settings.json IS read - the rtk hook proves it) but the app also sets `ANTHROPIC_BASE_URL=https://api.anthropic.com` in the engine's environment. Settings `env` does not override a variable the parent already set. There is no proxy or base-URL knob in the app's `config.json` / `claude_desktop_config.json`.

**What does get through.** The engine's HTTP stack honors `HTTPS_PROXY` and `NODE_EXTRA_CA_CERTS`, and those the app does *not* pre-set - so settings.json can supply them. That is exactly the pair warp mode uses; the only obstacle was warp's lifecycle (random port, child-scoped).

**warpd.** `stack/bin/lib/warpd/` is warp mode as a fixed-port daemon:

- `ca.ts`, `connect.ts`, `route.ts`, `der.ts` - vendored verbatim from `upstream/pxpipe/src/warp/` (MIT; import specifiers changed to `.ts`, nothing else)
- `warpd.ts` - ~60 lines: `createCertificateAuthority()` (reuses `~/.pxpipe/warp-ca.pem`), `createWarpHandlers({ routes: [ api.anthropic.com/v1/messages* -> http://127.0.0.1:47821 ] })`, `server.listen(47822, "127.0.0.1")`, prints the CA path
- runs under `node --experimental-transform-types` (needed because `ca.ts` uses TypeScript constructor parameter properties, which Node's default type-stripping does not handle)

`pxpipe-ctl desktop-on` then writes to `~/.claude/settings.json` (backup: `settings.json.pre-pxpipe.bak`):

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

`ANTHROPIC_BASE_URL` is left alone, so Claude Code's first-party checks stay green. The SessionStart hook starts pxpipe and warpd if they are not listening (silent, ~0.5 s when they are), so a reboot does not leave you with a dead proxy. Both hooks and the env block are merged into whatever else is in settings.json; `desktop-off` removes exactly those keys and the older `ANTHROPIC_BASE_URL` key if present.

**Verification.** (1) The desktop engine binary itself (`...\claude-code\2.1.229\claude.exe -p "..."`) run with `ANTHROPIC_BASE_URL=https://api.anthropic.com` pinned in its environment and *no* proxy variables in the shell: request arrived in pxpipe via warpd, compressed. (2) The live desktop session that made the change re-routed itself without a restart (Claude Code hot-reloads settings.json): request counter 6 -> 11 within a few turns, `pxpipe stats` 46% saved, per-turn latency 7-13 s with prompt-cache hits.

**Scope and security.** Only Claude Code processes see these variables (settings.json, not the Windows environment). The private CA is trusted only by processes given `NODE_EXTRA_CA_CERTS`; nothing is added to the Windows certificate store. warpd decrypts only `api.anthropic.com` and only forwards `/v1/messages*` into pxpipe; other hosts (claude.ai connectors, MCP endpoints, telemetry) are blind TCP tunnels; WebSocket upgrades to api.anthropic.com are spliced through. `NO_PROXY` keeps loopback (local MCP servers, the pxpipe dashboard) direct; local `http://` MCP servers are unaffected anyway since only `HTTPS_PROXY` is set.

**Side effects.** Tool shells inside a Claude session inherit `HTTPS_PROXY`, so `git`/`curl`/`npm` run *by Claude* go through warpd's blind tunnel - transparent while it is up. The desktop app's small side calls (auto-mode classifier, title generation) also go through the pipe; they fall below pxpipe's compression threshold and pass untouched, which is why `requests` grows faster than `compressed_requests` on the dashboard.

**Failure modes.** Daemon dies mid-session -> API calls fail until `pxpipe-ctl start` (from any terminal; the `.cmd` wrapper works under the default Restricted PowerShell policy). Want it gone -> `pxpipe-ctl desktop-off` + restart the desktop app.

## 6. pxpipe-ctl reference

`stack/bin/pxpipe-ctl.cmd` -> `lib/pxpipe-ctl.ps1` (`.cmd` so it runs under any execution policy). Fixed ports: pxpipe 47821, warpd 47822. State under `~/.pxpipe/` (`proxy.log`, `warpd.err.log`, `events.jsonl`, `warp-ca.pem`).

| Command | Effect |
|---|---|
| `start [-Quiet]` | start pxpipe and warpd if not listening (used by the SessionStart hook) |
| `stop` / `restart` | stop / restart both |
| `status` | daemons, PIDs, dashboard URL, always-on state |
| `desktop-on` / `desktop-off` | write / remove the env block + SessionStart hook in settings.json (UTF-8, no BOM, backup kept) |
| `dashboard` | open http://127.0.0.1:47821/ |
| `logs` | tail `proxy.log` |

## 7. Numbers from this machine

- rtk: 62.8% overall on the first four covered commands; `git status` 76%.
- pxpipe (desktop session, ~110k chars of history -> 42-45 images): 46-52% saved per request; first turn after a switch 30-60 s (render + cache miss), then 7-13 s with cache hits.
- claude-token-efficient: not benchmarked locally; upstream reports 21-38% cheaper cost-to-green depending on model.

## 8. Things that could still be better

- rtk covers a fixed set of commands; anything else passes through unfiltered (`rtk gain --history` shows 0% for those).
- warpd is Windows-tested only; the TypeScript itself is portable, the control script is PowerShell.
- No Linux/macOS installer here. On those, `pxpipe warp -- claude` or the settings.json env approach with a small warpd wrapper should work the same way; untested.
- pxpipe's image rendering is lossy for very old context by design; if a task needs exact recall of something far back, ask the model to re-read the source file rather than trust its memory of the image.
