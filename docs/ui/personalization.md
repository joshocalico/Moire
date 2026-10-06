# Personalization and themes

`@moire/ui` treats personalization as input data, not as a dependency on a
particular desktop toolkit. A platform backend reports a normalized
`PersonalizationProfile`; the application resolves that profile into
renderer-neutral widget foundations and recipes.

The precedence is deliberate:

1. A nested `WidgetThemeProvider` controls its React subtree.
2. An application `theme` or `personalization` option controls all its windows.
3. A Moire session follows live Moire preferences.
4. Other platforms contribute the preferences their backend can discover.
5. Portable defaults fill any unavailable values.

```tsx
import React from "react";
import {
  Application,
  Button,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";

const app = new Application({
  // Omit both options to follow the system.
  personalization: { accent: "#bf5af2", reducedMotion: true },
});

const inspectorTheme = createPersonalizedWidgetTheme(
  discoverPersonalization(process.platform, { themeFamily: "cupertino" }),
);

const inspector = (
  <WidgetThemeProvider theme={inspectorTheme}>
    <Button width={120} label="Inspect" />
  </WidgetThemeProvider>
);
```

`Application.getPersonalization()` exposes the active profile. This includes
scheme, accent, contrast, motion/transparency preferences, font scale, theme
family, icon and cursor theme names, and discoverable family/accent choices.
`Application.setTheme()` and `Application.setPersonalization()` update mounted
windows. Newly created popups inherit their parent window's application theme;
a nested provider remains free to override it.

The named families are Moire recipe families, not toolkit emulation layers:

| Family | Platform vocabulary |
| --- | --- |
| `cupertino` | macOS |
| `redmond` | Windows |
| `plasmid` | Qt/KDE |
| `gnomish` | GTK/GNOME |
| `moire` | Moire's native visual language |

All five families have light and dark palettes. Cupertino, Redmond, Plasmid,
and Gnomish provide distinct native control recipes: button shape and density,
selection, focus, fields, tabs, menus, scrollbars, and dialogs. Cupertino keeps
its existing recipes; the other three share a typed recipe builder with explicit
family metrics. These are Moire interpretations, rather than complete replicas
of another desktop.

Desktop Settings → Appearance → Desktop style applies a family to the shell
and running native apps. `@moire/theme` owns the shared palette, title-bar and
panel dimensions. Cupertino uses left traffic-light controls and a floating
bottom panel. Other families retain right window controls. The compositor uses
the same dimensions and control positions for rendering, hit testing, and the
available window area.

The default Moire style uses charcoal surfaces and a wisteria accent. Its
bundled botanical wallpaper was generated for this project from the supplied
visual direction. It has no remote asset dependency. Image paths in bundled
themes resolve relative to their theme file.

Files opens at 1020×600 logical pixels. Windows at least 960 pixels wide show
an inspector with selection metadata, PNG previews, and the existing open
action. The toolbar stacks below 760 pixels; below 480 pixels the Places pane
hides to preserve the file area. At 200 pixels wide, navigation, search, and
view controls occupy three rows. Documents and Pictures join the built-in
Places, and long sidebars scroll.

Search filters filenames in the current folder. Ctrl+F focuses search; Escape
clears it. Alt+Left, Alt+Right, and Alt+Up navigate history or the parent folder.
The status bar reports the visible count, selection, and selected file size.
Empty folders and searches with no matches have distinct messages. Existing
selection, drag and drop, favorites, and context actions remain available.

Settings groups Appearance controls into labeled property rows. Narrow rows
stack labels above controls, and the page scrolls when its content exceeds the
window. Wallpaper offers a Theme default choice. Shared buttons use readable
text and icons on accent fills in every family and scheme. Icon buttons center
both element and function artwork, retain hover ownership for tooltips, and
support keyboard focus. Select menus support arrows, Home, End, Enter, and
Escape, including reopening immediately after a choice. Exiting overlays stop
receiving input.

Title bars and panel tasks use symbolic app icons. Title ellipsis includes the
width of the ellipsis itself, so captions stay clear of window controls.

Run the native rendering checks:

```bash
pnpm --filter @moire/ui smoke
pnpm --filter @moire/ui smoke:themes
pnpm --filter @moire/ui smoke:polish
pnpm --filter @moire/ui smoke:desktop
pnpm --filter @moire/ui exec tsc -p scripts/tsconfig.json
pnpm --filter @moire/shell smoke
```

To save a native control preview for each family and scheme:

```bash
MOIRE_THEME_PREVIEW_DIR=/tmp/moire-themes pnpm --filter @moire/ui smoke:themes
```

This renders actual widgets through the custom reconciler. It checks distinct
output for all ten combinations, input regions, breadcrumb text, and visible
ellipsis. The VM runbook documents the live desktop check.

`smoke:polish` checks primary and danger text contrast (at least 4.5:1 in rest,
hover, and pressed states), artwork alignment, keyboard activation and menu
navigation, and tooltip hit ownership. `smoke:desktop` mounts the real Files
and Settings components across ten family/scheme combinations and six window
sizes, then exercises filename filtering. To retain those native previews:

```bash
MOIRE_DESKTOP_PREVIEW_DIR=/tmp/moire-desktop pnpm --filter @moire/ui smoke:desktop
```
