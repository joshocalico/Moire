# Wallpaper

Default desktop look is the **atmosphere** gradient (soft sky → horizon → ground), not a flat panel color. Paint lives in `@moire/theme`; prefs can override.

## Paint path

1. Resolve source: `settings.wallpaper` override → else bundled theme wallpaper.
2. Paint into an ARGB buffer at output size.
3. Cache by size + source key; invalidate on prefs / theme change.
4. Atmosphere may mark the composite dirty for slow ambient drift.

Shell composite order: wallpaper → desktop icons → windows → panel → drag preview → cursor.

## Prefs override

In `~/.config/moire/settings.json`, `wallpaper` is either `null` (use theme) or:

```json
{
  "wallpaper": {
    "mode": "atmosphere",
    "path": null,
    "preset": null
  }
}
```

| `mode` | Behavior |
| --- | --- |
| `atmosphere` | Procedural sky / horizon (default day-0 look) |
| `gradient` | Theme gradient |
| `solid` | Flat fill |
| `image` | PNG from `path` |

Settings → Appearance writes this object; shell reloads when prefs watchers fire.

## Gaps

- Image mode needs path validation and aspect fitting polish.
- Multi-monitor independent wallpapers are not modeled yet.
- Live / video wallpapers are out of scope (see [Roadmap](../roadmap.md)).

## Related

- [Theme tokens](./README.md)
- [Prefs](../reference/prefs.md)
- [Paint & input](../architecture/paint-and-input.md)
