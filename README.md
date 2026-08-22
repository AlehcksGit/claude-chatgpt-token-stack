# Claude–ChatGPT Token Stack

Use less context on routine noise while keeping Claude and ChatGPT Work/Codex feeling like the apps you already use.

> **Personal-use project:** the original integration code is licensed only to individuals for personal, non-commercial use. Company, organization, government, business-workflow, redistribution, and hosted-service use are not permitted. Third-party components keep their original licenses. Please read [LICENSE](LICENSE) before downloading or installing.

Current release: **0.6.2** · Windows 10/11

## The short version

This project grew out of a simple frustration: useful AI work can burn a lot of context on giant command results, repetitive narration, images, and other material that does not need to be sent back in full every time.

The stack trims that waste locally. It does not replace either app, add another paid API, or ask you to work in a special chat window. Install the parts you want, restart the relevant app, and keep working normally.

The Claude and OpenAI sides are separate. Installing only the OpenAI side does not modify or restart Claude, pxpipe, warpd, the shared monitor, or an active Claude/UE5 workflow.

## What it does

### Claude

The established Claude setup is unchanged:

- `CLAUDE.md` encourages concise, useful responses instead of narrating every small action.
- RTK reduces supported CLI and MCP output before it becomes conversation context.
- pxpipe and warpd handle the image-compression path.

### ChatGPT Work/Codex

The OpenAI side uses four small native Codex hooks and a managed section in `~/.codex/AGENTS.md`:

- Before a supported shell command runs, RTK can rewrite it into a quieter equivalent. Unsupported commands pass through untouched.
- After a tool returns a very large result, Native Context Compiler gives Codex a compact receipt and keeps the exact hook-visible result locally.
- Codex can search or retrieve just the needed slice of that saved evidence instead of loading all of it again.
- Routine turns get a light reminder to stay focused. Requests for a deep dive, tutorial, audit, or exhaustive answer are left alone.
- After Codex compacts a long task, the concise working rules are restored automatically.

If a hook or RTK cannot safely handle something, it fails open and the original command or result continues normally.

## What it does not do

- It does not cover ordinary ChatGPT **Chat** conversations. The OpenAI tools are for local **Work/Codex** tasks.
- It does not cover remote/cloud tasks or API-key traffic.
- It does not start an extra usage-billed model call.
- It does not change the model or reasoning effort selected in the app when Codex exposes those settings.
- The old whole-turn Lean bridge is disabled because the extra latency was not worth it. Its launcher and `CODEX_CLI_PATH` override are not installed.

The OpenAI side assumes ChatGPT Pro or an eligible higher-tier workspace subscription.

## Install

You will need Windows 10 or 11, Node.js 22.7+ or 24.x, and ChatGPT/Codex desktop or CLI. Installing the Claude side also requires the normal Claude prerequisites.

Install everything:

```powershell
.\setup.cmd install-all
```

Install only the OpenAI side:

```powershell
.\setup.cmd install-openai
```

Afterward:

1. Restart ChatGPT/Codex.
2. Open `/hooks` in a local Work task.
3. Review and trust the four **Native Context Compiler** hooks.
4. Confirm that `/hooks` shows **Active 4, Review 0**.

Codex owns hook approval, so the installer cannot quietly trust executable hooks for you. A later hook change may require approval again.

The installer preserves unrelated hooks, model settings, plugins, and anything you wrote outside the project-owned section of `AGENTS.md`. It also creates backups before changing those files.

## Check that it is working

Start with:

```powershell
ncc status
```

The local dashboards are also useful:

| Address | What it shows |
|---|---|
| `http://127.0.0.1:47821/` | Claude pxpipe |
| `http://127.0.0.1:47822/healthz` | Claude warpd health |
| `http://127.0.0.1:47823/` | Combined Claude and Codex monitor |
| `http://127.0.0.1:47831/` | Focused Codex Work dashboard |

Everything binds to your own machine. Port 47831 is a dashboard, not a model proxy.

On the Codex cards:

- **Installed** means the hook definition exists.
- **Live** means a real, non-test hook ran recently.
- **Verified · idle** means an earlier measurement proved it worked, but it has not been observed recently.

`SessionStart` normally appears only after Codex compacts a task, so healthy day-to-day activity may show three of the four hook events. `/hooks` is still the final word on trust and activation.

## What has actually been measured

A native Codex 0.149.0 A/B test used the same `gpt-5.6-sol` model, low reasoning effort, and the same 2,000-line tool result:

| Test arm | Native input tokens | Hidden canary reached the model? |
|---|---:|---|
| Normal tool result | 41,925 | yes |
| Compact PostToolUse receipt | 30,789 | no |
| Difference | **11,136 saved (26.56%)** | exact hook-visible result retained locally |

That test proves the large result was replaced before the next model step. It does **not** promise a 26.56% saving on every turn; results depend on how much large tool output a task produces.

An earlier whole-turn Lean experiment saved 62.50% on a medium fixture and 85.35% on a long fixture, but it used a synchronous nested model turn and was too slow for normal use. Those numbers remain research results only. Lean is not enabled in 0.6.2, and the lightweight turn reminder does not yet have its own defensible savings percentage.

## Evidence, privacy, and safety

The exact-evidence guarantee begins at the native `PostToolUse` boundary. If Codex has already truncated process output before firing that event, a downstream hook cannot recover the missing bytes.

Monitor data is deliberately limited. It reports rewrites, receipt reductions, and guarded A/B history without storing prompts, commands, answer bodies, session IDs, or evidence content in telemetry. Installer probes are labeled and excluded from normal-use totals.

The release ZIP is source-only. It contains no compiled executables, DLLs, native modules, fonts, images, or prebuilt runtime bundles. The old experimental bridge source remains available for audit and research, but the 0.6.2 installer does not compile, install, or register it.

## Useful commands

```powershell
ncc --version
ncc status
ncc settings
ncc budget on
ncc budget off
ncc budget status
ncc evidence-find <handle> "pattern"
ncc evidence-slice <handle> --start-line 120 --lines 60
ncc benchmark
```

`ncc settings` prints the path to the editable local settings file. RTK, large-result receipts, and the turn reminder can be controlled independently.

For developers, an opt-in guarded hook A/B is available from the Native Context Compiler source directory. Run it only when every other subscription client is idle:

```powershell
npm run hook-eval -- --model <your-codex-model> --effort low --claude-idle
```

The A/B uses a one-invocation trust bypass inside disposable test homes. Passing it does not approve the hooks installed in your real Codex home.

## A couple of quirks

- Codex 0.149 may label a replaced `PostToolUse` result as blocked or failed. The command already ran; only its oversized output was replaced. The receipt reports the real exit status.
- A client event stream may still display the command's raw output even when the model received only the receipt. The guarded canary test is what verifies model visibility.
- Claude image compression is unaffected by the OpenAI installer.

## Uninstall

Remove the OpenAI side with:

```powershell
.\setup.cmd uninstall-openai
```

The uninstaller restores the previous user-level `CODEX_CLI_PATH`, removes only project-owned hooks and the managed `AGENTS.md` block, and leaves sessions, evidence, settings, bridge replies, and sanitized metrics in place unless `-RemoveData` is explicitly requested.

## More detail

- [How it works](docs/HOW-IT-WORKS.md)
- [Security model](docs/SECURITY-MODEL.md)
- [Measured offline results](openai/native-context-compiler/docs/OFFLINE-RESULTS.md)
- [Optional ChatGPT Personalization paragraph](docs/PERSONALIZATION.md)
