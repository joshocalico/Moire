# `@moire/ui`

Portable app toolkit for Moire (Qt/GTK-like). Widgets, TTF fonts (IBM Plex), and Yoga layout are OS-agnostic. Window I/O goes through a small `PlatformBackend`.

## Platforms

| Backend   | When |
|-----------|------|
| `wayland` | Linux + `WAYLAND_DISPLAY` (Moire session) |
| `headless`| Tests / CI / no display |

Override with `MOIRE_UI_PLATFORM=wayland|headless`.

## Example

```ts
import { Application, Window, Column, Label, Button } from "@moire/ui";
import { createElement } from "react";

const app = new Application();
const win = new Window({ title: "Settings", width: 480, height: 360 });
win.setContent(
  createElement(Column, { width: 480, padding: 16 },
    createElement(Label, { text: "Hello", fontSize: 18, fontWeight: "bold" }),
    createElement(Button, { width: 100, height: 32, label: "OK" }),
  ),
);
app.addWindow(win);
await app.run();
```

Hard rule: `widgets/`, `font/`, `layout/` never import Wayland/koffi.
