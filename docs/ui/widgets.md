# Widgets

All widgets are React elements and JSX is the presentation standard. Flow and
overlay containers allocate their children; explicit coordinates remain an
escape hatch for paint geometry and unusual compositions.

Moire currently uses the classic React JSX transform for compatibility with
the custom reconciler, so `.tsx` presentation modules import `React` as a
runtime value.

Import from `@moire/ui`. Defaults resolve through the nearest
`WidgetThemeProvider`; explicit colors remain ARGB compatibility overrides.

---

## Layout

Moire uses a border-box model: declared width and height include padding and
borders, padding reduces the box offered to children, and margin participates
in the parent flow. `Insets` accepts either one number or an object with
`horizontal`, `vertical`, `top`, `right`, `bottom`, and `left` values. Explicit
edges take precedence over axis values.

### `Box`

Explicit measurement and positioning boundary. In a `Row` or `Column`, wrap a
composed component in `Box` when its public size is supplied by internal
defaults: flex layout can only inspect props declared on its direct children.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | `0` |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight` | `number` | |
| `maxWidth`, `maxHeight`, `aspectRatio` | `number` | |
| `alignSelf` | `start` \| `center` \| `end` \| `stretch` | parent alignment |
| `margin` | `Insets` | `0` |
| `children` | `ReactNode` | |

### `Row` / `Column` (`Horizontal` / `Vertical` aliases)

Flex containers (`ColumnProps` extends the same shape as `Row`). `Row` keeps a
control-friendly centered cross axis; `Horizontal` defaults to stretch for
pane/application layout. `Column` and `Vertical` both default to stretch.
Each allocated child box is published through layout context, so nested
components can consume it with `Measure` or `useLayoutMetrics()` instead of
repeating parent arithmetic.

Public widgets with recipe-owned defaults publish intrinsic sizes to flow
parents. A `Column` containing `TextField`, `Checkbox`, `Banner`, or `Button`
therefore reserves each control's themed height even when the caller omits
`height`. Compound widget authors should use `registerIntrinsicSize`; painting
beyond a zero-sized allocation is a layout-contract bug.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | nearest allocated box when omitted |
| `x`, `y` | `number` | `0` |
| `gap` | `number` | `8` |
| `padding` | `Insets` | `0` |
| `justify` | `start` \| `center` \| `end` \| `space-between` \| `space-around` | |
| `align` | `start` \| `center` \| `end` \| `stretch` | Row: `center`, Column: `stretch` |
| `wrap` | `boolean` | `false` |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight` | `number` | |
| `maxWidth`, `maxHeight`, `aspectRatio` | `number` | |
| `alignSelf` | `start` \| `center` \| `end` \| `stretch` | parent alignment |
| `margin` | `Insets` | `0` |
| `children` | `ReactNode` | |

```tsx
<Row width={400} gap={12} padding={16}>
  <Box width={120} height={36}>{fixedSizeControl}</Box>
  <Box height={36} flexGrow={1}>{growingContent}</Box>
</Row>
```

### `Inset` (`Padding` alias)

Border-box boundary that gives its children a padded content allocation.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | nearest allocated box |
| `padding` | `Insets` | `0` |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight`, `maxWidth`, `maxHeight` | `number` | |
| `aspectRatio` | `number` | |
| `alignSelf` | `start` \| `center` \| `end` \| `stretch` | parent alignment |
| `margin` | `Insets` | `0` |
| `children` | `ReactNode` | |

```tsx
<Inset width={420} height={120} padding={{ horizontal: 16, vertical: 12 }}>
  <Vertical gap={4}>
    <TextBlock text="Transfer complete" fontWeight="medium" />
    <TextBlock text="42 files copied" color={muted} />
  </Vertical>
</Inset>
```

### `Spacer`, `Align`, and `Center`

`Spacer` consumes flexible flow space. It accepts `width`, `height`,
`flexGrow`, `flexShrink`, min/max size, `aspectRatio`, `alignSelf`, and
`margin`; `flexGrow` defaults to `1`. `Align` places children within an
allocated overlay box; `Center` is its centered-axis shorthand.

| Prop (`Align`) | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | nearest allocated box |
| `alignX`, `alignY` | `start` \| `center` \| `end` \| `stretch` | `stretch` |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight`, `maxWidth`, `maxHeight` | `number` | |
| `aspectRatio`, `alignSelf`, `margin` | flex item values | |
| `children` | `ReactNode` | |

`Center` accepts the same props except `alignX` and `alignY`, which are fixed
to `center`.

```tsx
<Horizontal width={360} height={40} gap={8}>
  <TextBlock text="Appearance" verticalAlign="center" />
  <Spacer flexGrow={1} />
  <Button width={92} label="Restore" />
</Horizontal>
```

### `Measure`

Render-prop bridge from a layout allocation to ordinary JSX. As a direct
`Horizontal`/`Vertical` child it accepts the same flex item props and receives
the allocated `{ x, y, width, height }`.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` inside allocated box |
| `width`, `height` | `number` | allocated box |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight` | `number` | |
| `maxWidth`, `maxHeight`, `aspectRatio` | `number` | |
| `margin` | `Insets` | `0` |
| `children` | `(metrics: LayoutMetrics) => ReactNode` | required |

```tsx
<Horizontal width={720} height={360} gap={12}>
  <Measure width={220}>{({ width, height }) => (
    <Sidebar width={width} height={height} />
  )}</Measure>
  <Measure flexGrow={1}>{({ width, height }) => (
    <Canvas width={width} height={height} />
  )}</Measure>
</Horizontal>
```

### `Stack`

