# Theme

Tokens live in `@moire/ui` (`theme.ts`). Shell and apps share them so chrome and windows match.

## Palette (`themePalette()`)

ARGB fills. Representative keys:

| Token | Role |
| --- | --- |
| `bg` | Page / deep background |
| `surface` / `panel` | Raised panels |
| `text` / `muted` | Primary / secondary copy |
| `border` / `rim` | Hairlines |
| `accent` / `accentLine` | Brand accent and primary buttons |
| `hover` / `pressed` | Interaction washes |
| `danger` | Destructive actions |
| `selection` | Selected rows / icons |

Exact values can change; always read via `themePalette()` rather than hardcoding.

## Type roles (`TYPE_ROLES`)

| Role | Typical use |
| --- | --- |
| `display` | Rare large titles |
| `title` | Section / window headers |
| `body` | Default UI text |
| `caption` | Secondary labels, Places |
| `mono` | Paths, technical strings |

Each role has `size` (and weight hints used by Label). Scale with `getUiScaleFactor()`.

## Spacing (`SPACE`)

`xs` 4 · `sm` 8 · `md` 12 · `lg` 16 · `xl` 24

## UI scale

Stored in prefs as `uiScale` (0.75–2). Applied at Application start and when Settings changes Appearance.

## Further reading

- [Wallpaper](./wallpaper.md)
- [Settings prefs](../reference/prefs.md)
