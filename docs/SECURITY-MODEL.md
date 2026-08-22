# Security model

> **0.6.2 supported mode:** the desktop Lean bridge is not installed and normal
> Work traffic is not proxied. UserPromptSubmit, PreToolUse, PostToolUse, and
> SessionStart are enabled as lightweight local hooks.

## Trust boundary

The OpenAI stack runs locally under the current user. It does not request an
API key, proxy the provider connection, make a usage-billed API request, or
send telemetry to this project. The supported turn budget adds developer context
to the native turn; it does not block, reroute, or start another model. Codex
requires the user to review and trust executable hooks after installation or
changes.

The opt-in hook A/B uses Codex's documented one-invocation trust-bypass flag
inside disposable test homes. That flag does not persist approval. It exists
only to evaluate the exact hook code and is not used for ordinary Work tasks.

The release ZIP contains source only. It contains no executable, DLL, native
module, font, image, or bundled runtime. The supported installer does not
compile or register the historical launcher. Installers may obtain declared dependencies through system package managers;
users should inspect the source and warnings before running them.

## Sensitive data

The EvidenceVault stores exact replaced tool output locally so a receipt is
reversible. Tool output can contain secrets, source code, paths, or personal
data. Protect `%LOCALAPPDATA%\NativeContextCompiler` with normal account
permissions, do not publish it, and remove it explicitly when no longer
needed.

The supported path does not persist prompt or answer text. Historical bridge
data from previous opt-in experiments may still exist locally until removed.

Monitor telemetry contains counters, timestamps, tool/filter categories,
command-family fingerprints, and A/B verdicts. It does not store prompts,
commands, answer bodies, credentials, or evidence content.

## Hook behavior

- `PreToolUse` may replace only supported Bash input returned by RTK.
- `PostToolUse` may replace oversized model-visible results with a receipt.
- `SessionStart` with `source: compact` may re-add only the short operating policy.
- `UserPromptSubmit` may add concise operating context without blocking the turn;
  explicit detail requests preserve requested depth and `!native` bypasses it.
- All paths fail open on malformed input, missing RTK, timeout, local I/O
  error, or disabled settings.
- Unrelated Codex hooks and user-authored AGENTS.md content are preserved.

Codex 0.149 may render a replaced PostToolUse result with a blocked/failed
wrapper. This does not undo or rerun the command; the receipt carries the real
exit status. Treat the integration as experimental because future Codex hook
semantics can change.

## Surface limitations

The stack targets local ChatGPT Work/Codex tasks using subscription
authentication. It does not cover ordinary Chat or cloud tasks. Work images,
skills, plugins, and other non-text inputs continue on native Work.
Claude pxpipe remains isolated on the Claude path.

## Rollback

Installers back up changed hook and guidance files and record the previous
user-level `CODEX_CLI_PATH`. Uninstall restores that value and removes exact
project-owned hook groups and the managed AGENTS.md block. Bridge replies,
evidence, settings, and metrics remain unless the user requests data removal.
