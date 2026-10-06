# Text Editor

`@moire/editor` opens local UTF-8 documents in native Moire windows. Start it with
`moire-editor [path-or-file-url ...]`; each argument opens its own window.
The launcher entry is `moire-editor.desktop`, with app ID `org.moire.Editor`.
It advertises `text/plain`, `text/markdown`, `text/x-log`, and `application/json`.

## Document workflow

Use Open to enter a local path or `file://` URL. New starts an empty document.
Save writes the current path; Save As chooses another path and asks before
replacing an existing file. Native window close, New, and Open all protect a
changed document with Save, Discard, and Cancel choices. A failed save leaves
the document open.

| Shortcut                          | Action                           |
| --------------------------------- | -------------------------------- |
| Ctrl+O                            | Open a local text file           |
| Ctrl+N                            | New document                     |
| Ctrl+S                            | Save                             |
| Ctrl+Shift+S                      | Save As                          |
| Ctrl+Z / Ctrl+Shift+Z             | Undo / redo text editing         |
| Ctrl+A / Ctrl+C / Ctrl+X / Ctrl+V | Select / copy / cut / paste text |

The shared `TextArea` owns caret movement, selection, clipboard, undo, and
scrolling. Editor owns paths, document state, prompts, and writes.

## Storage and limits

Editor writes a private temporary file next to the target, flushes it, and
publishes it atomically. Existing permissions remain intact. New paths use
exclusive publication; saved paths and their parent directories resolve
symlinks consistently. A content fingerprint rejects an overwrite after an
external edit or deletion. Use Save As to retain both versions.

Files must be UTF-8, contain no NUL bytes, and be at most 5 MiB when opened or
saved. The limit counts encoded UTF-8 bytes. An oversized save preserves the
existing file and leaves the edited buffer open. Successfully opening a different
document or creating a new one starts a fresh undo history; Save As keeps the
current document's history. Existing text,
including a UTF-8 BOM and line endings, remains in the document. New Enter input
inserts LF. The app has an explicit path form rather than a graphical file picker.
There is no encoding conversion, syntax highlighting, or filesystem watcher.

Run `pnpm --filter @moire/editor smoke` for actual headless Window editing,
Save As, native unsaved-close protection, permission preservation, and disposable
file conflict fixtures.
