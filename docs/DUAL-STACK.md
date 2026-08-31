# Dual-stack boundaries

Version 0.6.4 keeps ChatGPT Work on native Codex and installs four low-latency
hooks. Automatic whole-turn Lean routing is disabled.

| Surface | Automatic reduction | Manual/diagnostic path | Authentication | Local port |
|---|---|---|---|---|
| Claude | CLAUDE.md, RTK, pxpipe/warpd | Claude-owned workflow | Claude-owned | 47821, 47822 |
| ChatGPT Work/Codex | Native turns, AGENTS.md, turn budget, native RTK, native receipts, compact policy | `ncc lean` manual diagnostics, guarded A/B | ChatGPT subscription | 47831 dashboard only |
| Combined monitor | Sanitized counters from both sides | n/a | none | 47823 |

Port 47831 is a read-only dashboard, never a model proxy. The OpenAI stack
opens no network model listener and has no API-key transport. The desktop
supported hooks communicate with Codex locally over stdio.

The all-in-one installer configures both providers. `setup.cmd install-openai`
changes only the OpenAI package, project-owned Codex hooks, managed AGENTS.md
block, and OpenAI-local settings. It does not restart or reconfigure Claude,
pxpipe, warpd, or the shared monitor.

Conversely, `setup.cmd install-claude` changes only the receipt-owned Claude
rules, RTK integration, pxpipe/warpd launchers, Claude-local settings, and
Claude monitor path. It does not add Codex hooks, change AGENTS.md, or alter
OpenAI-local settings.

Model selection remains provider-owned. Claude uses its existing model
configuration. ChatGPT Work/Codex keeps the model and reasoning effort selected
in the app; the compiler does not choose a replacement model.

The local state roots, hook definitions, evidence, receipts, and rollback
ownership are separate. Uninstallers remove only exact project-owned entries
and preserve later user edits and unrelated hooks.

`setup.cmd uninstall-claude` and `setup.cmd uninstall-openai` remove either
side independently; `setup.cmd uninstall-all` removes both. Shared RTK/pxpipe
tools and local measurements are preserved by default. `-RemoveTools` removes
only dependencies proven to be installer-owned and no longer required by the
other side.
