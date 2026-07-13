# Files, desktop icons, and drag-and-drop

Moire’s day-0 file story: a native **Files** app, **desktop icons** on the wallpaper, and **Wayland** `wl_data_device` drag-and-drop shared with other clients. Visual language and interaction live in `@moire/theme` + `@moire/ui` so shell chrome and Settings stay consistent.

Day-0 session apps: **Moire Files** + **foot** (Nautilus is not started by `moire-session`).

Rollback marker before this work: git tag **`v0.2.0`**.

**Deeper docs:** [Files](./apps/files.md) · [Desktop](./shell/desktop.md) · [DnD](./compositor/dnd.md) · [Widgets](./ui/widgets.md) · [Roadmap](./roadmap.md) · [Docs index](./README.md)

## Composite paint order

Bottom → top:

1. Wallpaper (`@moire/theme` — atmosphere / gradient / solid / image)
2. Desktop icons (`shell.paintDesktop`)
3. Client windows + SSD titlebars (stack order)
4. Panel / launcher (`shell.paint`)
5. Drag preview (client drag-icon surface, or shell chip)
6. Cursor

## Architecture

```
react-host (rect, text, image, clip, hits)
        ↓
@moire/ui (Pressable, ScrollArea, List, Grid, Icon, Draggable, DropTarget, motion)
        ↓
   apps/files   ·   shell DesktopIcons / Panel / Launcher   ·   Settings
```

| Layer | Responsibility |
| --- | --- |
| `react-host` | Scene graph, CPU raster, hit regions, pointer/wheel |
| `@moire/ui` | Reusable widgets; no Wayland imports in widgets |
| Wayland UI platform | `setDndBridge`, drag icon SHM surface, drop receive |
| `@moire/shell` | Panel, launcher, SSD, desktop icons, drop sink |
| `@moire/core` | Compositor DnD session, desktop drop, preview blit |
| `@moire/theme` | Tokens, type/spacing roles, wallpaper cache + drift |
| `@moire/prefs` | `settings.json`, wallpaper override, `showDesktopIcons` |

## Wallpaper

Modes on `WallpaperSpec`: `solid` | `gradient` | `atmosphere` | `image`.

- Default dark and light themes use **`atmosphere`** (teal-ink washes, vignette, grain).
- Paint is buffered and invalidated on theme/prefs/resize; atmosphere phase advances slowly (~60s period) while the compositor is dirty.
- User override: prefs `wallpaper` → written into `~/.config/moire/active-theme.json` by Settings / `applySettings`.
- Appearance UI: Atmosphere / Gradient / Solid presets; desktop icons toggle.

Implementation: `packages/theme/src/index.ts`, `themes/*/theme.json`, prefs + Settings Appearance.

## Design tokens and widgets

Tokens include panel/surface/text plus interaction colors (`hover`, `pressed`, `selection`, `border`, `overlay`, `rimLight`, `rimShade`). Typography roles: `TYPE_ROLES` (`display`, `title`, `body`, `caption`, `mono`). Spacing: `SPACE` (4 / 8 / 12 / 16 / 24).

Important widgets (`packages/ui/src/widgets/`):

| Widget | Notes |
| --- | --- |
| `Pressable` | Eased hover/press via `createMotionValue` / `easeTo`; ticked by `Window.tick` and shell `needsRepaint` |
| `Button` | Variants: `primary`, `secondary`, `ghost`, `danger` |
| `ScrollArea` | Clip group + wheel |
| `List` / `ListItem` | Generic `items` + `renderItem`; selection wash + left accent |
| `Grid` / `GridItem` | Fixed cell size; set `interactive={false}` when wrapped in `Draggable` |
| `Icon` | PNGs in `packages/ui/icons/`; sync load; geometric fallback |
| `Draggable` / `DropTarget` | Platform bridge; see DnD below |

Headless check: `pnpm --filter @moire/ui smoke`.

## Files app

Package: `apps/files` (`@moire/files`).

- Places: Home, Desktop, Downloads — **longest matching path** is selected (so Desktop does not also light up Home).
- Content: grid (default) or list; `fs` under `$HOME`; `fs.watch` refresh.
- Open: directories navigate; files via `xdg-open`.
- DnD: items are `Draggable` (`text/uri-list`); view is a `DropTarget` that moves/copies into the current directory.
- Started by `apps/session/moire-session` and listed in the launcher.

## Desktop icons

Implementation: `packages/shell/src/DesktopIcons.tsx`, wired from `packages/shell/src/controller.ts`.

