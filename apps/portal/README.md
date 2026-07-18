# xdg-desktop-portal-moire

Moire's native portal backend owns
`org.freedesktop.impl.portal.desktop.moire` on the session bus and implements
`org.freedesktop.impl.portal.AppChooser` at
`/org/freedesktop/portal/desktop`.

The backend uses `@moire/dbus`, Moire's pure-TypeScript D-Bus wire
implementation, and presents the same `OpenWithPicker` and application model
used by Files and the desktop shell. `xdg-desktop-portal` remains the public
sandbox-facing frontend; `moire.portal` and `moire-portals.conf` select this
backend for AppChooser while leaving other interfaces with the GTK backend.