Measured overlay composition for badges, scrims, artwork, and transitions.
Unlike flow layout, stacking is intentionally a small bespoke algorithm:
children share one box and are positioned by two alignment axes.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | nearest allocated box when omitted |
| `alignX`, `alignY` | `start \| center \| end \| stretch` | `stretch` |
| `flexGrow`, `flexShrink` | `number` | |
| `minWidth`, `minHeight`, `maxWidth`, `maxHeight` | `number` | |
| `margin` | `Insets` | `0` |
| `children` | `ReactNode` | painted in source order |

```tsx
<Stack width={320} height={180} alignX="end" alignY="start">
  <ImageWidget width={320} height={180} src={preview} />
  <Badge text="NEW" />
</Stack>
```

### `SplitView`

Controlled two-pane layout with clipping, a captured pointer divider, and
Left/Right or Up/Down keyboard resizing. Home and End move to the configured
minimums; Shift multiplies the keyboard step.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `orientation` | `horizontal \| vertical` | `horizontal` |
| `firstSize` | `number` | required controlled pane size |
| `onFirstSizeChange` | `(size: number) => void` | |
| `minFirst`, `minSecond` | `number` | `80` |
| `dividerSize` | `number` | `7` hit target |
| `keyboardStep` | `number` | `12` |
| `disabled` | `boolean` | `false` |
| `first`, `second` | `ReactNode` | required pane content |

```tsx
<SplitView
  width={760}
  height={440}
  firstSize={sidebarWidth}
  onFirstSizeChange={setSidebarWidth}
  first={<Inspector />}
  second={<Canvas />}
/>
```

### `Surface` / `Panel`

Filled background. `Panel` defaults fill to `pal.surface`; `Surface` to `pal.panel`.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `translateX`, `translateY` | `number \| AnimationValue` | `0` |
| `width` | `number` | required |
| `height` | `number` | required |
| `fill` | `number` | theme |
| `radius`, `stroke`, `strokeWidth` | `number` | optional |
| `elevation` | `none` \| `low` \| `medium` \| `high` | `none` |
| `opacity` | `number \| AnimationValue` | `1` |
| `clip` | `boolean` | `false` |
| `onPress` | `() => void` | |
| `children` | `ReactNode` | |

`elevation` is a semantic request. It resolves to the backend-neutral `Rect`
box-shadow contract; the software renderer uses an analytic soft shadow while
accelerated backends can execute the same blur/offset token without changing
widget JSX.

### `FocusRing`

Shared focus outline geometry. Prefer this over local outline rectangles so
focus width, inset, radius, and color stay themeable.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `radius` | `number` | medium theme radius plus focus offset |
| `color` | `number` | theme focus color |
| `visible` | `boolean` | `true` |

### `Separator` (`Divider` alias)

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `height` | `number` | `1` |
| `color` | `number` | `pal.border` |

### `TextBlock` / `Label`

Allocation-aware text. `Label` is the familiar semantic alias; both render the
same text primitive. Text is aligned inside its allocated box without callers
calculating font baselines.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `text` | `string` | required |
| `color` | `number` | `pal.text` |
| `fontSize` | `number` | ~14 |
| `fontWeight` | `regular` \| `medium` \| `bold` | |
| `fontFamily` | `sans` \| `mono` | |
| `width`, `height` | `number` | nearest allocation or natural text size |
| `horizontalAlign` | `start` \| `center` \| `end` | `start` |
| `verticalAlign` | `start` \| `center` \| `end` | `start` |
| `wrap` | `boolean` | `false` |
| `maxLines` | `number` | unlimited |
| `lineGap` | `number` | `0` |
| `overflow` | `visible` \| `clip` \| `ellipsis` | `visible` |
| `flexGrow`, `flexShrink`, min/max size, `margin` | flex item values | |

Prefer `TYPE_ROLES.*.size` for consistent hierarchy.

---

## Interaction

### `Pressable`

Hit target with eased hover/press fills (`pal.hover` / `pal.pressed`).

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `fill` | `number` | transparent |
| `onPress` | `(event?: HitPointerEvent) => void` | |
| `onDoublePress` | `() => void` | 400ms window |
| `disabled` | `boolean` | |
| `children` | `ReactNode` | |

### `Tooltip`

Non-interactive hover help composed around an existing fixed-size trigger. The
tooltip fades through the shared motion system and does not steal clicks from
its child control. Labels reflow to as many as three lines when the measured
width reaches the tooltip-width cap.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required trigger geometry |
| `label` | `string` | required |
| `placement` | `top \| bottom \| left \| right` | `top` |
| `delayMs` | `number` | `350` |
| `offset` | `number` | `7` |
| `tooltipWidth` | `number` | measured label width, clamped `60..260` |
| `disabled` | `boolean` | `false` |
| `children` | `ReactNode` | trigger presentation |

```tsx
<Tooltip width={36} height={36} label="Search" placement="bottom">
  <IconButton width={36} height={36} icon={<Icon name="search" />} />
</Tooltip>
```

### `Button`

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `height` | `number` | selected recipe height |
| `label` | `string` | required |
| `variant` | `primary` \| `secondary` \| `ghost` \| `danger` | `secondary` |
| `fill` / `color` | `number` | override variant |
| `fontSize` | `number` | `14` |
| `disabled` | `boolean` | |
| `autoFocus`, `focusId` | focus control | |
| `onPress` | `(event?: HitPointerEvent) => void` | keyboard activation supplies the focused control center |

Primary uses `accentLine` fill; secondary uses `surface` + rim; ghost is transparent.
Buttons with an action participate in Tab traversal, paint the recipe focus
state, and activate from Enter or Space.

### `IconButton`

Compact equivalent with a centered string, node, or styled artwork callback.
It shares Button focus traversal and Enter/Space activation; prefer a real
`Icon` slot over emoji or font-dependent glyphs.

