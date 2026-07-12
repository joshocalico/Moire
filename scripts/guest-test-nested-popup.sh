#!/usr/bin/env bash
# Reproduce nested xdg_popup (submenu) against the running Moire session.
set -euo pipefail
RUNTIME=/home/moire/.moire-runtime
NAU=$(pgrep -u moire -x nautilus | head -1 || true)
if [[ -z "${NAU:-}" ]]; then
  echo "no nautilus; start session first" >&2
  exit 1
fi
DBUS=$(tr '\0' '\n' < /proc/"$NAU"/environ | grep ^DBUS_SESSION_BUS_ADDRESS= | cut -d= -f2-)

# Truncate recent log marker
echo "=== NESTED TEST $(date -Is) ===" >> /tmp/moire-session.log

runuser -u moire -- env \
  XDG_RUNTIME_DIR="$RUNTIME" \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  GTK_THEME=Moire \
  DBUS_SESSION_BUS_ADDRESS="$DBUS" \
  XDG_CURRENT_DESKTOP=Moire \
  python3 - <<'PY'
import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, Gdk

win = Gtk.Window(title="nested-popup")
win.set_default_size(400, 300)
btn = Gtk.MenuButton(label="Menu")
menu = Gtk.Menu()
sub = Gtk.Menu()
for n in ("Alpha", "Beta", "Gamma"):
    sub.append(Gtk.MenuItem(label=n))
item = Gtk.MenuItem(label="Submenu ▶")
item.set_submenu(sub)
menu.append(item)
menu.append(Gtk.MenuItem(label="Other"))
menu.show_all()
sub.show_all()
btn.set_popup(menu)
win.add(btn)
win.connect("destroy", Gtk.main_quit)
win.show_all()

def open_menus():
    menu.popup_at_widget(btn, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, None)
    def open_sub():
        item.select()
        # Also try activate to force submenu map
        try:
            item.activate()
        except Exception:
            pass
        return False
    GLib.timeout_add(500, open_sub)
    return False

GLib.timeout_add(600, open_menus)
GLib.timeout_add(3000, Gtk.main_quit)
Gtk.main()
print("client done")
PY

sleep 0.5
echo "=== compositor ==="
pgrep -af 'tsx src/main' || echo DEAD
echo "=== popup lines ==="
grep -E '\[popup\]|RangeError|Maximum call|stack|TypeError|EPIPE|FATAL' /tmp/moire-session.log | tail -40
echo "=== nested client ==="
tail -20 /tmp/moire-nested.log 2>/dev/null || true
