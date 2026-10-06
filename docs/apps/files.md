# Files

File manager for Moire. The session starts Files and Moire Terminal. The
October quality candidate adds file operations, organisation, transfer
progress and a selection-dependent inspector. Files v1 adds native titlebar folder
tabs, shared adaptive panes, and a dense virtualized table. Desktop interaction acceptance
remains open; see [Quality review](../quality-review.md).

Package: `apps/bundled/files`.

## Features

| Area               | Status                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Browse directories | Grid and list views; independent folder tabs                                                                                                         |
| Places sidebar     | XDG user dirs plus persisted add/rename/remove/reorder favorites                                                                    |
| Open / navigate    | Back/Forward history; Up; clickable/drop-aware breadcrumbs; editable validated path                                         |
| Default handler    | `moire-files.desktop` for `inode/directory`                                                                                 |
| Open With          | D-Bus-activated top-level chooser with app icons, keyboard selection, one-time launch, and default assignment               |
| Context menu       | Scoped action-provider registry; distinct item and background menus                                                         |
| Selection          | Shared keyed grid/list model with toggle/range, keyboard navigation, Select All, group actions, and group drag payloads     |
| DnD into cwd       | `DropTarget` + `text/uri-list`                                                                                              |
| DnD out            | `CollectionItem` composes narrow `useDragSource` behavior                                                                   |
| Icons              | Bundled PNG set via `Icon`                                                                                                  |
| Directory states   | Asynchronous loading, actionable read failures, empty folder and filtered results                                           |
| Views and sorting  | PNG grid thumbnails; list columns for type, size and modified time; folders first with ascending/descending sorting         |
| File operations    | Named folder/file creation, rename, cut/copy/paste, Copy To / Move To and undo for moves/renames                            |
| Transfers          | Byte/file progress, rate and remaining-time estimate; cancel; Keep Both / Skip / Cancel collision choices                   |
| Trash              | Recoverable deletion and Restore; no permanent-delete or empty-Trash action                                                 |
| Tags               | Persisted tags, sidebar collections, bulk add/remove and relocation with app-owned operations                               |
| Inspector          | Current-folder, single- and multi-selection metadata; permissions/owner/times; bounded PNG/text previews; connected actions |

## Keyboard and organisation

The first file item receives keyboard focus when a folder opens, with no item
selected. Arrows and Home/End browse, Space selects, Shift extends a range, and
Enter opens the focused item. This works in both grid and list views. Ctrl+L
opens validated path entry. Ctrl+F focuses filename filtering; Escape clears it
and returns focus to the file view. Escape from path entry also returns to the
file view. Navigation resets selection; refreshes retain existing selected paths.

Ctrl+A selects all entries. Ctrl+C / X / V copy, cut and paste;
F2 renames; Delete sends the selection to Trash; Ctrl+Shift+N creates a named
folder; Ctrl+H toggles hidden files and F5 refreshes. Operation shortcuts are
suspended while editing text or using a modal dialog.

The toolbar contains navigation, path, search and view controls. File operations
are in item context menus; creation, Paste, Undo and sorting are in the folder
background menu. Shift+F10 or the Menu key opens actions for the selection, or
the current folder when nothing is selected. Rename requires one selected item;
Copy/Cut and transfer actions work on a group. Paste requires an internal file
clipboard, and Undo requires a recoverable operation.

Each folder tab owns its history, filename query, tag collection, selection,
keyboard focus and scroll offset. Ctrl+T opens a tab in the current folder;
Ctrl+W closes it; Ctrl+Tab and Ctrl+Shift+Tab cycle tabs. Folder item menus also
offer Open in new tab. File operations, tags and the internal clipboard have
one owner for the whole window, so Copy in one tab and Paste in another work
without separate operation queues. Tabs and native close are guarded during
an active operation.

