# Widgets

All widgets are React elements and JSX is the presentation standard.
Coordinates are absolute within the parent; `Row` / `Column` position children
via Yoga.

Moire currently uses the classic React JSX transform for compatibility with
the custom reconciler, so `.tsx` presentation modules import `React` as a
runtime value.

Import from `@moire/ui`. Colors are ARGB numbers from `themePalette()` unless noted.

---

## Layout

### `Box`

Absolute group.

| Prop | Type | Default |
| --- | --- | --- |
| `x`, `y` | `number` | `0` |
| `width`, `height` | `number` | `0` |
| `children` | `ReactNode` | |

### `Row` / `Column`

Flex containers (`ColumnProps` extends the same shape as `Row`).

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `height` | `number` | |
| `gap` | `number` | `8` |
| `padding` | `number` | `0` |
| `justify` | `start` \| `center` \| `end` \| `space-between` \| `space-around` | |
| `align` | `start` \| `center` \| `end` \| `stretch` | Row: `center`, Column: `stretch` |
| `children` | `ReactNode` | |

```tsx
<Row width={400} gap={12} padding={16}>
  {children}
</Row>
```

### `Surface` / `Panel`

Filled background. `Panel` defaults fill to `pal.surface`; `Surface` to `pal.panel`.

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `fill` | `number` | theme |
| `onPress` | `() => void` | |
| `children` | `ReactNode` | |

### `Separator` (`Divider` alias)

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `height` | `number` | `1` |
| `color` | `number` | `pal.border` |

### `Label`

| Prop | Type | Default |
| --- | --- | --- |
| `text` | `string` | required |
| `color` | `number` | `pal.text` |
| `fontSize` | `number` | ~14 |
| `fontWeight` | `regular` \| `medium` \| `bold` | |
| `fontFamily` | `sans` \| `mono` | |
| `width`, `height` | `number` | optional clip box |

Prefer `TYPE_ROLES.*.size` for consistent hierarchy.

---

## Interaction

### `Pressable`

Hit target with eased hover/press fills (`pal.hover` / `pal.pressed`).

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `fill` | `number` | transparent |
| `onPress` | `() => void` | |
| `onDoublePress` | `() => void` | 400ms window |
| `disabled` | `boolean` | |
| `children` | `ReactNode` | |

### `Button`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `label` | `string` | required |
| `variant` | `primary` \| `secondary` \| `ghost` \| `danger` | `secondary` |
| `fill` / `color` | `number` | override variant |
| `fontSize` | `number` | `14` |
| `disabled` | `boolean` | |
| `onPress` | `() => void` | |

Primary uses `accentLine` fill; secondary uses `surface` + rim; ghost is transparent.

### `IconButton`

Same as `Button` but `icon: string` becomes the label (for emoji/short glyphs). Prefer `Icon` + `Pressable` for artwork.

### `Checkbox` / `Toggle` / `Slider`

| Widget | Key props |
| --- | --- |
| `Checkbox` | `checked`, `onChange?(boolean)`, `label?` |
| `Toggle` | `on`, `onChange?(boolean)`, `label?` |
| `Slider` | `width`, `value` 0..1, `onChange?(number)`, `height?` (24) |

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
| `onFocusChange` | `(focused: boolean) => void` | |
| `focused` | `boolean` | optional visual focus override |
| `autoFocus` | `boolean` | focus once when mounted |
| `invalid` | `boolean` | danger validation stroke |
| `disabled`, `readOnly` | `boolean` | |

`SearchField` composes the same editor with theme-sized search and clear
slots. It preserves the `TextField` keyboard/focus contract, clears through
`onChange("")`, and can additionally report `onClear`. Launch and Open With use
this shared control rather than maintaining local search-field paint.

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
| `height` | `number` | `32` |

### `Tabs`

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `tabs` | `string[]` | required |
| `active` | `number` | required |
| `onChange` | `(index) => void` | |
| `height` | `number` | `32` |

Active tab: accent underline (not a full teal slab).

### `Dialog` / `Menu` / `MenuItem`

- `Dialog`: `title`, `width`, `height`, `onClose?`, `children` — title bar with danger close.
- `Menu`: `width`, `items: { label, onPress? }[]`.
- `MenuItem`: single row helper.

### `ProgressBar`

`width`, `value` 0..1, `height?` (8).

---

## Collections

### `ScrollArea`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `contentHeight` | `number` | required |
| `scrollY` / `onScroll` | controlled scroll | |
| `scrollbar` | `boolean` | auto when overflow |
| `children` | `ReactNode` | |

Clipped viewport; wheel scrolls. Content should be positioned for the full content height.

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

---

## Media and DnD

### `CollectionItem` / `ContextMenuTrigger`

`CollectionItem` is the semantic interaction owner for a list or grid item. It
provides focus, Enter/Space activation, click/double-click, item context menus,
optional drop identity, and optional drag behavior without making drag code
own selection policy. `ContextMenuTrigger` supplies a background hit region
behind its children, so item menus win over background menus geometrically.

Use `dragSource={{ mimeTypes, getPayload, previewIcon }}` on `CollectionItem`.
For lower-level composition, `useDragSource()` exposes the same narrow drag
threshold/session behavior.

### `Icon`

| Prop | Type | Default |
| --- | --- | --- |
| `name` | `IconName` \| string | required |
| `size` | `number` | `16` |
| `path` | `string` | optional PNG path |
| `color` | `number` | fallback geometry only |

Names: `folder`, `file`, `image`, `app`, `trash`, `home`, `desktop`, `downloads`, `up`, `grid`, `list`.

Bundled files: `packages/ui/icons/<name>.png`.

### `ImageWidget`

| Prop | Type | Default |
| --- | --- | --- |
| `width`, `height` | `number` | required |
| `src` | `string` | async PNG path |
| `bitmap` | `{ rgba, width, height }` | sync |
| `opacity` | `number` | `1` |
| `fit` | `fill` \| `contain` \| `cover` | declared; treat as fill today |

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

## Helpers

### `usePalette()`

Returns `themePalette()`.

### Design tokens

`TYPE_ROLES`, `SPACE` — see [Theme](../theme/README.md).