- Contents of `~/Desktop`; positions in `~/.config/moire/desktop-layout.json`.
- Prefs: `showDesktopIcons` (default `true`).
- **Pointer:** compositor calls `onDesktopPointerButton` / `onDesktopPointerMotion` only when no client surface is under the cursor (after panel and SSD).
- Click selects; double-click opens with `xdg-open`.
- Drag past a small threshold repositions the icon (live layout + preview chip); release on the desktop persists layout.
- Drag onto a client window (e.g. Files) instead escalates to a real Wayland DnD source — the target gets a normal `text/uri-list` drop and the file moves there; see [Wayland DnD](./compositor/dnd.md).
- Empty desktop is a drop sink for `text/uri-list` (`acceptDesktopDrop`).

## Drag and drop

### Protocol path

1. Client `Draggable` detects press + move threshold → `dndBridge.startDrag`.
2. Wayland UI creates a `wl_data_source`, offers mimes, builds a **labeled SHM drag-icon surface**, calls `wl_data_device.start_drag`.
3. Compositor runs enter / motion / leave / drop against the surface under the cursor.
4. Drop on a Moire UI window: client `data_offer.receive` → `notifyDrop` → `DropTarget.onDrop`.
5. Drop with no client target and `text/uri-list`: compositor reads the source and calls `shell.acceptDesktopDrop`.

`Draggable` owns the hit target (drawn above children). Nested `GridItem` / `ListItem` must use `interactive={false}` or the child Pressable steals the gesture and drag never starts.

### Preview

- Preferred: blit the client drag-icon surface at the cursor during composite.
- Fallback / desktop reposition: `shell.paintDragPreview` chip (and `desktopDragLabel()` while moving icons).

### Limits

- No X11 XDND (Xwayland clients participate only via Wayland DnD).
- No trash / gvfs network places / file thumbnails in this pass.
- No explicit move-vs-copy chooser UI; move is preferred everywhere (matches Files↔Files, desktop↔Files).

## Pointer routing (compositor)

Rough order for button events:

1. Shell panel / launcher
2. SSD titlebar actions
3. Update Wayland pointer focus
4. If no surface under cursor → desktop icon handler
5. Else focus / resize / forward `pointerButton` to the client

While a DnD session is active, motion updates drag focus instead of normal hover.

## Configuration paths

| Path | Purpose |
| --- | --- |
| `~/.config/moire/settings.json` | Prefs (`wallpaper`, `showDesktopIcons`, `uiScale`, …) |
| `~/.config/moire/active-theme.json` | Hot-reloaded theme (may include wallpaper override) |
| `~/.config/moire/desktop-layout.json` | Desktop icon positions |

## Running and verifying

From the Mac (Parallels **MoireDev**):

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/screen.png
```

Useful guest scripts (prefer these over ad-hoc `prlctl exec … bash -c` quoting):

| Script | Purpose |
| --- | --- |
| `scripts/guest-clean-restart.sh` | Rsync tree, restart session |
| `scripts/guest-seed-desktop.sh` | Seed `~/Desktop`, atmosphere prefs |
| `scripts/guest-prep-desktop-shot.sh` | Clear overlapping apps for a desktop capture |
| `scripts/guest-launch-files.sh` | Start Files if needed |
| `scripts/guest-status.sh` | Processes / log tails |

Host typecheck:

```bash
pnpm --filter @moire/ui typecheck
pnpm --filter @moire/shell typecheck
pnpm --filter @moire/files typecheck
pnpm --filter @moire/compositor typecheck
pnpm --filter @moire/ui smoke
```

### Smoke expectations

- Atmosphere wallpaper; panel brand **Moire** readable.
- Desktop icons with folder/file artwork; select and open work when no window covers them.
- Files Places selection correct; grid/list; drag shows a labeled chip under the cursor.
- Session runs compositor + Files + foot without Nautilus.

## Source map

```
apps/files/src/main.ts
apps/session/moire-session
packages/ui/src/widgets/{pressable,button,scroll,list,grid,icon,dnd,tabs}.ts
packages/ui/icons/*.png
packages/ui/src/platforms/wayland/index.ts
packages/ui/src/motion.ts
packages/shell/src/{DesktopIcons.tsx,controller.ts,Panel.tsx,Launcher.tsx}
packages/core/src/server.ts          # DnD session + paintDragPreview
packages/theme/src/index.ts
packages/prefs/src/
themes/default/theme.json
themes/light/theme.json
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Icons visible but ignore clicks | Window above them; or desktop handler not reached (focus / hit-test) |
| No drag preview | Drag not starting (move while held past threshold); guest logs `[ui/dnd] startDrag` / `[dnd] start`; icon surface commit |
| Home and Desktop both selected | Stale build — Places must use longest-prefix match |
| Flat / solid wallpaper | Theme or prefs not on `atmosphere`; re-apply Appearance or `guest-seed-desktop.sh` |
| White block “icons” | PNG load failed; confirm `packages/ui/icons` is on the guest worktree after rsync |
| Nautilus still appears | Guest session out of date — `guest-clean-restart.sh` |

Related: [dev-vm.md](./dev-vm.md), [known-issues.md](./known-issues.md), [parallels-drm-present.md](./parallels-drm-present.md).
