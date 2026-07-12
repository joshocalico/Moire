#!/usr/bin/env bash
# Open Nautilus About / Properties from UI while watching for client death.
set -euo pipefail
echo "=== NAUTILUS DIALOG TEST $(date -Is) ===" >> /tmp/moire-session.log

# Right-click → we'll also try gdbus about if available
NAU=$(pgrep -u moire -x nautilus | head -1 || true)
echo "nautilus pid=$NAU"
if [[ -z "${NAU:-}" ]]; then
  echo "no nautilus" >&2
  exit 1
fi

# Try activating About via GAction on the gtk application
runuser -u moire -- env \
  XDG_RUNTIME_DIR=/home/moire/.moire-runtime \
  WAYLAND_DISPLAY=wayland-1 \
  DBUS_SESSION_BUS_ADDRESS="$(tr '\0' '\n' < /proc/$NAU/environ | grep ^DBUS_SESSION_BUS_ADDRESS= | cut -d= -f2-)" \
  gdbus call --session \
    --dest org.gnome.Nautilus \
    --object-path /org/gnome/Nautilus \
    --method org.freedesktop.Application.ActivateAction \
    'about' '[]' '{}' 2>/tmp/moire-about-gdbus.txt || true

sleep 1
echo "=== gdbus ==="
cat /tmp/moire-about-gdbus.txt 2>/dev/null || true
echo "=== nautilus alive? ==="
pgrep -x nautilus || echo DEAD
echo "=== compositor ==="
pgrep -af 'tsx src/main' | head -2 || echo DEAD
echo "=== log ==="
grep -E '\[popup\]|\[deco\]|\[seat\]|\[wm\]|error|Error|Protocol|abort|CRITICAL' /tmp/moire-session.log | tail -40
echo "=== nau log ==="
tail -30 /tmp/moire-nautilus.log 2>/dev/null || true
