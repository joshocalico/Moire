# Notes

`@moire/notes` keeps notes on this computer. Its launcher entry is
`moire-notes.desktop`, command `moire-notes`, and app ID `org.moire.Notes`.

Choose All notes, Pinned notes, or a notebook in the navigation pane. New
notebook creates a named local notebook; type its name and press Enter. New note
or Ctrl+N creates a note in the selected notebook. Search matches titles and
plain text. Preview rows show the notebook, edited date, and a short excerpt.
Click a row to select it; arrows, Home, and End navigate the collection, and
Enter opens its editor. The document's Save button flushes the draft. The More
menu contains Rename, Pin, Move, Reload, and Delete. Ctrl+Shift+M or the Menu key
opens those actions from the keyboard. Pin and Move change saved metadata.
Rename, or clicking the title, edits the title. Notebooks remain local and cannot be
renamed or deleted in this version.

The editor saves bold, underline, and highlight as text ranges. Select text with
Shift+arrows or a pointer drag; the floating toolbar follows the visible
selection, including after scrolling and resize. The shared editor reserves
clearance above the first visible line so those actions do not cover the next
paragraph. Ctrl+B toggles bold, Ctrl+U
underline, and Ctrl+Shift+H highlight. Ctrl+Z undoes text or formatting;
Ctrl+Shift+Z or Ctrl+Y redoes it. Undo restores the associated selection. History
lasts for the mounted editor, up to 100 document changes; reopening a note starts
a new history. Copy, cut, and paste use the system text clipboard. Clipboard
transfer carries plain text; pasted text inherits the current typing style.

The shared window header provides real move, minimize, maximize, and close
actions. Closing through its button uses the same save guard as native close.
At narrow sizes, pane buttons expose Notebooks, Notes list, and Editor without
squeezing all three into the window. The document and selection remain mounted
when changing panes. At larger sizes, shared pane dividers support pointer and
keyboard resizing.

Drafts save after a 400 ms pause; Ctrl+S and Save flush immediately. Switching
notes or closing the native window also flushes a draft. A failed save keeps the
draft and blocks window close. Delete asks for confirmation. Reload reads the
saved notebook and asks before discarding an unsaved draft. A conflict from
another Notes window leaves the current draft visible; copy it elsewhere before
reloading if needed.

## Local storage

In the immutable ISO, saved notes live in RAM. They survive app relaunch during
that boot and disappear when the VM powers off.

Storage is `$XDG_DATA_HOME/moire/notes/notes.json`, or
`~/.local/share/moire/notes/notes.json`. Files use mode 0600; newly created storage
directories use mode 0700. Version 2 JSON stores stable notebook and note IDs,
titles, canonical plain-text bodies, sparse formatting runs, notebook membership,
pinned state, and timestamps. Version 1 plain notes migrate in memory to the
local Notes notebook. Reading old data leaves its original bytes untouched;
the next successful save writes version 2.

Storage rejects duplicate IDs, invalid notebook references, malformed ranges,
surrogate-splitting boundaries, and unsupported formatting without replacing the
original. Each save holds a short process-owned write lock, checks the saved
revision, flushes an exclusive temporary file, and atomically replaces storage.
A dead process's lock can be recovered. Search never modifies data. Storage is
limited to 10 MiB; an oversized save leaves the previous file and current draft
intact and shows an error.

The editor uses UTF-16 offsets and moves/deletes complete Unicode code points.
It does not provide IME composition, bidirectional layout, or grapheme-cluster
navigation; combining marks and joined emoji may require multiple key presses.
Italic, links, headings, lists, attachments, embedded objects, and rich clipboard
transfer are unsupported. Notes has no cloud sync, automatic conflict merge,
notebook rename/delete, or deleted-note recovery.

## Verification

Run `pnpm --filter @moire/notes smoke` and
`pnpm --filter @moire/notes exec tsx src/rich-document.smoke.tsx`. The fixtures use
real Windows and disposable storage to cover save/reopen, painted formatting,
selection undo/redo, notebook creation/moving, pin/search, compact resize, native
close conflicts, migration, dead-lock recovery, and corrupt-data preservation.
Shared editor/model/layout smokes cover code-point boundaries, styled kerning,
clipboard, pointer toolbar focus, scroll/resize, and actual pixels at UI scales
1 and 1.5. `packages/ui/scripts/notes-document-gallery.smoke.tsx` captures real
headless Windows at wide and compact sizes with optional output directory
`MOIRE_NOTES_GALLERY`. These checks do not claim native Wayland or EGL validation.

Headless captures, source-backed workflow logs and their acceptance limits are
recorded in `vm/verification/2026-10-02-app-suite/notes-v1-headless`. The current
rich-document and pane implementation is available in source; those results do
not approve the native desktop or the full visual reference.