### `Checkbox` / `Toggle` / `Slider`

| Widget | Key props |
| --- | --- |
| `Checkbox` | `checked`, `onChange?(boolean)`, `label?`, `invalid?` |
| `Toggle` | `on`, `onChange?(boolean)`, `label?` |
| `Slider` | `width`, `value` 0..1, `onChange?(number)`, `step?` |

All three accept `small`, `medium`, and `large` sizes plus `disabled` and
`autoFocus`. Checkbox and Toggle expose the whole labelled row as one focusable
target and activate with Enter or Space. Slider updates continuously under
captured pointer drags and supports arrows, Home, and End; Shift multiplies its
keyboard step by ten.

### `TextField`

Controlled, focusable single-line editor. Pointer presses place the cursor;
Tab and Shift+Tab participate in window focus traversal. It handles printable
text, Left/Right, Home/End, Backspace/Delete, Enter, and Escape.

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `value` | `string` | required |
| `size` | `small \| medium \| large` | `medium` |
| `placeholder` | `string` | |
| `leading`, `trailing` | node or styled slot callback | |
| `onChange` | `(value: string) => void` | |
| `onSubmit` | `(value: string) => void` | |
| `onCancel` | `() => void` | |
| `onPress` | `(event: HitPointerEvent) => void` | optional activation/anchor hook |
| `onFocusChange` | `(focused: boolean) => void` | |
| `focused` | `boolean` | optional visual focus override |
| `autoFocus` | `boolean` | focus once when mounted |
| `invalid` | `boolean` | danger validation stroke |
| `disabled`, `readOnly` | `boolean` | |

`SearchField` composes the same editor with theme-sized search and clear
slots. It preserves the `TextField` keyboard/focus contract, clears through
`onChange("")`, and can additionally report `onClear`. Launch and Open With use
this shared control rather than maintaining local search-field paint.

### `Select` / `ComboBox`

Overlay-backed controlled choice fields. `Select` presents a known set;
`ComboBox` keeps the editor active while filtering the same option model.
Pointer activation records the control's host-space geometry, so nested
callers do not normally calculate popover coordinates.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | width required; recipe height |
| `viewportWidth`, `viewportHeight` | `number` | required overlay bounds |
| `options` | `SelectOption[]` | required |
| `value` (`Select`) | `string \| null` | controlled selection |
| `onChange` (`Select`) | `(id: string) => void` | |
| `value` (`ComboBox`) | `string` | controlled editable text |
| `selectedId` (`ComboBox`) | `string \| null` | optional selected option |
| `onValueChange` (`ComboBox`) | `(value: string) => void` | |
| `onSelect` (`ComboBox`) | `(id: string) => void` | |
| `placeholder` | `string` | widget-specific prompt |
| `size` | `small \| medium \| large` | `medium` |
| `disabled` | `boolean` | `false` |
| `maxMenuHeight` | `number` | `280` |
| `anchorX`, `anchorY` | `number` | measured pointer origin, then local position |
| `onOpenChange` | `(open: boolean) => void` | |

`SelectOption` has `id`, `label`, optional `description`, and optional
`disabled`. Mount the application under `OverlayHost`; without one, the menu
uses an inline compatibility fallback.

### `FocusScope` / `ShortcutManager`

`FocusScope` marks a subtree as the active traversal boundary. An active
trapped scope receives initial focus, wraps Tab/Shift+Tab, and prevents focus
or global commands leaking to the surface behind it. `ShortcutManager`
dispatches declarative window-level commands before focused-widget handling.

| Prop (`FocusScope`) | Type | Default |
| --- | --- | --- |
| `id` | `string` | generated |
| `x`, `y`, `width`, `height` | layout values | nearest allocation |
| `active` | `boolean` | `true` |
| `trap` | `boolean` | `true` |
| `onEscape` | `() => void` | |
| `children` | `ReactNode` | |

| Prop (`ShortcutManager`) | Type | Default |
| --- | --- | --- |
| `shortcuts` | `Shortcut[]` | required |
| `enabled` | `boolean` | `true` |
| `x`, `y`, `width`, `height` | layout values | nearest allocation |
| `children` | `ReactNode` | |

A `Shortcut` has `id`, `onInvoke`, and either `key`, numeric `code`, or both.
It can match `ctrl`, `alt`, `shift`, `meta`, or `platformModifier`, and accepts
`allowRepeat` and `disabled`. `platformModifier` accepts Ctrl or Meta so apps
can describe a conventional primary command without knowing the backend.

### `Breadcrumbs` / `PathBar`

`Breadcrumbs` renders width-aware, clickable path segments. Every segment is
also a geometric drop zone identified by its `id`. `PathBar` adds an explicit
Edit action and swaps to an autofocus `TextField`; Enter validates through
`onCommit`, while Escape returns to breadcrumbs.

| Prop | Type | Notes |
| --- | --- | --- |
| `segments` | `{ id, label }[]` | ordered root-to-current path |
| `onNavigate` | `(id: string) => void` | segment activation |
| `value` | `string` | `PathBar` editable location |
| `onCommit` | `(value) => string \| undefined` | return an error string to remain in edit mode |
| `size` | `small` \| `medium` \| `large` | `medium` |
| `height` | `number` | selected recipe height |

The `pathBar` recipe owns segment interaction, current/ancestor typography,
separator styling, density, padding, and edit-control geometry. Entering edit
mode mounts a one-shot autofocus target, so typing is routed to the location
field even though the persistent Edit/Done button initiated the transition.

### `Tabs`

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `tabs` | `string[]` | required |
| `active` | `number` | required |
| `onChange` | `(index) => void` | |
| `height` | `number` | selected recipe height |
| `size` | `small \| medium \| large` | `medium` |
| `disabled` | `boolean` | `false` |

