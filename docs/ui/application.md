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
| `requestActivationToken()` | An xdg-activation token naming this window, for a program it launches; null where none is issued |
| `activate(token)` | Restore, raise and focus with a token (see Activation) |
| `sync()` | Resolve once the compositor has handled this window's requests so far |

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

## Activation: one main window or many

Launching an app opens a new window by default; Terminal, Files, the editors and most bundled
apps are meant to have several. An app with a single main window (Settings) declares it with the
freedesktop key `SingleMainWindow=true` in its `.desktop` entry, plus `StartupWMClass` equal to
its window's `appId`. Two pieces then keep it to one window:

- **The shell** (`launch` in `packages/shell/src/controller.tsx`): when the launcher, Quick
  Settings or the desktop menu launches a `SingleMainWindow` entry that already has a window
  (matched by `applicationOwnsWindow` from `@moire/app-discovery`: the window's app id equals
  the desktop id or `StartupWMClass`), it activates that window (the compositor's
  `activateTask`: restore if minimized, raise and focus; never the taskbar's minimize toggle)
  instead of spawning. A deep link is still run, for the app's lock to forward.
- **The app** (`claimSingleInstance` from `@moire/app-tools/single-instance`): the first process
  owns `$XDG_RUNTIME_DIR/moire-apps/<appId>.sock`; a later start (a deep link, a second launch
  racing the first window, another app or a terminal) sends its request there and exits, and
  the running window handles it (Settings navigates to the page). A socket left by a crashed
  instance is reclaimed.

A later start brings the open window to the front when it carries an xdg-activation token:

- **Getting one.** Whoever launches the program puts a token in its environment as
  `XDG_ACTIVATION_TOKEN`. The shell does this for every launch it makes (launcher, menus, Quick
  Settings, file activation). A Moire app launching another program asks its own window with
  `window.requestActivationToken()` and sets the variable on the child.
- **Handing it over.** `claimSingleInstance` takes the token out of the environment (so the
  program's own children do not inherit it) and sends it with the request; the running instance's
  `onRequest(listener)` receives `(request, activationToken)`. Settings calls
  `window.activate(token)`, which sends `xdg_activation_v1.activate` for its surface: the
  compositor restores the window if minimized, raises and focuses it.
- **Focus-stealing protection.** The compositor honours a token only if it issued it for the
  shell's launch or to the client holding the focused window, with no lock or secure prompt up;
  tokens are one-shot and expire after 30 s. A background client's request gets a token that does
  nothing.

A start without a token (typing `moire-settings` in a terminal, which sets none) still hands over
its deep link, so the window navigates, but it is not raised: nothing shows the person asked for
it, the same rule GNOME and KDE apply.

There is no "New window" action for single-window apps; multi-window apps get a new window from
every launch.

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
