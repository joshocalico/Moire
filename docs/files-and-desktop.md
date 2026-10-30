# Files, desktop icons, and drag-and-drop

Moire’s day-0 file story: a native **Files** app, **desktop icons** on the wallpaper, and **Wayland** `wl_data_device` drag-and-drop shared with other clients. Visual language and interaction live in `@moire/theme` + `@moire/ui` so shell chrome and Settings stay consistent.

Day-0 session apps: **Moire Files** + **Moire Terminal** (Nautilus is not
started by `moire-session`).

Rollback marker before this work: git tag **`v0.2.0`**.

**Deeper docs:** [Files](./apps/files.md) · [Desktop](./shell/desktop.md) · [DnD](./compositor/dnd.md) · [Widgets](./ui/widgets.md) · [Roadmap](./roadmap.md) · [Docs index](./README.md)

## Composite paint order

Bottom → top:

1. Wallpaper (`@moire/theme` — atmosphere / gradient / solid / image)
2. Desktop icons (`shell.paintDesktop`)
3. Client windows + SSD titlebars (stack order)
4. Panel / launcher (`shell.paint`)
5. Native client popups (`xdg_popup` menus and flyouts)
6. Drag preview (client drag-icon surface, or shell-owned desktop ghost)
7. Cursor

Desktop context menus and pickers are promoted to the shell overlay pass after
windows; only icons and drop feedback remain in the below-window desktop pass.

## Architecture

```
react-host (rect, text, image, clip, hits)
        ↓
@moire/ui (CollectionItem, useDragSource, ContextMenuTrigger, collections, overlays, motion)
        ↓
   apps/bundled/files   ·   shell DesktopIcons / Panel / Launcher   ·   Settings
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
| `Grid` / `GridItem` | Fixed cell size; set `interactive={false}` when wrapped in `CollectionItem` |
| `Icon` | PNGs in `packages/ui/icons/`; sync load; geometric fallback |
| `CollectionItem` / `useDragSource` / `DropTarget` | Item semantics, narrow drag behavior, and platform drop bridge |

Headless check: `pnpm --filter @moire/ui smoke`.

## Files app

Package: `apps/bundled/files` (`@moire/files`).

- Places: XDG-aware Home, Desktop, and Downloads plus persisted user favorites.
  Edit mode can pin the current folder, rename custom entries, and remove them;
  **longest matching path** is selected so Desktop does not also light up Home.
- Content: grid (default) or list; `fs` under `$HOME`; `fs.watch` refresh.
- Selection: one keyed model across both views; Ctrl/Command toggle, Shift
  range, Select All, arrows, Home/End, and Space. Multi-item context actions
  and `text/uri-list` drags carry the complete selection.
- Open: directories navigate; files via `xdg-open`.
- Launch target: accepts a filesystem path or `file://` URI; otherwise starts at `~/Desktop`.
- Default folder handler: session installs `moire-files.desktop` and associates it with `inode/directory`, so `xdg-open <folder>` opens Files there.
- DnD: `CollectionItem` composes `useDragSource` (`text/uri-list`); the view is a `DropTarget` that moves/copies into the current directory.
- Empty-space context menu is distinct from item menus and provides New Folder,
  Select All, Refresh, and view switching.
- Started by `apps/system/session/moire-session` and listed in the launcher.

## Desktop icons

Implementation: `packages/shell/src/DesktopIcons.tsx`, wired from `packages/shell/src/controller.tsx`.

- Contents of `~/Desktop`; positions in `~/.config/moire/desktop-layout.json`.
- Prefs: `showDesktopIcons` (default `true`).
- **Pointer:** compositor calls `onDesktopPointerButton` / `onDesktopPointerMotion` only when no client surface is under the cursor (after panel and SSD).
- Click selects; Ctrl toggles, Shift selects a range, and arrows move
  spatially. Home/End, Space, Select All, and group-aware context actions use
  the same keyed selection semantics as Files. Double-click opens.
- Drag past a small threshold starts a local shell drag (ghost preview). Release on empty desktop persists a new position; release over another desktop folder moves the item into it.
- Drag onto a client window (e.g. Files) instead escalates to a real Wayland
  DnD source — the target gets a normal `text/uri-list` containing the complete
  selection; local group moves retain relative icon positions. See
  [Wayland DnD](./compositor/dnd.md).