Each entry may remain a string or use `{ id, label, leading?, disabled? }` for
stable identity, a theme-sized artwork slot, and per-tab availability. Active
tabs use an accent underline rather than a full slab. Tabs are focusable and
support Left/Right/Home/End navigation, skipping disabled entries, plus
Enter/Space activation.

### `OverlayHost` and transient surfaces

`OverlayHost` owns one application-sized top layer. `OverlayPortal` registers
its children there. This keeps transient paint and hit testing above ordinary
chrome without forcing a child widget to know which window, pane, or sidebar
contains it. Place the host inside application-level providers whose values
the overlay should share; a provider nested only around the portal origin does
not wrap the registered top-layer subtree.

| Prop (`OverlayHost`) | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required viewport size |
| `children` | `ReactNode` | ordinary content and portals |

| Prop (`Popover`) | Type | Default |
| --- | --- | --- |
| `open` | `boolean` | required controlled state |
| `viewportWidth`, `viewportHeight` | `number` | required |
| `anchor` | `{ x, y, width, height }` | required host-space bounds |
| `width`, `height` | `number` | required |
| `placement` | `bottom-start \| bottom-end \| top-start \| top-end` | `bottom-start` |
| `modal` | `boolean` | `false` (transparent pointer barrier) |
| `trapFocus` | `boolean` | `true` |
| `dismissOnOutside` | `boolean` | `true` |
| `onDismiss` | `() => void` | required |
| `children` | `ReactNode` | |

| Prop (`Sheet`) | Type | Default |
| --- | --- | --- |
| `open` | `boolean` | required |
| `viewportWidth`, `viewportHeight` | `number` | required |
| `edge` | `right \| bottom` | `right` |
| `width`, `height` | `number` | `440` right / `360` bottom, viewport-clamped |
| `title` | `string` | required |
| `onDismiss` | `() => void` | required |
| `children` | `ReactNode` | sheet body |

| Prop (`ConfirmationDialog`) | Type | Default |
| --- | --- | --- |
| `open` | `boolean` | required |
| `viewportWidth`, `viewportHeight` | `number` | required |
| `title`, `message` | `string` | required |
| `confirmLabel`, `cancelLabel` | `string` | `Continue`, `Cancel` |
| `danger` | `boolean` | `false` |
| `onConfirm`, `onDismiss` | `() => void` | required |

| Prop (`ToastHost`) | Type | Default |
| --- | --- | --- |
| `viewportWidth`, `viewportHeight` | `number` | required |
| `items` | `ToastItem[]` | required controlled queue |
| `onDismiss` | `(id: string) => void` | required |
| `width` | `number` | min of `380` and viewport inset |

`ToastItem` has `id`, `title`, optional `message`, `actionLabel`, `onAction`,
and `durationMs` (default `5000`; non-positive stays visible). Popovers and
modal surfaces share theme motion, elevation, focus scopes, Escape handling,
and viewport clamping.

### `Dialog` / `Menu` / `MenuItem`

- `Dialog`: `title`, `width`, `height`, `size?`, `onClose?`, `children` —
  recipe-driven surface, title bar, typography, close artwork, and body insets.
- `Menu`: `width`, `size?`, `title?`, and `items`. Entries accept stable `id`,
  separators, leading/trailing slots, descriptions, selection, danger, and
  disabled state.
- `MenuItem`: the shared focusable row used by both `Menu` and the desktop/app
  `ContextMenu`; Enter and Space activate it.

Menu recipes own the popup surface/shadow, row interaction and focus states,
text/icon roles, indicator, separators, and all three size metrics. Popup
placement, dismissal, stacking, and entrance/exit motion remain overlay policy,
not row behavior.

Dialog recipes provide small/medium/large chrome density without changing body
content. The close action uses the shared IconButton and geometric close icon.

### `ProgressBar`

Determinate, recipe-driven progress with `width`, `value` 0..1, `size?`, and an
optional explicit `height`. Values are clamped and the track clips the rounded
fill.

### `Disclosure`

Controlled collapsible section. The header is one semantic press target and
the content is mounted in a clipped region only while expanded.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width` | `number` | required |
| `title` | `string` | required |
| `description` | `string` | |
| `expanded` | `boolean` | required |
| `onExpandedChange` | `(expanded: boolean) => void` | |
| `headerHeight` | `number` | `40`, or `60` with a two-line description |
| `contentHeight` | `number` | required |
| `disabled` | `boolean` | `false` |
| `children` | `ReactNode` | expanded content |

### `ProgressRow`

Task/file-operation feedback composed from text, `ProgressBar` or `Spinner`,
and an optional action slot.

When several rows are children of `Column`, either pass their `height`
explicitly or place each one in a same-sized `Box`; this publishes the intended
measurement to the flex parent.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width` | `number` | required |
| `height` | `number` | `78` |
| `title` | `string` | required |
| `detail` | `string` | |
| `value` | `number` | indeterminate spinner when omitted |
| `status` | `string` | optional trailing monospace status |
| `action` | `ReactNode` | |
| `actionWidth` | `number` | `110` when action exists |
| `disabled` | `boolean` | `false` |

```tsx
<Column width={560} gap={12}>
  <Box width={560} height={78}>
    <ProgressRow
      width={560}
      title="Copying project assets"
      detail="24 of 80 files"
      value={0.3}
      status="30%"
      action={<Button width={96} label="Cancel" variant="ghost" />}
    />
  </Box>
</Column>
```

### `RichTextView` / `CodeView`

