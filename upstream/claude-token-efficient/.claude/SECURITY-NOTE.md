# Disabled upstream project hook

The upstream snapshot originally placed a `PreCompact` hook here that ran
`git add -A` and created a commit with verification hooks bypassed.

That configuration is intentionally not active in this distribution because
opening the vendored subtree in Claude Code could otherwise commit unrelated
or sensitive working-tree files without a separate confirmation.

The unmodified historical JSON is retained for audit purposes at
`../examples/settings.precompact-auto-commit.json.disabled`.
