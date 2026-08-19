#!/usr/bin/env bash
# claude-token-stack installer for Linux / macOS (Windows: use install.ps1).
# Installs rtk + pxpipe-proxy, copies the stack into ~/.local/bin and ~/.claude, starts the daemons.
# Flags: --no-desktop (skip settings.json routing) --skip-rtk --skip-pxpipe --profile NAME (default|compressed)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
NO_DESKTOP=0; SKIP_RTK=0; SKIP_PX=0; PROFILE=default
while [ $# -gt 0 ]; do
  case "$1" in
    --no-desktop) NO_DESKTOP=1 ;;
    --skip-rtk) SKIP_RTK=1 ;;
    --skip-pxpipe) SKIP_PX=1 ;;
    --profile) PROFILE="$2"; shift ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown flag $1"; exit 2 ;;
  esac; shift
done
say(){ printf '\033[36m== %s\033[0m\n' "$*"; }
need(){ command -v "$1" >/dev/null 2>&1; }
BIN="$HOME/.local/bin"; CL="$HOME/.claude"; mkdir -p "$BIN/lib" "$CL"

say "Step 1: rtk (Rust Token Killer)"
if [ $SKIP_RTK -eq 1 ]; then echo "  skipped"
elif need rtk; then echo "  present: $(rtk --version 2>/dev/null | head -1)"
elif need brew; then brew install rtk
elif need curl; then curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
elif need cargo; then cargo install --git https://github.com/rtk-ai/rtk
else echo "  no brew/curl/cargo: grab a release from https://github.com/rtk-ai/rtk/releases and put rtk on PATH, then re-run"; fi
if need rtk; then rtk init -g >/dev/null 2>&1 && echo "  rtk init -g: hook + RTK.md installed" || echo "  rtk init -g failed (run it manually)"; fi

say "Step 2: pxpipe-proxy"
if [ $SKIP_PX -eq 1 ]; then echo "  skipped"
else
  need node || { echo "  node >= 22 required (https://nodejs.org)"; exit 1; }
  npm install -g pxpipe-proxy@latest >/dev/null 2>&1 && echo "  pxpipe $(pxpipe --version 2>/dev/null || echo installed)" || echo "  npm install -g pxpipe-proxy failed"
fi

say "Step 3: rules profile ($PROFILE) -> ~/.claude/CLAUDE.md  (default | compressed | coding | analysis | agents)"
if [ "$PROFILE" = default ]; then src="$here/stack/CLAUDE.md"
else
  up="$here/upstream/claude-token-efficient/profiles/CLAUDE.$PROFILE.md"
  [ -f "$up" ] || { echo "  profile file missing: $up"; exit 1; }
  mkdir -p "$CL/token-stack"; src="$CL/token-stack/CLAUDE.$PROFILE.md"
  { cat "$up"; printf '\n\n@RTK.md\n'; } > "$src"   # upstream profile verbatim + the rtk import line
fi
if [ -f "$CL/CLAUDE.md" ] && ! cmp -s "$src" "$CL/CLAUDE.md"; then cp "$CL/CLAUDE.md" "$CL/CLAUDE.md.pre-token-stack.bak"; echo "  existing CLAUDE.md backed up (.pre-token-stack.bak)"; fi
cp "$src" "$CL/CLAUDE.md"; cp "$here/stack/RTK.md" "$CL/RTK.md"
echo "  installed"

say "Step 4: pxpipe-ctl.sh + warpd -> $BIN"
cp "$here/stack/bin/pxpipe-ctl.sh" "$BIN/pxpipe-ctl.sh"; chmod +x "$BIN/pxpipe-ctl.sh"
rm -rf "$BIN/lib/warpd"; cp -R "$here/stack/bin/lib/warpd" "$BIN/lib/warpd"
cp "$here/stack/bin/lib/monitor.js" "$BIN/lib/monitor.js"
ln -sf "$BIN/pxpipe-ctl.sh" "$BIN/pxpipe-ctl"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "  NOTE: add $BIN to PATH (export PATH=\"\$HOME/.local/bin:\$PATH\")";; esac
cat > "$BIN/claude-px" <<'EOF'
#!/usr/bin/env bash
# claude through pxpipe warp (per-terminal; no settings.json changes)
"$HOME/.local/bin/pxpipe-ctl.sh" --quiet >/dev/null 2>&1 || true
exec pxpipe warp -- claude "$@"
EOF
chmod +x "$BIN/claude-px"; echo "  claude-px launcher written"

say "Step 5: start daemons"
[ $SKIP_PX -eq 1 ] || "$BIN/pxpipe-ctl.sh" start

if [ $NO_DESKTOP -eq 0 ] && [ $SKIP_PX -eq 0 ]; then
  say "Step 6: always-on routing (settings.json env + SessionStart hook)"
  "$BIN/pxpipe-ctl.sh" desktop-on
  echo "  restart the Claude desktop app / open a new terminal for it to take effect. Undo: pxpipe-ctl desktop-off"
fi
say "done. Check: pxpipe-ctl doctor   monitor: pxpipe-ctl monitor open  (http://127.0.0.1:47823/)"
