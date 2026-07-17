# Widgets

All widgets are React elements built with `createElement` (or JSX if configured). Coordinates are absolute within the parent; `Row` / `Column` position children via Yoga.

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

```ts
createElement(Row, { width: 400, gap: 12, padding: 16, children: [...] });
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

Display field; **keyboard input is app-managed**.

| Prop | Type | Default |
| --- | --- | --- |
| `width` | `number` | required |
| `value` | `string` | required |
| `placeholder` | `string` | |
| `focused` | `boolean` | underline accent |
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
| `interactive` | `boolean` | `true` — set `false` inside `Draggable` |
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

**Draggable** — press + move ≥ 6px starts platform drag; otherwise click / double-click.

| Prop | Type | Notes |
| --- | --- | --- |
| `mimeTypes` | `string[]` | e.g. `["text/uri-list"]` |
| `getPayload` | `() => unknown` | string / buffer / list |
| `label` | `string` | preview label; else basename of `file://` |
| `previewIcon` | `DragIconSpec` | graphic for a source-sized preview; the pointer-down point remains its hotspot |
| `onPress` / `onDoublePress` | | when not dragging |
| `children` | | visuals underneath hit layer |

**DropTarget** — registers for Wayland (and local) drops.

| Prop | Type | Notes |
| --- | --- | --- |
| `mimeTypes` | `string[]` | empty = accept all |
| `onDrop` | `(payload, mimeTypes) => void` | |
| `children` | | |

```ts
createElement(
  Draggable,
  {
    width: cellW,
    height: cellH,
    mimeTypes: ["text/uri-list"],
    getPayload: () => pathToUri(file) + "\n",
    onPress: () => setSelected(i),
    onDoublePress: () => open(file),
  },
  createElement(GridItem, {
    width: cellW,
    height: cellH,
    label: file.name,
    interactive: false,
    icon: createElement(Icon, { name: "file", size: 48 }),
  }),
);
```

Platforms call `setDndBridge` on connect — apps do not.

---

## Helpers

### `usePalette()`

Returns `themePalette()`.

### Design tokens

`TYPE_ROLES`, `SPACE` — see [Theme](../theme/README.md).