The shared adaptive panes keep Places, Files and Preview visible when their
minimum widths fit. Narrow windows offer shared pane buttons and dismissible
overlays. Pane state stays mounted; divider changes and Preview visibility are
persisted. The inspector leads with a real bounded preview and primary metadata.
More details exposes permissions, ownership and the remaining timestamps;
Selection actions exposes Open, Reveal, Rename, Copy full path and Organise.
Its Organise Selection action opens file actions. Add comma-separated tags
in the inspector, then browse those collections from the sidebar. Tags are
app metadata keyed by absolute path, not filesystem extended attributes.
Copies made in Files inherit tags; rename, move, Trash and Restore relocate
them. External renames are not tracked. Collections include existing files
across folders; missing paths are omitted.

View, sort, hidden files, pane widths and Preview visibility are stored in
`~/.config/moire/files-view.json`; tags in `~/.config/moire/files-tags.json`.
Corrupt tag metadata is reported and preserved. The immutable VM keeps all
of these files in disposable RAM, so they survive app restarts but not a VM
shutdown.

## Transfer and recovery behavior

Copying stages each item privately and publishes it only after its contents
are complete. A collision never replaces an existing destination. Keep Both
uses a numbered name; Skip leaves it alone. Cancellation removes the current
partial staging item and retains already completed copies. The outcome dialog
reports completed/skipped work and errors. A retry can encounter those completed
items and uses the same collision choices.

Directories retain permissions and timestamps; symbolic links are copied as
links. A source changed during transfer produces an error. Move currently
requires the same filesystem. The app reports unsupported cross-filesystem
moves instead of silently falling back to a destructive copy/delete operation.
Undo covers individual moves and renames. One Undo restores the completed items
from a group Trash action, including a cancelled or partially failed action.
Manually restoring an item removes it from that action's Undo history. If a
restore conflicts with an existing name, completed restores remain and Undo can
retry the items still in Trash after the conflict is resolved. Undo does not
roll back an entire large transfer. The clipboard is local to this Files
window.

PNG previews are limited to 8 MiB. Text previews read up to 4 KiB from recognised
text files and show a bounded excerpt. Folder contents count immediate entries,
not a recursive byte total. Multi-selection metadata is computed from the
current files rather than placeholder values.

## Toolkit usage

Files is a reference consumer of `@moire/ui`:

- `Application` + `Window`
- `WindowFrame` / titlebar `Tabs` with native move/close/minimize/maximize actions
- `AdaptivePanes` / `NavigationSidebar` / `Table` / `Grid` / `GridItem`
- `Row` / `Column` / `ScrollArea` / `PropertyList`
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
can pin the current folder, rename custom favorites, and remove them. Pin current folder and Edit places are available from context menus. Provider
places retain their supplied order; custom favorites can be reordered. Custom
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

- Live desktop acceptance: movement/resize/overlap, focus, native popup menus,
  repeated and interrupted workflows on both renderer paths
- Cross-filesystem moves, a multi-operation queue and external file clipboard
- Recursive/content search and thumbnails beyond bounded PNG previews
- Rubber-band and type-to-select
- Installed removable-device acceptance and network providers
- MIME content sniffing and magic-rule matching (the first slice uses shared globs)

## Verify with disposable fixtures

Removable-drive source support and its installed limitations are documented in
[Removable drives](../removable-drives.md). C48 uses private services and temporary
folders; the preserved C47 image does not contain it.

```bash
pnpm --filter @moire/files smoke
pnpm exec tsx packages/ui/src/widgets/files-adoption.smoke.tsx
pnpm --filter @moire/files smoke:visual -- --output=vm/verification/2026-10-02-app-suite/files-v1-headless/after
pnpm --filter @moire/ui smoke:desktop
pnpm --filter @moire/ui smoke:polish
pnpm --filter @moire/sys smoke:keyboard
```

These checks create isolated temporary folders and exercise real filesystem
effects and window dispatch. Files tests cover both collection views, tab state
isolation, grouped Copy/Trash/Undo/Restore, incoming DnD, 1,200-file sorting and
focus reveal, capacity/count metadata and preview pixel centering at two UI
scales. Shared adoption checks cover grouped Table drag/context semantics,
virtualization, filtered Grid scroll restoration and titlebar keyboard focus.
Visual fixtures capture real window controls, botanical PNG previews, tags and
item menus. They supplement live review, not replace it.

See [Roadmap](../roadmap.md) and [Files & desktop](../files-and-desktop.md).
