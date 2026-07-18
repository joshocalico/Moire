# Files

Day-0 file manager for Moire. Session starts Files (and foot); Nautilus is not part of the Moire session after verification.

Package: `apps/files`.

## Features

| Area | Status |
| --- | --- |
| Browse directories | Grid and list views |
| Places sidebar | Home, Desktop, Downloads, … — longest-prefix path match |
| Open / navigate | Double-click; Up; accepts a path or `file://` URI at launch |
| Default handler | `moire-files.desktop` for `inode/directory` |
| Open With | MIME-filtered picker; one-time launch or write a new default |
| Context menu | Shared action-provider registry; right-click in grid and list |
| DnD into cwd | `DropTarget` + `text/uri-list` |
| DnD out | `Draggable` per item |
| Icons | Bundled PNG set via `Icon` |

## Toolkit usage

Files is a reference consumer of `@moire/ui`:

- `Application` + `Window`
- `Row` / `Column` / `ScrollArea` / `List` / `Grid` / `GridItem`
- `Draggable` / `DropTarget` with `interactive={false}` on nested items
- `ContextMenu` / `OpenWithPicker` overlays and right-click scene events
- Theme tokens for chrome

The current visual pass gives navigation, location, favorites, selection
details, and content distinct hierarchy. Files remains the main widget showcase:
new interaction primitives should be proven here before proliferating through
the rest of the desktop.

## MIME associations and actions

Files resolves a path through `MimeAssociationDatabase` rather than assuming
an extension-to-app table. Candidate applications combine:

- shared-mime-info `globs2` and `subclasses`
- desktop entry `MimeType=` declarations
- `mimeapps.list` defaults/additions/removals
- `mimeinfo.cache`

“Always Use” updates the user `~/.config/mimeapps.list`. Context-menu entries
come from `ContextActionRegistry`; core actions and optional packages use the
same provider contract. See [Freedesktop MIME and actions](../freedesktop-mime-and-actions.md).

## Places matching

Sidebar entries match the **longest** prefix of the current path so nested folders under Desktop still highlight Desktop correctly (not a shorter Home match).

## Default directory handler

`moire-session` installs:

- `apps/files/moire-files` as `~/.local/bin/moire-files`
- `apps/files/moire-files.desktop` under `~/.local/share/applications`
- `moire-files.desktop` as the `inode/directory` default via `xdg-mime`

`xdg-open` first determines the target MIME type, queries the default desktop entry, then runs its `Exec` command. For a directory, Moire's entry passes the path/URI to Files, so desktop folders and external callers open at the requested location rather than always starting at `~/Desktop`.

Verify in the guest:

```bash
xdg-mime query default inode/directory
# moire-files.desktop

xdg-open ~/Downloads
```

## Gaps / roadmap

- Richer copy/move conflict UI
- Thumbnails for images
- Multi-select and rubber-band
- Trash / undo
- MIME content sniffing and magic-rule matching (the first slice uses shared globs)

See [Roadmap](../roadmap.md) and [Files & desktop](../files-and-desktop.md).
