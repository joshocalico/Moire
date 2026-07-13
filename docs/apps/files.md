# Files

Day-0 file manager for Moire. Session starts Files (and foot); Nautilus is not part of the Moire session after verification.

Package: `apps/files`.

## Features

| Area | Status |
| --- | --- |
| Browse directories | Grid and list views |
| Places sidebar | Home, Desktop, Downloads, … — longest-prefix path match |
| Open / navigate | Double-click; Up |
| DnD into cwd | `DropTarget` + `text/uri-list` |
| DnD out | `Draggable` per item |
| Icons | Bundled PNG set via `Icon` |

## Toolkit usage

Files is a reference consumer of `@moire/ui`:

- `Application` + `Window`
- `Row` / `Column` / `ScrollArea` / `List` / `Grid` / `GridItem`
- `Draggable` / `DropTarget` with `interactive={false}` on nested items
- Theme tokens for chrome

## Places matching

Sidebar entries match the **longest** prefix of the current path so nested folders under Desktop still highlight Desktop correctly (not a shorter Home match).

## Gaps / roadmap

- Richer copy/move conflict UI
- Thumbnails for images
- Multi-select and rubber-band
- Trash / undo

See [Roadmap](../roadmap.md) and [Files & desktop](../files-and-desktop.md).
