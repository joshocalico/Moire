# Prefs reference

Primary file: `~/.config/moire/settings.json` (via `@moire/prefs`).

Do **not** use a separate `prefs.json` for Moire UI settings — Settings, shell, and `applySettings` agree on `settings.json`.

## Schema (`MoireSettings`)

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dark` | `boolean` | | Dark preference (GTK + theme pick) |
| `uiScale` | `number` | `1` | Clamped 0.75–2; fonts and Moire UI |
| `volume` | `number` | `0.7` | Sink volume 0..1 (`wpctl` / `pactl` when available) |
| `notifications` | `boolean` | | Prefs field; toast daemon not shipped |
| `showDesktopIcons` | `boolean` | `true` | When false, `paintDesktop` no-ops |
| `wallpaper` | object \| `null` | `null` | Override; `null` = bundled theme wallpaper |

### Wallpaper object

When non-null:

```json
{
  "mode": "atmosphere" | "gradient" | "solid" | "image",
  "path": "/optional/image.png",
  "preset": "optional-named-preset"
}
```

| Field | Role |
| --- | --- |
| `mode` | Paint mode |
| `path` | Image path when `mode` is `image` |
| `preset` | Named atmosphere / gradient preset when used |

Exact union matches `WallpaperSettings` in `packages/prefs`.

## Desktop layout

Separate file: `~/.config/moire/desktop-layout.json`.

Icon positions for the shell desktop layer (not Appearance prefs).

## Apply pipeline

`applySettings` / watchers in `@moire/prefs`:

1. Read `settings.json`.
2. Merge wallpaper override into active `MoireTheme`.
3. Apply GTK appearance (font pt from `uiScale`, dark).
4. Shell / compositor `invalidateChrome` + wallpaper cache bust when signature changes.

Applications also read `uiScale` at `Application.run()`.

## Reload

- Hot reload: prefs watchers + Settings save (verify with `scripts/guest-verify-prefs-hotreload.sh`).
- Guest restart: `scripts/guest-clean-restart.sh` if a change does not hot-apply.
