#!/usr/bin/env bash
# Reproduce: open AboutDialog while an xdg_popup grab is active (same client).
set -euo pipefail
echo "=== ABOUT-FROM-MENU TEST $(date -Is) ===" >> /tmp/moire-session.log

NAU=$(pgrep -u moire -x nautilus | head -1 || true)
DBUS=$(tr '\0' '\n' < /proc/"${NAU}"/environ | grep ^DBUS_SESSION_BUS_ADDRESS= | cut -d= -f2-)

runuser -u moire -- env \
  XDG_RUNTIME_DIR=/home/moire/.moire-runtime \
  WAYLAND_DISPLAY=wayland-1 \
  HOME=/home/moire \
  GDK_BACKEND=wayland \
  GSK_RENDERER=cairo \
  GTK_THEME=Moire \
  DBUS_SESSION_BUS_ADDRESS="$DBUS" \
  XDG_CURRENT_DESKTOP=Moire \
  python3 - <<'PY' >/tmp/moire-about-from-menu.log 2>&1
import gi, traceback
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, GLib, Gdk

win = Gtk.Window(title="about-from-menu")
win.set_default_size(360, 240)
btn = Gtk.MenuButton(label="Menu")
menu = Gtk.Menu()
about_item = Gtk.MenuItem(label="About")
menu.append(about_item)
menu.append(Gtk.MenuItem(label="Other"))
menu.show_all()
btn.set_popup(menu)
win.add(btn)
win.connect("destroy", Gtk.main_quit)
win.show_all()

def do_about(*_a):
    try:
        d = Gtk.AboutDialog(transient_for=win, modal=True)
        d.set_program_name("Moire About Test")
        d.set_version("0.0")
        d.present()
        print("about presented", flush=True)
    except Exception:
        traceback.print_exc()
    return False

def open_then_about():
    # Open menu (popup+grab), then About while grab is still live.
    menu.popup_at_widget(btn, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, None)
    print("menu popped", flush=True)
    GLib.timeout_add(300, do_about)
    return False

GLib.timeout_add(500, open_then_about)
GLib.timeout_add(4000, Gtk.main_quit)
try:
    Gtk.main()
    print("main done", flush=True)
except Exception:
    traceback.print_exc()
    print("MAIN CRASHED", flush=True)
PY

sleep 0.3
echo "=== client log ==="
cat /tmp/moire-about-from-menu.log
echo "=== compositor ==="
pgrep -af 'tsx src/main' | head -2 || echo DEAD
echo "=== popup/seat log ==="
grep -E '\[popup\]|\[seat\]|\[surface\]|Error|RangeError|stack' /tmp/moire-session.log | tail -30
