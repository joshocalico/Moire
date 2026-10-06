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
| `run()` | Discover personalization → fonts → connect platform → mount windows → loop until quit |
| `getPersonalization()` | Read the normalized active system/application profile |
| `setTheme(theme)` | Switch to `"system"`, a profile factory, or a concrete application theme |
| `setPersonalization(overrides)` | Replace app-level overrides and update mounted windows |
| `quit()` | Exit loop; destroy windows; disconnect |

Env override: `MOIRE_UI_PLATFORM=wayland|headless`. On Linux with `WAYLAND_DISPLAY`, default is Wayland.

System personalization is the default. Applications may override individual
profile values in the constructor while retaining the rest:

```ts
const app = new Application({
  personalization: { accent: "#bf5af2", reducedMotion: true },
});
```

See [Personalization and themes](./personalization.md) for precedence and
subtree providers.

## Window

| Member | Notes |
| --- | --- |
| `setContent(node \| (size) => node)` | Marks dirty; function form gets current size |
| `onClose(cb)` | User/compositor close |
| `requestRedraw()` | Force present on next tick |
| `tick()` | Advance motions; if dirty, renderShell → rasterize → present |
| `getWidth` / `getHeight` / `isClosed` | State |
| `beginMove()` | Start a native move using the current input serial |
| `requestClose()` | Use the same unsaved-change guard as a compositor close |
| `setMaximized(boolean)` / `isMaximized()` | Request maximize/restore; read the state confirmed by the platform |
| `minimize()` | Request native minimize when supported |

`Window` implements `WindowActions`. Pass it to `WindowFrame` when using
client decorations (`decorated: false`); the shared frame allocates the title,
tabs, native controls and body. Close requests call the `setCloseGuard` callback;
returning `false` leaves the window open. After an accepted close, repeated
requests do not run the close callbacks again.

```tsx
const win = new Window({ title: "Files", width: 960, height: 640, decorated: false });
win.setContent((size) => (
  <WindowFrame {...size} title="Files" actions={win}>
    {(body) => <FilesWorkspace {...body} />}
  </WindowFrame>
));
```

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