- Empty desktop is a drop sink for `text/uri-list` (`acceptDesktopDrop`).
- Empty desktop has its own context menu: New Folder, open in Files, arrange,
  refresh, and Change Background (routes to Settings → Appearance).

## Drag and drop

### Protocol path

1. Client `useDragSource` detects press + move threshold → `dndBridge.startDrag`.
2. Wayland UI creates a `wl_data_source`, offers mimes, builds a **source-sized SHM drag-icon surface** anchored at the pointer-down hotspot, then calls `wl_data_device.start_drag`.
3. Compositor runs enter / motion / leave / drop against the surface under the cursor.
4. Drop on a Moire UI window: client `data_offer.receive` → `notifyDrop` → `DropTarget.onDrop`.
5. Drop with no client target and `text/uri-list`: compositor reads the source and calls `shell.acceptDesktopDrop`.

`CollectionItem` owns the item hit target and composes narrow drag handlers.
Nested `GridItem` / `ListItem` use `interactive={false}` so there is one
semantic interaction owner rather than competing transparent hit layers.

### Preview

- Preferred: blit the client drag-icon surface at the cursor using its attach offset as the stable grab hotspot.
- Fallback / desktop reposition: `shell.paintDragPreview` renders the same-size desktop tile and preserves its grab point.
- Rejected/cancelled drops retain a pixel snapshot and ease it back to its drag-start position; successful desktop drops report `dnd_finished` instead of looking like cancellations.

### Limits

- No X11 XDND (Xwayland clients participate only via Wayland DnD).
- No Trash, removable-volume provider, network provider, or file thumbnails in this pass.
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
| `~/.config/mimeapps.list` | Default MIME handlers (`inode/directory` → Files) |
| `~/.config/moire/files-places.json` | Files custom sidebar favorites and labels |
| `~/.local/share/applications/moire-files.desktop` | Installed Files desktop entry |
| `~/.local/bin/moire-files` | Installed Files launcher symlink |

## Running and verifying

From the Mac (Parallels **MoireDev**):

```bash
prlctl exec MoireDev bash /media/psf/moire/scripts/guest-clean-restart.sh
prlctl capture MoireDev --file ~/Projects/moire/vm/screen.png
prlctl exec MoireDev runuser -u moire -- env HOME=/home/moire XDG_CURRENT_DESKTOP=Moire xdg-mime query default inode/directory
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
pnpm --filter @moire/shell smoke
pnpm --filter @moire/files smoke
```

### Smoke expectations

- Atmosphere wallpaper; panel brand **Moire** readable.
- Desktop icons with folder/file artwork; select and open work when no window covers them.
- Files Places selection correct; grid/list; drag shows a source-sized preview anchored at the original grab point.
- `xdg-open` on a folder launches Files at that requested folder.
- Desktop item dropped over a desktop folder moves into it; empty-desktop drop still repositions.
- Session runs compositor + Files + Moire Terminal without Nautilus.

## Source map

```
apps/bundled/files/src/main.tsx
apps/bundled/terminal/src/main.tsx
apps/system/session/moire-session
packages/ui/src/widgets/{pressable,button,text-field,breadcrumbs,interaction}.tsx
packages/ui/src/widgets/{scroll,list,grid,icon,dnd,tabs}.ts
packages/ui/icons/*.png
packages/ui/src/platforms/wayland/index.ts
packages/ui/src/motion.ts
packages/shell/src/{DesktopIcons.tsx,controller.tsx,Panel.tsx,Launcher.tsx}
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
| Folder opens in another file manager | Restart the session; verify `xdg-mime query default inode/directory` returns `moire-files.desktop` |
| Files opens Desktop instead of requested folder | Stale launcher/desktop entry; run `guest-clean-restart.sh` and confirm `moire-files %U` is installed |
| Flat / solid wallpaper | Theme or prefs not on `atmosphere`; re-apply Appearance or `guest-seed-desktop.sh` |
| White block “icons” | PNG load failed; confirm `packages/ui/icons` is on the guest worktree after rsync |
| Nautilus still appears | Guest session out of date — `guest-clean-restart.sh` |

Related: [dev-vm.md](./dev-vm.md), [known-issues.md](./known-issues.md), [parallels-drm-present.md](./parallels-drm-present.md).
