# Files redesign

Status: plan, 2026-10-10. Combines three explored directions:

- **Overview (D):** an icon rail instead of the sidebar, Home as a dashboard, and folders as
  pages with a large title and filter chips.
- **Columns (E):** a third view mode beside list and grid.
- **Search-first (F):** typing anywhere turns the page into search results, backed by a new
  indexing service.

Behaviour stays as it is: context menus, drag and drop, Trash, the operation queue with Undo,
tabs and keyboard control. This is a new face on the same model, plus search.

## 1. Window structure

```
┌────┬──────────────────────────────────────────────────────────────┐
│ ▣  │ ←  →   [ 🔍 Search Projects ...................... ]  ⋯  – □ × │  top bar, 52px
│────│──────────────────────────────────────────────────────────────│
│ ⌂  │ [Projects ×] [Downloads ×] [+]                                │  tab strip: 2+ tabs only
│ 🕘 │                                                              │
│ 🖼 │  Home / Work /                                                │  path line (segments)
│ 📄 │  Projects                          Modified ↓   [☰ ▦ ⫴]      │  title row
│ ⬇ │  (All 10) (Folders 3) (Images 1) (Documents 4) …              │  filter chips
│ ♫  │                                                              │
│ 🗑 │  page content (list, grid or columns)                       │
│────│                                                              │
│ 💾 │                                    [ 2 selected · Open … ]   │  selection bar
└────┴──────────────────────────────────────────────────────────────┘
```

- **Undecorated window:** the app draws its own top bar, as `AppHeaderBar` apps do.
- **Rail (64px):**
  - At the top, the app badge: it toggles the rail between icons only and a labelled
    200px sidebar. The choice is remembered.
  - Places: Home (the Overview), Recent, Documents, Downloads, Pictures, Music, Trash.
  - Below a divider, user bookmarks, then drives (removable ones show eject on hover).
  - Every item has a tooltip, is a drop target, and has its own context menu. These are the
    current sidebar's menus.
- **Top bar:**
  - Back and forward.
  - The search field, centred. It is the command bar (§5) and its placeholder names the scope.
  - ⋯ for the window menu: New Tab, New Window, Show Hidden, Keyboard Shortcuts.
  - The window controls.
- **Tab strip:** appears only with two or more tabs and keeps the current behaviour: closable,
  reorderable, a drop target and a context menu. With one tab there is no strip.
- **Status line:** removed. Counts move to the title row's subtitle and the selection bar.
- **Operation progress:** the existing queue and outcome strip becomes a card at the bottom
  right, above the selection bar, with progress, Cancel and Undo.

## 2. Pages

### Home (Overview)

The Home rail item opens the home folder as a page with extra sections above its contents:

1. **Title:** "Home", with "160 GB free of 256 GB" and a thin capacity bar.
2. **Pinned:** tinted folder cards, from the bookmarks (defaults: Documents, Pictures,
   Downloads, Music). Each has a ⋯ menu (Unpin, Open in New Tab, Properties). Drag a folder
   onto the section to pin it.
3. **Recent:** a strip of up to 8 thumbnail cards with the file name and relative time. They
   come from the index's recently opened or modified files (§6); before the index is ready,
   from the apps' recent-file lists. "See all" opens the Recent page.
4. **Browse by kind:** chips with counts (Images, Documents, Audio, Video, Archives, Large
   files). Each opens search with that kind as a token.
5. **Home's own contents**, as on any folder page (§2.2), headed "In Home".

Sections are hidden when empty: no pinned folders, no recent files, or no index yet.

### Folder page

- **Path line:** the ancestor segments as small buttons ("Home / Work /"). Each is a drop
  target. Clicking empty space on the line, or Ctrl+L, swaps it for a path field with Tab
  completion. That field already exists.
- **Title:** the folder name at 26px, then the subtitle "10 items · 4.3 MB · Modified today".
  On the right: a sort button ("Modified ↓") whose menu has Name, Size, Modified, Kind and
  Reverse, then the view toggle (list, grid, columns).