`RichTextView` is the renderer-native styled-text surface. It lays out ordered
runs with per-run foreground, background, weight, and font family inside a
shared scrolling viewport, with optional line numbers and controlled scroll.
`CodeView` is a thin
syntax-highlighting adapter over that primitive rather than a separate text
renderer. The same rich-text model is intended to back terminal output,
diagnostics, logs, and future selectable or linked text.

`TerminalView` composes rich text with focus, a blinking caret, terminal-grid
measurement, and a Tab-capturing input surface. It deliberately does not own a
process or ANSI parser. `StatusBar` is the matching low-emphasis application
strip and is equally usable by Files, editors, inspectors, and terminal apps.

---

## Collections

### `useSelectionModel`

Renderer-independent keyed selection for list, grid, table, tree, Files, and
desktop compositions. Keys remain stable when items are reordered or refreshed.
The model supports replace, Ctrl/Command toggle, Shift range, additive range,
Select All, clear, first/last, and directional focus movement with optional
range extension, wrapping, or focus-only movement.

```tsx
const selection = useSelectionModel(items.map((item) => item.id));

<CollectionItem
  onPress={(event) => selection.select(item.id, {
    toggle: event?.ctrlKey || event?.metaKey,
    range: event?.shiftKey,
  })}
>
  <ListItem selected={selection.isSelected(item.id)} />
</CollectionItem>
```

`createSelectionState`, `reduceSelection`, and `reconcileSelection` expose the
same semantics to non-React controllers and deterministic tests.

### `NavigationSidebar`

Sectioned navigation with stable item ids, icons, selection, disabled rows,
scrolling, and optional edit-mode move/remove controls. Applications own the
domain model and persistence; the widget owns consistent geometry, focus, and
row presentation. Sidebar icons use renderer-native symbolic artwork so
selected, rest, and disabled tints remain themeable.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `sections` | `readonly NavigationSidebarSection[]` | required |
| `selectedId` | `string \| null` | none |
| `editing` | `boolean` | `false` |
| `onSelect` | `(item) => void` | |
| `onRemove` | `(item) => void` | |
| `onMove` | `(item, direction: -1 \| 1) => void` | |
| `header`, `footer` | `ReactNode` | |

`NavigationSidebarSection` has `id`, optional `label`, and `items`.
`NavigationSidebarItem` has `id`, `label`, and optional `subtitle`, `icon`,
`disabled`, and `removable` fields.

### `ScrollArea`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `contentHeight` | `number` | required |
| `scrollY` / `onScroll` | controlled scroll | |
| `scrollbar` | `boolean` | auto when overflow |
| `size` | `small \| medium \| large` | `medium` |
| `fill` | `number` | recipe viewport fill |
| `children` | `ReactNode` | |

The scrollbar overlays rather than narrowing content, so it does not cause a
layout jump when overflow appears. Wheel input preserves platform deltas;
clicking the track seeks, and the thumb remains captured and scrolls
continuously when dragged outside its original hit rectangle. Content should
be positioned for the full content height.

### `List` / `ListItem`

**List**

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `items` | `T[]` | required |
| `renderItem` | `(item, index, selected) => ReactNode` | required |
| `selectedIndex` | `number` | passed through to render |
| `itemHeight` | `number` | `40` |
| `scrollbar` | `boolean` | |

Note: `onSelect` is declared on the type but selection is owned by the app via `renderItem` / `ListItem.onPress`.

**ListItem**

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `title` | `string` | required |
| `subtitle` | `string` | |
| `leading` | `ReactNode` | icon slot |
| `selected` | `boolean` | wash + 3px accent |
| `interactive` | `boolean` | `true` — set `false` inside `CollectionItem` |
| `onPress` / `onDoublePress` | | |

### `Grid` / `GridItem`

**Grid** — flow of fixed cells inside a `ScrollArea`.

| Prop | Type | Default |
| --- | --- | --- |
| `items` | `T[]` | required |
| `renderItem` | `(item, index) => ReactNode` | required |
| `itemWidth`, `itemHeight` | `number` | required |
| `gap` | `number` | `8` |
| `padding` | `number` | `0` |

**GridItem** — icon-above-label cell.

| Prop | Type | Default |
| --- | --- | --- |
| `label` | `string` | required (ellipsized to width) |
| `icon` | `ReactNode` | |
| `iconSize` | `number` | derived |
| `selected` | `boolean` | wash + outline |
| `labelScrim` | `boolean` | desktop-over-wallpaper |
| `interactive` | `boolean` | `true` |

### `VirtualList`

Fixed-height row virtualization over the shared `ScrollArea`. Only the visible
range plus overscan is reconciled, while each row retains its absolute content
position and the scrollbar represents the full collection.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `items` | `readonly T[]` | required |
| `itemHeight` | `number` | required; clamped to at least `1` |
| `renderItem` | `(item, index) => ReactNode` | required |
| `getKey` | `(item, index) => string \| number` | row index |
| `overscan` | `number` | `3` rows on each side |
| `scrollY` | `number` | uncontrolled when omitted |
| `onScroll` | `(scrollY) => void` | |
| `scrollbar` | `boolean` | auto when overflowing |

```tsx
<VirtualList
  width={480}
  height={320}
  items={results}
  itemHeight={36}
  getKey={(result) => result.id}
  renderItem={(result) => <ResultRow result={result} />}
/>
```

### `Table`

Virtualized keyed rows with sortable headers. Sorting is controlled through
`sort` / `onSortChange`; when the active column supplies `getValue`, the table
orders a copy of the rows before virtualization.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `columns` | `readonly TableColumn<T>[]` | required |
| `rows` | `readonly T[]` | required |
| `getRowKey` | `(row, index) => string` | required |
| `selectedKey` | `string \| null` | none |
| `onSelect` | `(row, index) => void` | |
| `onActivate` | `(row, index) => void` | double-click / Enter activation |
| `sort` | `{ columnId, direction } \| null` | none |
| `onSortChange` | `(sort) => void` | |
| `headerHeight` | `number` | `34` |
| `rowHeight` | `number` | `38` |
| `striped` | `boolean` | `false` |
| `emptyState` | `ReactNode` | blank body |

