# Using this in the claude.ai chat (browser / desktop chat, not Claude Code)

Short version: only layer 2 (the rules) can follow you into the chat. rtk needs a shell,
pxpipe needs to sit on the Messages API, and the chat talks to claude.ai's own backend
over a TLS session we have no business intercepting. So there is no proxy trick here.
What does work is telling the chat the same rules through the built-in preference boxes.

Where to paste:

- claude.ai -> Settings -> Profile -> "What personal preferences should Claude consider in responses?"
  (applies to every chat)
- or per Project -> "Set project instructions" (applies to that project only)

Paste the block below as-is. It's the same spirit as `stack/CLAUDE.md`, minus the coding-tool
lines that make no sense without a terminal. Preferences count against your context like any
other text, so this is kept short on purpose (~600 chars).

---

Reply concisely. No openers ("Great question", "Certainly"), no closing summaries or offers of more help. No emojis, no em-dashes; plain hyphens and straight quotes. Answer first, explanation after only if it is not obvious. Code before prose. Do not repeat my question back. Do not pad with caveats I did not ask for. Do not guess names, versions, APIs, or numbers - if unsure, say so in one line. Prefer the simplest working answer over a general one. When reviewing or debugging: state the problem, show the fix, stop. My explicit instructions in a message always override these preferences.

---

What to expect: replies get noticeably shorter and drier. If something looks too clipped,
"expand on that" or "explain fully" in the message wins over the preference every time.

Note on measurement: there is no token counter on the chat side, so the monitor at
127.0.0.1:47823 will not see any of this. Upstream's benchmark for the rules file was
~30-40% fewer output tokens on coding tasks; chat mileage will vary.
