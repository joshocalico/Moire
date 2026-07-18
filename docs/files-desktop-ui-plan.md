# Files, desktop, and UI completeness plan

This document is the product and architecture plan for taking Moire Files,
the desktop, and `@moire/ui` from an attractive prototype to a coherent,
complete desktop experience. Files is the principal widget showcase, but it
must consume reusable behavior rather than accumulating app-specific drawing
and input code.

## Assessment

The current system has a promising visual language and working foundations:
directory browsing, grid/list presentation, desktop icons, Wayland DnD,
freedesktop MIME associations, Open With, and a process-local context-action
registry.

Its largest gaps are structural:

- The Files breadcrumb is a label inside a drop zone, not navigation.
- Sidebar places are a hard-coded array with no editing or persistence.
- Focus and basic single-line editing now exist, but selection, clipboard,
  composition, shortcut scopes, and full control keyboard parity remain.
- Lists and grids have no shared selection or keyboard-navigation model.
- File operations are synchronous calls embedded in the main view.
- `Draggable` owns clicking, double-clicking, context menus, drag initiation,
  and drop identity because it owns the topmost hit layer.
- The renderer cannot yet express rounded geometry, strokes, shadows, or
  general transforms.
- Presentation code uses deeply nested `createElement` calls even though the
  repository is configured for JSX.

The goal is not another visual pass over these limitations. The goal is to
complete the interaction and rendering foundations, then prove them through
Files and the desktop.

## Product principles

1. Every visible affordance must work.
2. Primary workflows must have pointer and keyboard parity.
3. Files and the desktop share selection, actions, operations, and MIME
   semantics where their behavior should match.
4. Widgets own reusable interaction; applications own domain policy.
5. The retained scene graph describes appearance, not a particular renderer.
6. Software rendering remains a first-class deterministic backend, while EGL
   can render the same scene without changes to widgets or applications.
7. Taste comes from consistent geometry, motion, hierarchy, and feedback—not
   from one-off decoration.

## Renderer architecture

Software rasterization is the current backend, not the UI model. React should
produce a backend-neutral retained scene graph:

```text
React components
      |
      v
Retained scene graph
  - layout
  - geometry and transforms
  - clipping
  - hit testing
  - abstract paint primitives
      |
      v
RendererBackend
  - SoftwareRenderer
  - EglRenderer
```

The scene contract should support:

- rectangles and rounded rectangles, including per-corner radii
- fills and strokes
- images and text
- paths where simpler primitives are insufficient
- opacity layers and clips
- translation, scale, and transform origin
- declarative shadows/elevation

Layout, focus, input routing, hit testing, and animation state must remain
independent of rasterization. Rounded hit testing and transformed hit testing
should use scene geometry rather than painted pixels.

`rasterize()` should move behind a `RendererBackend` contract. The platform
window API must also stop assuming that presentation always means uploading a
CPU `Uint8Array`; it should expose an abstract render target or presentation
contract. The software backend remains the reference implementation and the
headless test backend. EGL can batch geometry, use glyph and texture atlases,
implement shadows in shaders, and present without a CPU framebuffer copy.

Renderer conformance scenes and snapshots should ensure both backends honor
the same visual and clipping semantics. Widgets must not branch into separate
software and EGL appearances.

## Input and interaction foundation

The UI host needs a real interaction model before Files can be complete:

- focus ownership, focus traversal, focus scopes, and visible focus rings
- keyboard events with key identity, text, modifiers, repeat, and shortcuts
- editable text state, cursor, selection, clipboard, and composition-ready
  input boundaries
- pointer capture exposed as a reusable interaction facility
- event ownership or propagation that does not depend on whichever visual
  widget happens to paint the topmost transparent rectangle
- an overlay stack for menus, popovers, tooltips, dialogs, and modality
- lifecycle-aware motion values that unregister on unmount

Context menus and dragging should compose around an item interaction owner:

```text
CollectionItem
  - focus, selection, activation
  - context-menu trigger
  - optional useDragSource()
  - optional DropZone
```

`Draggable` should become a narrowly scoped behavior or hook. It should not be
the semantic owner of selection or context menus. A context menu should receive
an explicit subject: item selection, sidebar entry, folder background, or
desktop background.

## Complete Files behavior

### Navigation

- Back and forward history with disabled states and keyboard shortcuts
- Up and refresh
- Clickable breadcrumb segments, each usable as a drop target
- Ctrl+L editable location mode with validation and useful path completion
- Escape to leave location editing; Enter to navigate
- Clear inaccessible, missing, loading, and empty-folder states
- Persisted window, sidebar, view, and sorting preferences