`TableColumn<T>`:

| Field | Type | Default |
| --- | --- | --- |
| `id`, `label` | `string` | required |
| `width` | `number` | equal share of remaining width |
| `minWidth` | `number` | `48` |
| `align` | `left \| right` | `left` |
| `sortable` | `boolean` | `false` |
| `getValue` | `(row) => string \| number` | empty cell; also supplies sort value |
| `renderCell` | `(row, index, width) => ReactNode` | renderer-native text from `getValue` |

```tsx
<Table
  width={720}
  height={420}
  columns={columns}
  rows={files}
  getRowKey={(file) => file.path}
  selectedKey={selectedPath}
  sort={sort}
  onSortChange={setSort}
  onSelect={(file) => setSelectedPath(file.path)}
/>
```

### `TreeView`

Virtualized hierarchy. Callers own the expanded-id set; rows provide arrow-key
expand/collapse, a dedicated disclosure target, keyed selection, and branch
double-click toggling.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `nodes` | `readonly TreeNode<T>[]` | required |
| `expandedIds` | `ReadonlySet<string>` | required |
| `onExpandedChange` | `(ids: ReadonlySet<string>) => void` | |
| `selectedId` | `string \| null` | none |
| `onSelect` | `(node) => void` | |
| `onActivate` | `(node) => void` | leaf double-click / Enter activation |
| `rowHeight` | `number` | `34` |
| `indent` | `number` | `18` |

`TreeNode<T>` fields are `id`, `label`, optional `icon`, `disabled`, `data`,
and recursive `children`.

```tsx
<TreeView
  width={320}
  height={480}
  nodes={workspace}
  expandedIds={expanded}
  onExpandedChange={setExpanded}
  selectedId={selected}
  onSelect={(node) => setSelected(node.id)}
/>
```

### `Pagination`

Controlled, one-indexed page navigation. Large page ranges collapse to stable
ellipsis tokens while keeping the first, last, current, and sibling pages.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width` | `number` | intrinsic; may publish flex measurement |
| `page` | `number` | required; clamped to range |
| `pageCount` | `number` | required |
| `onPageChange` | `(page: number) => void` | |
| `siblingCount` | `number` | `1`, clamped `0..3` |
| `showFirstLast` | `boolean` | `false` |
| `size` | `small \| medium \| large` | `medium` |
| `disabled` | `boolean` | `false` |

```tsx
<Pagination page={page} pageCount={42} onPageChange={setPage} />
```

### `PropertyList`

Scrollable, sectioned key-value presentation for inspectors, metadata, and
settings. Values may be renderer-native nodes, enabling badges, toggles,
buttons, and other composed controls without a separate inspector renderer.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | required |
| `sections` | `readonly PropertyListSection[]` | required |
| `labelWidth` | `number` | `38%` of width |
| `rowHeight` | `number` | `42` |
| `descriptionRowHeight` | `number` | `58` |
| `selectedId` | `string \| null` | none |
| `onSelect` | `(item) => void` | |
| `striped` | `boolean` | `false` |
| `scrollbar` | `boolean` | auto |
| `emptyState` | `ReactNode` | blank |

`PropertyListSection` has `id`, optional `label`, and `items`.
`PropertyListItem` has `id`, `label`, `value: ReactNode`, and optional
`description`, `disabled`, and `onPress` fields.

```tsx
<PropertyList
  width={520}
  height={360}
  sections={[{
    id: "file",
    label: "File",
    items: [{ id: "name", label: "Name", value: file.name }],
  }]}
/>
```

---

## Media and DnD

### `CollectionItem` / `ContextMenuTrigger`

`CollectionItem` is the semantic interaction owner for a list or grid item. It
provides focus, Enter/Space activation, click/double-click, item context menus,
optional drop identity, and optional drag behavior without making drag code
own selection policy. `ContextMenuTrigger` supplies a background hit region
behind its children, so item menus win over background menus geometrically.
`focused` can control the recipe focus ring in compositor-owned hosts; regular
`Window` content uses the internal focus manager and optional `autoFocus`.

### Showcase and feedback

- `Toolbar`: consistent application chrome and horizontal spacing.
- `SegmentedControl` and `RadioGroup`: keyboard-capable exclusive choice.
- `Badge`, `Banner`, `Spinner`, and `EmptyState`: reusable status and feedback.
- `CodeView`: scrollable line-numbered TSX/TypeScript/JavaScript/shell source
  with renderer-native syntax highlighting.

`apps/developer/showcase` pairs a catalog list with Preview and Code tabs so every sample
can be inspected as both live widgets and readable JSX.

Use `dragSource={{ mimeTypes, getPayload, previewIcon }}` on `CollectionItem`.
For lower-level composition, `useDragSource()` exposes the same narrow drag
threshold/session behavior.

### `Icon`

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `name` | `IconName` \| string | required |
| `size` | `number` | `16` |
| `path` | `string` | optional PNG path |
| `color` | `number` | fallback geometry only |
| `symbolic` | `boolean` | `false`; load runtime SVG and apply `color` |

Names: `folder`, `file`, `image`, `app`, `trash`, `home`, `desktop`,
`downloads`, `up`, `grid`, `list`, `search`, `close`, `chevron-up`,
`chevron-down`, `chevron-left`, `chevron-right`, and `remove`.

Symbolic source files live at `packages/ui/icons/<name>.svg`. They use a small,
auditable SVG subset (rounded rectangles, circles, lines, polylines, and
polygons), rasterize once with 4×4 antialiasing, and cache by size/tint into the
backend-neutral `Image` scene primitive. This keeps the source elegant and
inspectable without coupling widgets to the software or EGL renderer. Bundled
PNG artwork remains available for colorful file/media icons when `symbolic` is
false; an explicit `.svg` path automatically takes the vector route.

### `ImageWidget`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `src` | `string` | async PNG path |
| `bitmap` | `{ rgba, width, height }` | sync |
| `opacity` | `number` | `1` |
| `fit` | `fill` \| `contain` \| `cover` | `fill` |
| `placeholder` | `boolean` | `true` |
| `onLoad` / `onError` | callbacks | optional |

`contain` preserves the whole bitmap over the recipe-owned placeholder;
`cover` preserves aspect ratio and clips overflow. Async sources repaint when
loading completes and resolve their loading/error frame from
`theme.recipes.imageWidget`.

### `Draggable` / `DropTarget`

**Draggable** is the compatibility wrapper for older callers. New collection
code should prefer `CollectionItem` plus `dragSource`; `DropTarget` remains the
window-level incoming-drop sink.

| Prop | Type | Notes |
| --- | --- | --- |
| `mimeTypes` | `string[]` | e.g. `["text/uri-list"]` |
| `getPayload` | `() => unknown` | string / buffer / list |
| `label` | `string` | preview label; else basename of `file://` |
| `previewIcon` | `DragIconSpec` | graphic for a source-sized preview; the pointer-down point remains its hotspot |
| `onPress` / `onDoublePress` / `onContextMenu` | | left-click and right-click actions |
| `children` | | visuals underneath hit layer |

