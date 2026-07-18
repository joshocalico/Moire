# Application and Window

## Application

```ts
import { Application, Window } from "@moire/ui";

const app = new Application(); // or { platform: "headless" }
const win = new Window({
  title: "Demo",
  appId: "org.moire.Demo",
  width: 480,
  height: 360,
  resizable: true,
});
win.setContent(({ width, height }) => /* ReactNode */);
win.onClose(() => app.quit());
app.addWindow(win);
await app.run();
```

| Method | Behavior |
| --- | --- |
| `addWindow(win)` | Register before or during run |
| `run()` | Prefs scale → fonts → connect platform → mount windows → loop until quit |
| `quit()` | Exit loop; destroy windows; disconnect |

Env override: `MOIRE_UI_PLATFORM=wayland|headless`. On Linux with `WAYLAND_DISPLAY`, default is Wayland.

## Window

| Member | Notes |
| --- | --- |
| `setContent(node \| (size) => node)` | Marks dirty; function form gets current size |
| `onClose(cb)` | User/compositor close |
| `requestRedraw()` | Force present on next tick |
| `tick()` | Advance motions; if dirty, renderShell → rasterize → present |
| `getWidth` / `getHeight` / `isClosed` | State |

### Render pipeline

1. Build React tree from content.
2. `renderShell` into a react-host root.
3. The configured renderer builds a frame; `SoftwareRenderer` produces an
   ARGB8888 `Uint8Array` while hit regions are collected from the same scene.
4. `platformWin.present(pixels, w, h)`.

### Pointer dispatch (inside Window)

- **move** — enter/leave/move on top hit with those handlers; flush React when hover changes.
- **down** — assigns focus to the top focusable region, then dispatches
  `onPointerDown` if present.
- **up** — `onPointerUp`; if movement &lt; ~10px, fire `onPress` on top hit with `onPress`.
- **wheel** — `onWheel` with `deltaY`.

Tab and Shift+Tab traverse focusable scene regions. Key down, repeat, and key
up events route to the focused region with logical key, text, and modifier
metadata. `TextField` consumes those events for editing and submission.

## Minimal example

```tsx
import React, { useState } from "react";
import { Application, Window, Column, Label, Button } from "@moire/ui";

const app = new Application();
const win = new Window({ title: "Counter", width: 320, height: 200 });

win.setContent(({ width }) => {
  const [n, setN] = useState(0);
  return (
    <Column width={width} gap={12} padding={16}>
      <Label text={`Count: ${n}`} />
      <Button
        width={120}
        height={32}
        label="Increment"
        variant="primary"
        onPress={() => setN((x) => x + 1)}
      />
    </Column>
  );
});

app.addWindow(win);
await app.run();
```
