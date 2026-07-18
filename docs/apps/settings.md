# Settings

Package: `apps/settings`.

Writes `~/.config/moire/settings.json` via `@moire/prefs` (not `prefs.json`).

## Sections (current)

| Section | Controls |
| --- | --- |
| Appearance | Dark, UI scale, wallpaper mode / atmosphere / image |
| Displays | Live connector identity, resolution + refresh controls, preferred/current state, Keep/Revert countdown |
| Sound | Volume-related prefs applied through prefs pipeline |
| (others) | Expand as schema grows |

Live apply: `applySettings` updates GTK + theme; shell invalidates chrome / wallpaper when the prefs signature changes.

## Pref schema

Full key list: [Prefs reference](../reference/prefs.md).

## Toolkit

Standard `@moire/ui` window — Tabs, Slider, Toggle, Buttons, and scrollable
resolution controls — using the same tokens as Files and shell. The view
reconciles live connector/mode changes while it is open. Display management
stays behind D-Bus; Settings does not access DRM directly.

## Guest checks

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-verify-prefs-hotreload.sh
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-launch-settings-only.sh
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-display-mode.sh list
```
