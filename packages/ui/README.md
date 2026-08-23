# `@moire/ui`

Portable app toolkit for Moire (Qt/GTK-like). Widgets, TTF fonts (IBM Plex),
and the measured layout model are OS-agnostic. Window I/O goes through a small
`PlatformBackend`.

## Platforms

| Backend   | When |
|-----------|------|
| `wayland` | Linux + `WAYLAND_DISPLAY` (Moire session) |
| `headless`| Tests / CI / no display |

Override with `MOIRE_UI_PLATFORM=wayland|headless`.

## Example

```tsx
import React from "react";
import { Application, Window, Column, Label, Button } from "@moire/ui";

const app = new Application();
const win = new Window({ title: "Settings", width: 480, height: 360 });
win.setContent(
  <Column width={480} padding={16}>
    <Label text="Hello" fontSize={18} fontWeight="bold" />
    <Button width={100} height={32} label="OK" />
  </Column>,
);
app.addWindow(win);
await app.run();
```

## Widget themes and recipes

Visual policy lives in renderer-neutral recipe data. Applications can replace
recipes for a complete subtree while retaining widget interaction and layout:

```tsx
import {
  Button,
  WidgetThemeProvider,
  createWidgetTheme,
} from "@moire/ui";

const base = createWidgetTheme();
const primary = base.recipes.button.primary.medium;
const violet = {
  ...base,
  recipes: {
    ...base.recipes,
    button: {
      ...base.recipes.button,
      primary: {
        ...base.recipes.button.primary,
        medium: {
          ...primary,
          root: {
            ...primary.root,
            base: { ...primary.root.base, fill: 0xff633ad6, radius: 10 },
          },
        },
      },
    },
  },
};

win.setContent(
  <WidgetThemeProvider theme={violet}>
    <Button width={120} label="Continue" variant="primary" />
  </WidgetThemeProvider>,
);
```

Button recipes cover `primary`, `secondary`, `ghost`, and `danger` variants;
`small`, `medium`, and `large` sizes; semantic interaction states; and leading
or trailing artwork slots. Button and IconButton expose focus traversal plus
Enter/Space activation, and IconButton has a centered text/artwork slot rather
than treating its icon as a Button label. ListItem recipes separately own
selection, interaction feedback, typography, leading artwork, metrics, and the
selection indicator. GridItem recipes own selection/drop surfaces, interaction,
label/scrim treatment, and icon metrics. CollectionItem keeps focus, activation,
context-menu, and drag semantics headless while its focus/drop outline is
recipe-painted. TextField recipes own input surfaces, state strokes,
typography, caret, metrics, and named leading/trailing slots; SearchField is a
composition of those primitives with reusable search and clear affordances.
Tabs recipes own the strip, interaction/focus states, typography, optional
artwork, indicator, divider, and size metrics while the widget retains keyboard
selection semantics.
Menu and ContextMenu share one MenuItem implementation and recipe family;
native popup placement and dismissal remain outside the reusable item.
Checkbox, Toggle, Slider, and ProgressBar also resolve paint, geometry, sizes,
and semantic states from recipes. Their focus, keyboard, and captured-drag
behavior stays renderer-independent.
ScrollArea recipes own viewport and scrollbar paint plus density metrics. Its
overlay thumb supports track seeking and captured dragging without reducing the
content width.
Layout wrappers and Label/Surface/Panel/Separator now live in JSX modules;
visual primitives inherit foundation colors from the nearest subtree theme.
Dialog adds recipe-owned chrome and body geometry on top of those primitives.
Software and EGL consume the same resulting scene.

Hard rule: `widgets/`, `font/`, `layout/` never import Wayland/koffi.
