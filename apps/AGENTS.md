# Working on Moire apps

Applies to `apps/bundled`, `apps/core`, `apps/developer` and the shared app helpers in
`packages/app-tools`. Read [README.md](README.md) for what each app class may do; this file is
about how app code is written.

## Build on `@moire/ui`, not the renderer

Apps compose `@moire/ui` widgets. They do not import drawing primitives (`Rect`, `Group`,
`Text`, `Image`) from `@moire/react-host`, and an app's `package.json` does not depend on
`@moire/react-host`.

| You want                                                                    | Use from `@moire/ui`                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A hairline or divider                                                       | `Separator`                                                         |
| A filled or rounded shape, card, dot, swatch                                | `Surface` (`fill`, `radius`, `stroke`) or `Box`                     |
| Rows, columns, spacing, alignment                                           | `Horizontal`, `Vertical`, `Row`, `Column`, `Box`, `Inset`, `Center` |
| Text                                                                        | `TextBlock`, `Label`                                                |
| Something interactive                                                       | `Pressable`, `Button`, `IconButton`, and the other widgets          |
| Raw pointer/key input on a surface the app draws (a canvas, a drag gesture) | `PointerArea`                                                       |
| A stroke-only outline                                                       | `Surface` with `fill={0x00000000}` and `stroke`                     |

If `@moire/ui` lacks something an app needs, add a small, general widget to `packages/ui`
(and export it) rather than reaching into `@moire/react-host`. Renderer-level system surfaces
(boot, greeter, the shell in `packages/shell`) are the exception: they sit below the widget kit.

## Window chrome

Every app shows exactly one titlebar, its own:

- **Header bar:** `AppHeaderBar` from `@moire/ui`. It holds the app icon and name, the open
  document or place as a subtitle, the app's actions, and the window controls. Pass the app's
  `Window` as `window` so it gets minimize/maximize/close, dragging and double-click maximize.
- **Undecorated windows:** open the app's `Window` with `decorated: false`. Otherwise the
  compositor draws a second titlebar above the app's. `runApp` in `@moire/app-tools` opens
  undecorated windows (pass `decorated: true` only for an app that draws no header bar); pass
  the `window` it hands your render function on to `AppFrame`'s `window` prop.
- **Narrow windows:** header actions keep their width; the subtitle, then the title, then the
  icon give way. Keep header actions few enough to fit beside the window controls at 640px.
- **Status line:** `AppStatusLine` at the foot of the window, for state, counts and position.
- **File-based apps:** use `AppFrame` from `@moire/app-tools` (header bar, optional tool row,
  body, status line). Before a file is open, show `OpenFileState` (icon, title, path field with
  Open, and recent files). Call `rememberRecentFile(appId, path)` after a successful open. A raw
  path field is never the main UI.

Rendered without a window (smokes, the gallery), `AppHeaderBar` omits the window controls.

## Look and feel

- **Actions:** one primary action per view (`variant="primary"`); everything else secondary or
  ghost. Toolbar actions are `IconButton`s with tooltips, not rows of identical text buttons.
- **Spacing and cards:** 12–16px outer padding, 8px gaps. Cards are `Surface` with
  `palette.surface`, a radius of 10–12 and a `borderSubtle` stroke.
- **Type:** titles 17–20 medium, body 13, captions and muted text 11–12 in `palette.muted`.
- **Empty, loading and error states:** use `EmptyState` (or `OpenFileState`), not a sentence
  floating at the top left.
- **Size:** multiply sizes by `getUiScaleFactor()`. Layouts must hold at 640px wide and at UI
  scale 1.5 without overflow.

## Code

Keep an app's code in layers rather than one long `main.tsx`:

- **`main.tsx`:** the entry point and top-level composition only, ideally under ~200 lines.
- **Model** (`model.ts` or `state.ts`): the app's state and its transitions as pure, typed
  functions or a reducer. Use discriminated unions for modes, not piles of booleans. Test real
  logic directly with a plain smoke, no rendering needed.
- **Backend** (`backend.ts`): files, processes and network. Failures come back as values the UI
  shows (status line, `EmptyState`), never swallowed.
- **Views:** small presentational components in their own files, taking props.
- **Effects:** only in hooks with cleanup; no I/O during render.
- **No duplicated helpers:** formatting (sizes, dates, durations), recent files, the file chooser
  and similar live in `packages/app-tools`, or `packages/ui` for widgets. Look there before
  writing one, and move duplicates you find.
- **JSX only:** no `React.createElement`.
- **Comments and cleanup:** named constants for repeated sizes, comments that say why rather
  than what, and no dead code or unused exports.
- **Dependencies:** add workspace dependencies to the app's `package.json`, then run
  `pnpm install --offline` from the repo root so the lockfile stays consistent. Don't hand-edit
  `pnpm-lock.yaml`.

## Verify

1. **Typecheck:** use the app's `typecheck` script (or `npx tsc -p <app> --noEmit`).
2. **Smokes:** run them from the repo root with
   `node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs <file>`.
   - Prefer finding controls by `focusId` or label (see `windowControl()` in
     `packages/app-tools/src/testing.ts`) over hard-coded pixel positions.
   - Update a smoke only when it pins the old look, keep its behavioural intent, and say why.
3. **Gallery:** from `packages/ui`, run
   `MOIRE_APP_GALLERY_DIR=<scratch dir> npx tsx scripts/app-suite-gallery.smoke.tsx`.
   - It renders every app in every theme, width and scale, and must report 0 overflow findings.
   - Look at the PNGs before and after your change, at least
     `<app>-moire-dark-1020x975-scale1.5.png` and `<app>-moire-dark-640x650-scale1.png`.
