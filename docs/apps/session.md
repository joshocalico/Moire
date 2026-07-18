# Guest session

How Moire runs inside the Parallels guest (MoireDev).

## Day-0 apps

| App | Role |
| --- | --- |
| Files | File manager |
| foot | Terminal |
| Portal backend | Moire-native Open With chooser, D-Bus activated on demand |

Nautilus is intentionally out of the Moire session once Files is verified.

## Default applications

During startup, `moire-session` installs the Moire Files launcher and desktop entry into the user's `~/.local` directories, then sets:

```text
inode/directory=moire-files.desktop
```

This makes `xdg-open <folder>` launch Files with that folder. The association is stored in `~/.config/mimeapps.list`; regular files continue to use their own MIME defaults.

## Runtime dirs

- Wayland socket under `$HOME/.moire-runtime` (session sets `XDG_RUNTIME_DIR` here).
- Config under `~/.config/moire/`.
- Default-app association under `~/.config/mimeapps.list`.
- Files launcher/entry under `~/.local/bin` and `~/.local/share/applications`.
- AppChooser backend manifest/config under `~/.local/share/xdg-desktop-portal/`.
- D-Bus activation entry under `~/.local/share/dbus-1/services/`.

`xdg-desktop-portal` owns the public `org.freedesktop.portal.Desktop` API.
For Moire sessions it routes `org.freedesktop.impl.portal.AppChooser` to the
D-Bus-activatable `apps/portal` process; unsupported interfaces fall back to
the GTK backend. Native Files and shell requests use
`org.moire.FileActivation1` on that same process so Open With always has one
chromeless, draggable top-level window and association policy.

## Scripts

Host-side helpers live in repo `scripts/` — prefer those over fragile `prlctl exec … bash -c`.

| Script | Purpose |
| --- | --- |
| `scripts/guest-clean-restart.sh` | Clean compositor / session restart in guest |
| (others) | See [Scripts](../reference/scripts.md) |

Typical verify loop from the host:

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/capture.png
```

## More

- [Dev VM](../dev-vm.md)
- [Known issues](../known-issues.md)
- [Parallels DRM present](../parallels-drm-present.md)
