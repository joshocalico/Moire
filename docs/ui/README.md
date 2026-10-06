# `@moire/ui` overview

Portable app SDK for Moire (and later other OSes). Widgets, fonts, and layout never import Wayland. Window I/O goes through `PlatformBackend` (`wayland` | `headless`).

```bash
pnpm --filter @moire/ui typecheck
pnpm --filter @moire/ui smoke
```

## Mental model

1. Construct `Application` (+ optional `{ platform: "wayland" | "headless" }`).
2. Construct `Window({ title, appId?, width?, height?, resizable? })`.
3. `win.setContent(node | (size) => node)` with React elements from `@moire/ui`.
4. `app.addWindow(win)` then `await app.run()`.

`run()` discovers platform personalization, installs TTF fonts, connects the platform, and loops `pump` → `tick` until quit.

## Theme access in widgets

```ts
import { themePalette, TYPE_ROLES, SPACE, usePalette } from "@moire/ui";

const pal = themePalette(); // ARGB fills
const inherited = usePalette(); // nearest provider/application palette
const roles = TYPE_ROLES;   // display/title/body/caption/mono
const gap = SPACE.md;       // 4/8/12/16/24
```

Public widgets and app components using `usePalette()` resolve the nearest
`WidgetThemeProvider`, falling back to the application/system theme.
`themePalette()` remains a convenient non-contextual escape hatch for low-level
plumbing. Prefer semantic recipes and tokens over raw hex. See
[Personalization and themes](./personalization.md).

## Scale and fonts

| API | Role |
| --- | --- |
| `setUiScaleFactor` / `getUiScaleFactor` | Clamped 0.75–2; applied to text sizes |
| `installUiFonts` | Load IBM Plex Sans/Mono into react-host text renderer |
| `FontEngine` | Low-level measure/draw if needed |

Apps usually rely on `Application.run()` for install + scale from prefs.

## Module map

| Path | Contents |
| --- | --- |
| `src/application.ts` | Event loop |
| `src/window.ts` | Rasterize + present + hit dispatch |
| `src/platform.ts` | Backend interface |
| `src/platforms/wayland` | xdg_toplevel, seat, DnD |
| `src/platforms/headless` | Tests / smoke |
| `src/widgets/*` | Controls |
| `src/motion.ts` | Eased values |
| `src/image/load.ts` | PNG cache |
| `src/font/*` | TTF engine |
| `icons/*.png` | Bundled icon set |

## Further reading

- [Application & Window](./application.md)
- [Personalization & themes](./personalization.md)
- [Widgets](./widgets.md)
- [Icon design and verification](./icons.md)
- [Motion](./motion.md)
- [Images & icons](./images-and-icons.md)
- [Platforms](./platforms.md)