### Selection and collections

- Single, Ctrl/Shift range, Select All, and rubber-band selection
- Arrow-key navigation, Enter to open, F2 to rename, Delete to Trash
- Type-to-select and consistent focus/selection distinction
- Grid and list views backed by one selection model
- Sort by name, type, size, and modified date, ascending or descending
- Hidden-files control and adjustable icon size
- A list/table view with useful columns and configurable column visibility
- Virtualization for directories large enough to require it

### File operations

- New folder and new file
- Inline rename with validation
- Copy, cut, paste, duplicate, move, Trash, restore, and permanent delete
- Undo for reversible operations
- Conflict handling for replace, rename, merge, skip, and apply-to-all
- An asynchronous operation queue with progress, cancellation, completion,
  and actionable failures
- Filesystem watching that reconciles changes without losing selection

Operations should live behind a filesystem service and operation queue rather
than synchronous `fs` calls in a React component. Views dispatch intent and
render operation state.

### Sidebar

The sidebar becomes a configurable navigation model with:

- reorderable and removable Favorites
- Pin Current Folder and drag-to-pin
- optional custom labels
- collapsible sections
- XDG user directories
- Devices, mounted volumes, Trash, and eventually network locations
- per-entry context menus
- persisted ordering, visibility, width, and collapsed state

Generic pieces such as `NavigationSidebar`, `SidebarSection`, reorderable
collections, and inline editing belong in `@moire/ui`. XDG places, volumes,
and Files persistence remain application concerns.

### Open With and context actions

The Open With picker should provide:

- actual application icons
- search and keyboard navigation
- Recommended and Other Applications sections
- a clear default-application control
- empty and error states
- a route to manage file associations

The context-action contract should grow from the process-local baseline into a
versioned plugin host. Context must distinguish selected items, current folder,
sidebar entry, Files background, desktop item, and desktop background. The API
should support ordering, groups, submenus, async enablement, multiple selection,
and safe error isolation. External plugins should be discovered from manifests
in XDG data locations; loading and trust policy must be explicit.

## Complete desktop behavior

Desktop item and background menus are separate contexts.

Item actions include Open, Open With, Rename, Cut, Copy, Trash, Properties,
and compatible plugin actions.

Background actions include New Folder, Paste, Select All, Sort By, Clean Up or
Arrange, icon size, Show Desktop Icons, and Change Background. Change
Background should open Settings directly on Appearance rather than duplicating
wallpaper controls in the shell.

The desktop should also support:

- empty-click selection clearing
- multi-selection and rubber-band selection
- keyboard traversal and inline rename
- shared file-operation feedback and errors
- consistent arrange/sort and persisted layout behavior
- background right-click owned by the desktop surface, including when there
  are no icons

## Widget library roadmap

### Foundation and interaction

- `FocusScope`, focus traversal, shortcut manager, and focus ring
- real `TextField` and text-editing model
- `InteractiveRegion` / `CollectionItem`
- `ContextMenuTrigger`, `useDragSource`, and `DropZone`
- overlay/portal stack, tooltip, popover, and modal barrier

### Navigation and collections

- `Toolbar` and proper icon buttons
- `Breadcrumbs` and editable `PathBar`
- `NavigationSidebar`, sections, editable/reorderable items
- shared `SelectionModel`
- virtualized list, grid, table, and tree views
- rubber-band selection and inline rename
- sortable column headers

### Controls and feedback

- `SearchField`, combo box, select, radio group, and segmented control
- submenu-capable `Menu` and anchored `ContextMenu`
- robust dialogs, confirmation dialogs, and sheets
- toast, banner, progress row, spinner, and empty state
- badges and status indicators

### Visual primitives

- rounded surface and stroke
- elevation/shadow
- consistent icon button and artwork slots
- clipping and transform containers
- animation/transition components

Files should showcase these widgets, but file-specific rows, breadcrumbs, and
places should be thin domain compositions over generic primitives.

## Theme, motion, and desktop chrome

Theme tokens should expand beyond color and spacing to include:

- small, medium, large, and window radii
- border widths and focus-ring geometry
- control heights and density
- elevation levels and shadow recipes
- motion durations and easing curves
- overlay and inactive-state opacity

Motion should expose lifecycle-aware hooks and declarative transitions for
position, size, opacity, and scale. Menus, dialogs, launcher surfaces, selection,
drag feedback, and window state changes should use a small consistent motion
vocabulary. Reduced-motion policy should be possible later without changing
widgets.