- **Filter chips:** All, plus one chip per kind present, with counts. One chip is active at a
  time. They filter the page without searching. When there are more kinds than fit, the rest
  go under a "More" chip.
- **List view:**
  - **Folders:** cards in a wrapping row of 3 or 4 per line. With more than 12 folders, 8 show
    plus a "Show all N folders" card.
  - **Files:** 46px rows: a thumbnail or kind tile, then the name over "kind · size", with the
    date on the right.
  - **Hover:** the row under the pointer replaces its date with actions (Open, Copy, Move to
    Trash, ⋯).
  - **Selection:** a filled pill. Shift and Ctrl selection and rubber band work as they do
    today. Type-to-select becomes part of search (§4).
- **Grid view:** file tiles. Thumbnails for images and type badges for other files.
- **Columns view:**
  - Miller columns from Home down to the current folder, each 220px, with the selection
    carried along. Below 760px only the last two columns show.
  - The final column is a preview pane: image or icon, name, details and Open.
  - The path line and title stay, and the title follows the deepest column.
- **Empty folder:** an `EmptyState` with New Folder and Paste, and "Drop files here".
- **Unreadable folder:** an `EmptyState` with the error and "Open in Terminal" (when a terminal
  app is installed).

### Recent, Trash and drives

- **Recent:** files grouped Today, Yesterday, This week and Earlier, in the list style with
  thumbnails. It comes from the index; without one, from the apps' recent lists.
- **Trash:**
  - The title row has Empty Trash (danger, with a confirmation). The subtitle reads
    "3 items · 12 MB".
  - Rows show the original location and the deletion date. Hover actions are Restore and
    Delete Permanently.
- **Drive:** the title row shows a capacity bar and an Eject button.

## 3. Selection and actions

- **Selection bar:** with one or more items selected, a floating bar sits at the bottom centre:
  count and size, then Open, Copy, Move to…, Trash and ⋯. With exactly one item selected, the
  bar is not shown and the row's own actions do the job.
- **⋯ menus:** the existing context-menu catalog, so they match right-click.
- **Preview (Space):** opens a large preview sheet (image, text excerpt or icon, with details)
  that arrow keys page through. Escape or Space closes it. This replaces the always-open
  inspector.
- **Properties (Alt+Enter, or ⋯ › Properties):** opens the existing inspector content as a
  side sheet: tags, permissions, sizes.

## 4. Keyboard

| Keys                          | Action                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| Arrows                        | Move through folder cards and then rows, as one focus order                 |
| Enter                         | Open                                                                        |
| Space                         | Preview                                                                     |
| Typing a letter               | Starts a search of this folder (§5), which also does type-to-select (below) |
| Ctrl+L                        | Edit the path                                                               |
| Ctrl+F                        | Focus search                                                                |
| Ctrl+1 / 2 / 3                | List, grid, columns                                                         |
| Alt+Left / Alt+Right / Alt+Up | Back, forward, parent folder                                                |
| Ctrl+T / Ctrl+W               | New tab, close tab                                                          |
| F2                            | Rename                                                                      |
| Delete / Shift+Delete         | Move to Trash / Delete Permanently                                          |
| Ctrl+Shift+N                  | New folder                                                                  |
| Ctrl+B                        | Toggle the rail labels                                                      |

Rail items take Ctrl+Alt+1–9. The existing shortcuts in `shortcuts.ts` stay unless listed here.

> **Type-to-select:** search does this job. Typing searches the current folder, and names
> starting with the typed text rank first, so the best match is the file type-to-select would
> have picked. Enter opens it. ↓ or Escape returns to the folder with the best match selected
> and scrolled into view. Clearing the field returns without changing the selection. Ctrl
> shortcuts (Ctrl+A, C, X, V, Z, N…) are never taken by typing.

## 5. Search

- **Starting a search:** focusing the search field, or typing on a page, turns the page into
  results. Escape, or clearing the field, returns to the page.