**DropTarget** — registers for Wayland (and local) drops.

| Prop | Type | Notes |
| --- | --- | --- |
| `mimeTypes` | `string[]` | empty = accept all |
| `onDrop` | `(payload, mimeTypes) => void` | |
| `children` | | |

`Draggable`, `DropZone`, `DropTarget`, and the drag/drop states of
`CollectionItem` all use the same topmost `DndFeedback` presentation helper.
Its rounded source outline and drop wash resolve through `theme.recipes.dnd`,
so renderer backends receive one ordinary fill/stroke primitive rather than a
widget-specific paint path. A mounted `DropTarget` also refreshes its registry
entry when its semantic MIME list changes.

```tsx
<CollectionItem
  width={cellW}
  height={cellH}
  dragSource={{
    mimeTypes: ["text/uri-list"],
    getPayload: () => pathToUri(file) + "\n",
    previewIcon: { name: "file" },
  }}
  onPress={() => setSelected(i)}
  onDoublePress={() => open(file)}
  onContextMenu={showItemMenu}
>
  <GridItem
    width={cellW}
    height={cellH}
    label={file.name}
    interactive={false}
    icon={<Icon name="file" size={48} />}
  />
</CollectionItem>
```

Platforms call `setDndBridge` on connect — apps do not.

### `ContextMenu` / `OpenWithPicker`

Both are viewport overlays: they clamp themselves to the visible bounds,
install an outside-click dismiss target, and render after the app/shell content
so hit order matches paint order. `ContextMenu` consumes action descriptions
from a registry without depending on plugin code. `OpenWithPicker` receives
plain application choices, separates Recommended and Other Applications,
supports search and keyboard selection, and exposes separate one-time and
default-assignment callbacks.

---

## Data visualization

The chart family shares `ChartSeries` (`id`, optional `label`/`color`, and
`points`) and `ChartPoint` (`x`, `y`, optional `label`). Series colors fall back
to the active widget palette. Cartesian charts share axes, grid, legend,
nearest-point hover feedback, crosshair, and value formatting.

### `LineChart` / `AreaChart` / `ScatterChart`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `series` | `readonly ChartSeries[]` | required |
| `showAxes`, `showGrid` | `boolean` | `true` |
| `showLegend` | `boolean` | series count greater than one |
| `interactive` | `boolean` | `true` |
| `yMin`, `yMax` | `number` | inferred from finite values |
| `formatValue` | `(value: number) => string` | compact numeric format |
| `onHover` | `(hover: ChartHover \| null) => void` | optional |
| `lineWidth` | `number` | `2` (`LineChart`, `AreaChart`) |
| `showPoints` | `boolean` | `true` (`LineChart`, `AreaChart`) |
| `fillOpacity` | `number` | `0.22` (`AreaChart`) |
| `pointRadius` | `number` | `4` (`ScatterChart`) |

Use line charts for ordered change, area when magnitude and trend both matter,
and scatter when each observation's relationship or outlier status matters.

```tsx
<LineChart
  width={720}
  height={260}
  series={[{
    id: "cpu",
    label: "CPU",
    points: samples.map((y, x) => ({ x, y })),
  }]}
  formatValue={(value) => `${value.toFixed(1)}%`}
/>
```

### `BarChart` / `StackedBarChart`

These accept the shared Cartesian props plus `barRadius?: number` (default
`3`). `BarChart` places peer series beside one another. `StackedBarChart`
accumulates non-negative values in each category.

Use grouped bars for direct peer comparison and stacked bars when both the
whole and its contribution breakdown matter. Avoid stacking when precise
comparison between interior segments is the primary question.

### `Sparkline`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `values` | `readonly number[]` | required |
| `color` | `ARGB number` | theme accent |
| `fill` | `boolean` | `false` |
| `lineWidth` | `number` | `2` |

Sparklines intentionally omit axes, legends, and interaction. Use them beside
a primary metric where the surrounding text supplies scale and meaning.

### `DonutChart`