Desktop chrome should ultimately provide:

- rounded window masks and soft shadows
- square, shadowless maximized windows
- proper icon-based minimize, maximize, and close controls
- hover, press, and active/inactive transitions
- double-click titlebar maximize
- a window menu and complete resize affordances
- opening, closing, minimizing, restoring, and snap feedback
- consistent panel, launcher, menu, dialog, and window geometry

Compositor-level window transforms and masks should consume the same abstract
geometry concepts as the UI renderer where practical, without coupling client
widgets to compositor implementation.

## JSX migration

JSX becomes the standard for all presentation code.

1. Define typed `GroupProps`, `RectProps`, `TextProps`, and `ImageProps`.
2. Export the host primitives as typed JSX element types while retaining their
   string host identity for the reconciler.
3. Rename view-bearing `.ts` modules to `.tsx`.
4. Extract render trees from imperative controllers into components such as
   `ShellView`, `DesktopLayer`, `WindowChrome`, and `DragPreview`.
5. Convert Files, Settings, shell chrome, widgets, smoke examples, and docs.
6. Restrict raw `createElement` to renderer internals and genuinely dynamic
   element factories.

Files should also be split into navigation state, selection state, sidebar
state, filesystem services, operation services, action providers, and focused
view components. A single component should not own the whole application.

## Delivery phases

### Phase 0: preserve the baseline

- Checkpoint the current MIME association, Open With, context-action, and
  right-click work.
- Record known limitations so later architectural work can be reviewed against
  a stable functional baseline.

### Phase 1: scene, presentation, and JSX foundation

- Introduce the backend-neutral scene and renderer contracts.
- Keep software rendering operational behind `SoftwareRenderer`.
- Adapt platform presentation so EGL is not blocked by a CPU-pixel API.
- Add rounded geometry, strokes, transforms, clips, and abstract shadows.
- Add typed JSX primitives and begin the presentation migration.
- Add renderer conformance scenes and headless snapshots.

### Phase 2: input and overlay completeness

- Focus manager, keyboard/modifier routing, shortcut scopes, and real text
  editing.
- Overlay stack, anchored popovers, menus, dialogs, and dismissal semantics.
- Replace global leaking motion registration with lifecycle-aware hooks.
- Separate item interaction, context triggers, drag sources, and drop zones.

### Phase 3: widget library v2

- Build the navigation, collection, selection, editing, sidebar, feedback, and
  visual widgets listed above.
- Create a widget-gallery or showcase mode with keyboard and headless tests.
- Convert all widget implementations and examples to JSX.

### Phase 4: Files architecture and core workflows

- Split Files into services, models, controllers/hooks, and view components.
- Implement navigation history, usable breadcrumbs/location editing, shared
  selection, keyboard interaction, sorting, views, and persisted preferences.
- Replace the hard-coded sidebar with the configurable places model.

### Phase 5: operations, picker, and plugins

- Implement the asynchronous file-operation queue, conflict UI, Trash, undo,
  progress, and errors.
- Complete the Open With picker and association management flow.
- Expand context scopes and implement external action-plugin discovery.

### Phase 6: desktop completeness

- Add the background context menu and route background preferences to Settings.
- Share selection and file-operation behavior with Files where appropriate.
- Add multi-select, rubber-band, rename, arrange/sort, and complete feedback.

### Phase 7: chrome and motion

- Apply the geometry and motion system to windows, panel, launcher, dialogs,
  menus, and controls.
- Complete titlebar and window-state interactions.
- Implement and compare the EGL backend without changing widget APIs.

### Phase 8: hardening

- Keyboard-only and pointer interaction suites
- renderer conformance and visual regression tests
- filesystem-operation integration tests, including conflicts and failures
- MIME/action/plugin contract tests
- guest verification through `prlctl`, captures, logs, and guest-side scripts;
  do not depend on Computer Use for Parallels interaction
- performance profiling for both software and EGL paths

## Definition of done

This effort is complete when:

- every visible Files, desktop, and chrome affordance performs a real action
- navigation, selection, editing, menus, and primary file operations work by
  keyboard as well as pointer
- sidebar and view preferences persist
- file operations expose progress, cancellation where possible, conflicts,
  failures, and undo for reversible actions
- item and background context menus are distinct and plugin-extensible
- Files presentation is decomposed into readable JSX components
- raw `createElement` is absent from application and widget presentation code
- widgets express renderer-neutral scene semantics
- the software and EGL renderers satisfy the same conformance contract
- Files genuinely demonstrates the reusable widget library instead of hiding
  missing behavior behind bespoke code