- **Tokens:**
  - The field holds free words plus tokens: `kind:image`, `when:today|week|month|year`,
    `size:>10mb`, `tag:travel` and `in:<folder>`.
  - Typing `kind:` offers completions, and Tab accepts one. A token renders as a chip and
    Backspace removes it.
  - The rail's kind chips and "Browse by kind" insert tokens.
- **Scope chips:** "This folder" (the default inside a folder), "Home", "Everywhere" (all
  indexed roots), and any mounted drives.
- **Results:**
  - A best match card: thumbnail, name, path, size, time and tags, with Open and Show in
    Folder.
  - Then groups by kind (Folders, Images as a thumbnail strip, Documents, Audio, Other). Each
    group shows 5 to 8 results and a "Show all N" link that adds that kind as a token.
  - Each result says why it matched: name, folder, tag, or "text: …excerpt…".
  - Arrow keys move through the results, Enter opens, and Ctrl+Enter shows the file in its
    folder.
- **Speed:** results update as you type, debounced by 80ms.
- **Without the index:** search falls back to a breadth-first scan of names under the scope,
  capped at 2,000 entries and 300ms, and says "Searching names only; indexing is off".
- **No results:** an `EmptyState` with "Search everywhere" when the scope was narrower.

## 6. Indexing service (`apps/system/index-service`)

A session service in TypeScript, launched by the compositor beside `moire-management`.

- **Storage:**
  - `node:sqlite` at `$XDG_CACHE_HOME/moire/index.db`.
  - Tables: `files(path, name, dir, kind, size, mtime, atime, hidden)`, plus FTS5 tables over
    names and extracted text.
  - Schema versioned; on a version change the index is rebuilt, never migrated in place.
- **Roots:**
  - Home, excluding: hidden directories, `~/.cache`, Trash, `node_modules`, `.git`, build
    output (`dist`, `target`, `result`), the folders Settings › Search excludes
    (`indexExcludes` in `settings.json`), and anything matching `~/.config/moire/index.json`
    excludes (a hand-edited supplement Settings shows but never rewrites).
  - Removable drives only when the user turns them on per drive (`indexIncludes`, or
    `index.json` `include`).
- **Crawling:**
  - The first crawl is breadth-first with a small batch per tick (yield every 200 entries). It
    is paused while the session reports the system is busy or on battery under 20%.
  - After that, `fs.watch` with `recursive: true` keeps it current.
  - A periodic reconcile pass (every 30 minutes, staggered) catches anything the watcher
    missed.
- **Content:**
  - Plain text, Markdown, source code, and `.ods`/`.odt` (`content.xml`, already parseable
    through the archive code), up to 1 MB per file.
  - PDF text (FlateDecode streams, Tj/TJ operators, ToUnicode and simple encodings; best
    effort) and `.docx` text. EXIF dates and camera fields for JPEGs. The readers live in
    `packages/file-formats`, shared with Files' previews.
- **Recent:** files opened through Moire apps (the existing per-app recent lists, watched) plus
  files modified in the last 14 days.
- **API:** D-Bus `org.moire.Index` on the session bus through `@moire/dbus`:
  - `Search(query, scope, limit)` returns grouped results with match reasons.
  - `Recent(limit)`, `KindCounts(scope)` and `Status()` (state, counts, progress).
  - `Reindex(root)`.
  - A `Changed` signal.
- **Client:** `packages/system-management/src/index-status.ts`, typed and following the
  existing status clients' shape.
- **Privacy:**
  - The index lives only in the user's cache.
  - Settings › Search has an on/off switch, excluded folders and "Clear index".
  - Turning indexing off deletes the database.
- **Budget:** under 80 MB RSS, with no measurable input latency during the crawl. The crawl
  runs at idle I/O priority (`ionice` when available, through `spawn`).

## 7. New `@moire/ui` widgets

Each gets general props, its own smoke, and a gallery entry.

