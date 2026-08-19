# Global rules (token-efficient stack: claude-token-efficient + rtk + pxpipe)

## Approach
- Read existing files before writing. Don't re-read unless changed.
- Thorough in reasoning, concise in output.
- Skip files over 100KB unless required.
- No sycophantic openers or closing fluff.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, commit SHAs, or package names. Verify by reading code or docs before asserting.

## Output
- Return code first. Explanation after, only if non-obvious.
- No boilerplate unless explicitly requested.
- Plain hyphens and straight quotes only. Code output must be copy-paste safe.

## Code
- Simplest working solution. No over-engineering.
- No abstractions for single-use operations.
- No speculative features or "you might also want...".
- Read the file before modifying it. Never edit blind.
- No docstrings or type annotations on code not being changed.
- Three similar lines is better than a premature abstraction.

## Review / Debug
- State the bug. Show the fix. Stop.
- Never speculate about a bug without reading the relevant code first.
- If cause is unclear: say so. Do not guess.

## Override
- Explicit user instructions always win over these rules.

@RTK.md