`DonutDatum` has `id`, `label`, `value`, and optional `color`.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `data` | `readonly DonutDatum[]` | required |
| `innerRadius` | ratio `0…0.9` | `0.58` |
| `showLegend` | `boolean` | `true` |
| `formatValue` | `(value: number) => string` | compact numeric format |

Use for a small composition with a meaningful total. Prefer bars when there
are many slices or small differences must be compared precisely.

### `RadialChart`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `value` | `number` | required |
| `max` | `number` | `1` |
| `label` | `string` | optional |
| `color`, `trackColor` | `ARGB number` | theme accent / border |
| `thickness` | `number` | proportional |
| `formatValue` | `(value, max) => string` | percentage |

Use for one bounded progress, utilization, or score value—not a time series or
multi-metric comparison.

### `HeatmapChart`

`HeatmapCell` has `row`, `column`, and numeric `value`.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `cells` | `readonly HeatmapCell[]` | required |
| `min`, `max` | `number` | inferred |
| `lowColor`, `highColor` | `ARGB number` | surface / accent |
| `showLabels` | `boolean` | `true` |
| `formatValue` | `(value: number) => string` | compact numeric format |

Use when two categorical dimensions define a matrix and color intensity makes
clusters, gaps, or periodic patterns easier to see.

### `ChartLegend`

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `series` | `readonly Pick<ChartSeries, "id" \| "label" \| "color">[]` | required |
| `x`, `y` | `number` | `0` |

The standalone legend is useful when several coordinated charts share one
series vocabulary. Individual charts otherwise own their legend automatically.

---

## Helpers

### `useAnimatedValue`

Declaratively eases toward a target while keeping intermediate values out of
React. Pass its `AnimationValue` directly to `Surface.translateX`,
`Surface.translateY`, or `Surface.opacity`.

| Argument / option | Type | Default |
| --- | --- | --- |
| `target` | `number` | required |
| `initialValue` | `number` | target on first mount |
| `duration` | `number` | `220` ms |
| `easing` | `linear \| ease-in \| ease-out \| ease-in-out` | `ease-in-out` |

```tsx
const opacity = useAnimatedValue(visible ? 1 : 0, {
  initialValue: 0,
  duration: 180,
  easing: "ease-out",
});

<Surface opacity={opacity} width={240} height={120} />
```

### `useLoop`

Declarative repeating presentation motion. The returned `AnimationValue` is
passed directly to `Surface.translateX` or `Surface.translateY`; its clock is
paced by compositor frame callbacks, and advancing it does not rerender or
reconcile React. Layout remains fixed while painting and hit testing observe
the live transform.

| Option | Type | Default |
| --- | --- | --- |
| `from`, `to` | `number` | required |
| `duration` | `number` | `1000` ms per journey |
| `easing` | `linear \| ease-in \| ease-out \| ease-in-out` | `ease-in-out` |
| `repeat` | `mirror \| loop` | `mirror` |
| `playing` | `boolean` | `true` |

```tsx
const x = useLoop({
  from: 12,
  to: width - 72,
  duration: 1800,
  repeat: "mirror",
  playing: !paused,
});

<Surface translateX={x} width={60} height={36} />
```

Use this path for continuous paint-only motion. `createLoopValue` offers the
same clock outside React and must be disposed by its owner.

### `useOscillation`

A true sinusoidal presentation value, useful for ambient motion, breathing,
scanner paths, and coordinated Lissajous-style movement. Like `useLoop`, it is
read directly by the renderer and does not reconcile React on each frame.

| Option | Type | Default |
| --- | --- | --- |
| `from`, `to` | `number` | required extrema |
| `period` | `number` | `2000` ms for a full cycle |
| `phase` | `number` | `0` radians |
| `playing` | `boolean` | `true` |

```tsx
const x = useOscillation({ from: 12, to: width - 72, period: 3200 });
const y = useOscillation({
  from: 12,
  to: height - 48,
  period: 4700,
  phase: Math.PI / 2,
});

<Surface translateX={x} translateY={y} width={60} height={36} />
```

### `Tween` / `useTween`

Duration-based numeric animation driven by the shared window/compositor motion
clock. `Tween` is a render-prop component; `useTween` is the hook form.
Animations settle exactly on their target, and remain renderer-neutral. Since
the resolved number is consumed during render, this compatibility API
reconciles while moving; prefer `useLoop` and live presentation props where a
layout-independent animation can bypass React.

| Prop | Type | Default |
| --- | --- | --- |
| `value` | `number` | required target |
| `from` | `number` | target on first mount |
| `duration` | `number` | `220` ms |
| `easing` | `linear \| ease-in \| ease-out \| ease-in-out` | `ease-in-out` |
| `children` | `(value: number) => ReactNode` | required |

```tsx
<Tween value={open ? 1 : 0} duration={180} easing="ease-out">
  {(progress) => (
    <Group opacity={progress}>{content}</Group>
  )}
</Tween>
```

`createTweenValue`, `useTweenValue`, and `tweenTo` expose the underlying
controlled clock for component authors. Existing `MotionValue` / `easeTo`
remain useful for spring-like exponential convergence.

### `usePalette()`

Returns `themePalette()`.

### Design tokens

`TYPE_ROLES`, `SPACE` — see [Theme](../theme/README.md).

`WidgetThemeProvider` also exposes semantic foundations used by public
widgets: palette, type, space, radii, motion durations, elevation levels,
border weights, control heights, density multipliers, focus-ring geometry,
and disabled/inactive/scrim opacity. Component recipes remain the place for
variant/size/state decisions. Apps should choose semantics such as
`elevation="medium"` or `size="small"`; pixel-level overrides are compatibility
escape hatches rather than a second theme system.