| Widget                    | Purpose                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NavigationRail`          | An icon rail with a selected pill, tooltips, sections, a footer, and an `expanded` mode that shows labels (it then renders like `NavigationSidebar`) |
| `FilterChip`, `ChipGroup` | Toggle or plain chips with a leading icon and a count; the group wraps or overflows into a "More" chip                                               |
| `IconSegmentedControl`    | Segments that are icons, each with a tooltip                                                                                                         |
| `TokenField`              | A search field with token chips, completions and Backspace to remove a token                                                                         |
| `SelectionBar`            | A floating bar: count, detail and action buttons; the actions that don't fit move to ⋯                                                               |
| `FileTile`                | A thumbnail or kind tile with an extension badge, name and detail; selected, hover and drop-target states                                            |
| `ItemCard`                | A tinted card with an icon, title, detail and an optional ⋯; used for pinned and folder cards                                                        |
| `HoverActions`            | A row slot that shows its actions on hover or focus and otherwise its trailing text                                                                  |

Miller columns stay in the Files app (`columns.tsx`) until another app needs them.

## 8. Implementation phases

1. **In parallel:**
   - **a. Widgets:** the §7 widgets in `packages/ui`.
   - **b. Index:** the indexing service, its client, and Files' search model: query parsing,
     tokens, the fallback scan and grouping. Pure, with smokes.
2. **Files UI:** the new shell (rail, top bar, tab strip, pages, list/grid/columns, selection
   bar, preview sheet, search page), on the existing hooks (`use-directory`,
   `use-operations`, `use-commands`, `menus`, DnD).
   - The old toolbar, sidebar, status line and fixed inspector go.
   - The inspector's content moves into the Properties sheet.
   - Existing smokes keep their behavioural intent, updated for the new controls.
3. **Settings › Search page;** the compositor starts the service; nix wiring and an install
   check.
4. **Verification:**
   - Typecheck and all smokes.
   - Gallery: 0 overflow at 640×650 and 1020×975, scale 1 and 1.5.
   - Visreg previews of each page.
   - A fresh ISO tested in the VM.

## 9. Sanity test (rendered mock states)

States rendered with the real widgets: two tabs with a selection, a collapsed header, and
640×650. What they showed, and the fix for each:

1. **The selection bar covers the last rows.** While the bar is shown, the page gets bottom
   padding of the bar's height plus 16px. Scrolling a row into view leaves room for the bar.
2. **The header is too tall for short windows.** The path, title, chips and folder cards put
   the first file at about y=290. Scrolling collapses the title into the top of the page:
   "Projects · in Home / Work" on one line, with the chips pinned below it. Under 700px tall
   the page opens already collapsed.
3. **The tab strip looks like segments.** It uses compact pill tabs, the titlebar style of
   `Tabs`, 32px tall, and the strip is 36px.
4. **The sort control reads as plain text.** It becomes a ghost button with a chevron.
5. **640px wide holds up.** Folder cards go 2-up and the chips fit. The selection bar fits
   four actions; below 560px the actions that don't fit move to ⋯.

## 10. Open questions

- Should "Everywhere" include removable drives by default? Proposed: no, opt in per drive.
- Recent on the rail and in Overview: both? Proposed: yes; the rail opens the full page.

## 11. Inspector

Status: built, 2026-10-10 (variant A), in `apps/bundled/files/src/views/inspector/`. One change
from the mocks: the pane is docked, not an overlay. The page reflows into the room left of it, so
rows, dates, hover actions and the selection bar stay visible. When that room would be under
420px (a 640px window), the pane covers the page over a scrim instead. The pane has no Pin
button, because docking already keeps it in place. Smokes: `inspector.smoke.tsx`,
`inspector-actions.smoke.tsx`, `columns.smoke.tsx`.

The Properties sheet today repeats the file name as a fake text preview, then a plain table, then
three collapsed `Disclosure`s. The preview model (`preview/model.ts`) now knows far more than
the sheet shows. The proposal makes the sheet a kind-aware inspector built from the same parts as
the Space sheet and the columns pane.

### Layout

Two variants were mocked. **A is proposed.**

- **A. Hero + cards (scrolling).** 380px wide (60% of the page at most), header "Properties" with
  Pin and Close. Then, in one scrolling column:
  1. **Hero:** the kind-specific preview (below), full width.
  2. **Title block:** name at 18 medium with a Rename button (F2, inline edit in place); caption
     "JPG image · 54.9 KB · Today, 17:19"; action row **Open** (primary), **Open With ▾** (the
     app menu; folders get **Open in New Tab**) and ⋯ (the item's context menu).
  3. **Cards:** Information, Tags, Location, Sharing & permissions, Opens with, History. Each is a
     `Surface` card with a muted heading.
- **B. Compact header + tabs.** A 56px thumbnail beside the name, the same action row, then a
  `SegmentedControl` (Info / Preview / Sharing). Less scrolling, but it hides the preview behind a
  tab and splits related facts. It is the better fit only if the sheet must stay under ~320px.

At 640×650 the sheet is 345px wide and A holds: the action row keeps Open, Open With and ⋯.

### Heroes by kind

| Kind         | Hero                                                                                                                                                     | Built from                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Image        | Picture fitted, pills over it (dimensions, camera); under it a luminance histogram and up to six dominant colours                                        | `Thumbnail` (contain); **proposed** pill, histogram and swatches               |
| Audio        | Cover, title, artist, album · year, track; play, scrub `Slider`, position / duration                                                                     | `Thumbnail`, `IconButton` + `MediaGlyph`, `Slider`; mpv via `useAudioPlayback` |
| Video        | Poster with the duration badge and a centred play button                                                                                                 | `PreviewStage` (video); **proposed** play overlay                              |
| PDF          | First page with a "‹ Page 1 of N ›" stepper pill                                                                                                         | `Thumbnail`; **proposed** stepper                                              |
| Code         | Highlighted excerpt with line numbers; language badge, "N lines · encoding", Copy                                                                        | `CodeView`                                                                     |
| Markdown     | Rendered excerpt with a Rendered / Source toggle                                                                                                         | `MarkdownView`, `SegmentedControl`                                             |
| Font         | Specimen, then a Regular / Medium / Bold picker                                                                                                          | `PreviewStage` (font), `SegmentedControl`                                      |
| Archive      | Top entries, "Extract here", packed → unpacked and "% smaller" with a bar                                                                                | `PreviewStage` (archive), `Button`, `ProgressBar`                              |
| Folder       | Mosaic of the first four pictures inside; "N items · N folders" and total; size by kind as a stacked bar with a legend                                   | `Thumbnail` per child; **proposed** stacked bar                                |
| Multi-select | Up to three thumbnails fanned; "3 items", "104.5 KB · 2 images · 1 document"; "Open all"; an "Apply to all" card (Compress, Move to…, Copy to…, Rename…) | `Thumbnail`, `Button`                                                          |

### Cards

- **Information:** Kind, Size (with exact bytes), then `previewFacts()` for the kind. Multi-select
  shows Items, Total size, Modified range, Location and a permissions summary.
- **Tags:** chips with a colour dot and ×, an "Add tag" chip that turns into a field, and dashed
  suggestion chips ("+ 2024", "+ Fujifilm", "+ Moire_Band", "+ Trip") that add on click.
- **Location:** `Breadcrumbs` (each segment opens that folder), Show in folder, Copy path. These
  two moved here from the action row, which would otherwise truncate Open With.
- **Sharing & permissions:** one row each for You (owner), the group and Everyone, with a
  `SegmentedControl` (Read / Read & write; None / Read / Write); a `Toggle` for "Allow running as
  a program".
- **Opens with:** a `Select` of the applications for the type: "Default for every .jpg file".
- **History:** Created, Modified and "Last opened: Image Viewer · 2 h ago".

### Columns pane

The same parts, wide and without scrolling: the hero (≤ 40% of the height), then the name and
caption with Open, Open With ▾ and ⋯ on the same line, the facts in two columns (label over
value), and the tag chips. A PDF fills any room left with its opening words (the `document`
stage). Narrower than 400px, the facts fall back to one column.

### Data each part needs

Available today: everything in `Preview` (EXIF camera, lens, time and exposure; audio tags, codec
and art; video duration, size and codec; PDF pages, title, author and excerpt; text lines,
encoding and language; archive summary; font family, style, glyphs and version; folder counts,
first children and measured size), `inspectFiles()` (dates, mode, uid/gid, link target), the tag
catalog, `mimeDatabase.applicationsForMime()` and `defaultApplicationForMime()`,
`FileActivationService.setDefaultApplication()`, `readOpenedFiles()` (path, app id, time), and the
`compress` operation.

Not available yet:

| Need                                    | Gap                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Histogram and dominant colours          | A pixel pass in the thumbnail worker, returned beside the thumbnail (48 luminance bins, 6 colours)      |
| Audio scrub and position                | `useAudioPlayback` only toggles; expose position/duration from `PlaybackState` and a `seek(seconds)`    |
| Video play in place                     | No inline video. Proposed: the play button opens Videos at that file (or an mpv preview window)         |
| PDF pages after the first               | Thumbnail workers render page 1 only; the request needs a page index                                    |
| Font weight picker                      | Sibling faces of the family (same folder, or installed fonts with the same family name) are not scanned |
| Extract here                            | No extract operation in `@moire/file-operations` (Compress exists)                                      |
| Folder mosaic                           | `children` holds names only; it needs the first four children with pictures (`hasPicture`)              |
| Size by kind                            | `measureFolder` keeps one total; tally bytes per `fileKind` during the same walk                        |
| Tag colours                             | The catalog stores names only; add an optional colour per tag                                           |
| Tag suggestions                         | A pure function from the preview (year taken, camera, artist, album) and the parent folder name         |
| Owner and group names                   | `inspectFiles` reports numeric uid/gid; resolve names from `/etc/passwd` and `/etc/group`               |
| Changing permissions, executable toggle | No chmod operation with Undo; add one to the operation queue                                            |
| "Last opened in App"                    | `readOpenedFiles()` has the app id and time; it needs the app's display name from app discovery         |
| Multi-select permissions summary        | `inspectFiles` lists distinct modes; it needs a readable summary ("All read & write for you")           |

### Widgets

Into `@moire/ui`, each general:

- **`PropertyList`, compact:** muted 12px labels, no stripes, scale-aware. Today its row and label
  heights ignore `getUiScaleFactor()`, so the mocks draw the rows inline.
- **`MetaPill`:** a small translucent pill for a fact over a picture (dimensions, duration).
- **`TagChip`:** colour dot, label, remove; an "add" variant that becomes a field; a dashed
  suggestion variant.
- **`ColourStrip` and `Histogram`:** swatches and bars from numbers.
- **`StackedBar`:** a one-line proportional bar with a legend. `StackedBarChart` is a full chart.
- **`PageStepper`:** "‹ Page 1 of N ›" over a picture.

The Files pieces (the hero per kind, the cards, `InspectorSheet`, `ColumnsPreviewPane`) stay in
`apps/bundled/files/src/views/inspector/`.

### Implementation outline

1. **Model:** extend `Preview` (folder `byKind` and picture children; image `colours` and
   `histogram` from the worker), add `tagSuggestions(preview, entry)` and a permissions model
   (owner/group names, three access levels and the executable bit, both directions to and from
   `mode`). Pure, with smokes.
2. **Widgets:** the `@moire/ui` pieces above, each with a gallery entry.
3. **Views:** `InspectorHero` (switch on `preview.kind`, reusing `PreviewStage` where it already
   fits), the cards, `InspectorSheet` replacing `FileInspector` inside `PropertiesSheet`, and the
   columns `PreviewPane` rebuilt from the same parts.
4. **Operations:** chmod with Undo, extract, set default application, all through
   `use-operations`.
5. **Verify:** update `inspector.smoke.tsx` and `columns.smoke.tsx` for the new controls, check
   the gallery at 640×650 and scale 1.5, and write visreg previews per kind.

**Found while mocking:** with Properties open, the selection bar stays centred on the whole page,
so the sheet covers its right-hand actions (`a-multi-dark.png`). Centre it in the room left of
the sheet.
