# Files

Day-0 file manager for Moire. Session starts Files and Moire Terminal; Nautilus
is not part of the Moire session after verification.

Package: `apps/bundled/files`.

## Features

| Area | Status |
| --- | --- |
| Browse directories | Grid and list views |
| Places sidebar | XDG user dirs plus persisted add/rename/remove favorites |
| Open / navigate | Back/Forward history; Up; clickable/drop-aware breadcrumbs; editable validated path |
| Default handler | `moire-files.desktop` for `inode/directory` |
| Open With | D-Bus-activated top-level chooser with app icons, keyboard selection, one-time launch, and default assignment |
| Context menu | Scoped action-provider registry; distinct item and background menus |
| Selection | Shared keyed grid/list model with toggle/range, keyboard navigation, Select All, group actions, and group drag payloads |
| DnD into cwd | `DropTarget` + `text/uri-list` |
| DnD out | `CollectionItem` composes narrow `useDragSource` behavior |
| Icons | Bundled PNG set via `Icon` |

## Toolkit usage

Files is a reference consumer of `@moire/ui`:

- `Application` + `Window`
- `Row` / `Column` / `ScrollArea` / `List` / `Grid` / `GridItem`
- `CollectionItem` / `useDragSource` / `DropTarget` with one semantic item hit target
- `PathBar` and real controlled `TextField` editing
- `ContextMenu` overlays and right-click scene events; Open With is a separate portal-owned window
- Theme tokens for chrome

The current visual pass gives navigation, location, favorites, selection
details, and content distinct hierarchy. The dedicated Widget Showcase proves
isolated APIs and renderer conformance; Files remains the realistic integration
surface where those primitives must hold up under navigation, DnD, and data.

## MIME associations and actions

Files resolves and launches paths through the shared `FileActivationService`
rather than constructing an extension-to-app table or picker model locally.
Its `MimeAssociationDatabase` inputs combine:

- shared-mime-info `globs2` and `subclasses`
- desktop entry `MimeType=` declarations
- `mimeapps.list` defaults/additions/removals
- `mimeinfo.cache`

“Always Use” updates the user `~/.config/mimeapps.list`. Context-menu entries
come from `ContextActionRegistry`; core actions and optional packages use the
same provider contract. See [Freedesktop MIME and actions](../freedesktop-mime-and-actions.md).

## Places and matching

Home, Desktop, and Downloads follow `user-dirs.dirs` when available. Edit mode
can pin the current folder, rename custom favorites, and remove them. Custom
entries are persisted in `~/.config/moire/files-places.json`.

Sidebar entries match the **longest** prefix of the current path so nested
folders under Desktop still highlight Desktop correctly (not a shorter Home
match).

## Default directory handler

`moire-session` installs:

- `apps/bundled/files/moire-files` as `~/.local/bin/moire-files`
- `apps/bundled/files/moire-files.desktop` under `~/.local/share/applications`
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
- Rubber-band and type-to-select
- Trash / undo
- MIME content sniffing and magic-rule matching (the first slice uses shared globs)

See [Roadmap](../roadmap.md) and [Files & desktop](../files-and-desktop.md).
