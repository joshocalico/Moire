# Images and icons

## PNG loading

```ts
import { loadImage, getCachedImage, clearImageCache } from "@moire/ui";

const img = await loadImage("/path/to/file.png");
// { rgba: Uint8Array, width, height }

getCachedImage(path); // sync or null
clearImageCache();
```

- Decoder: `pngjs` (no native deps).
- `Icon` uses an internal sync loader so the first frame is not blank.
- JPEG is not a first-class path; prefer PNG presets or convert offline.

## `ImageWidget`

Renders a react-host `image` node. Pass `src` (async) or `bitmap` (sync).
`fill`, `contain`, and clipped `cover` fitting are supported. The widget
repaints after an asynchronous load and uses the shared `imageWidget` recipe
for its loading, error, and letterbox frame; set `placeholder={false}` for a
transparent slot.

## Bundled icons

Directory: `packages/ui/icons/`.

| Name | Typical use |
| --- | --- |
| `folder` | Directories |
| `file` | Generic files |
| `image` | Image extensions |
| `home` / `desktop` / `downloads` | Places |
| `app` | Launcher rows |
| `trash` / `up` / `grid` / `list` | Actions / view modes |

```tsx
<Icon name="folder" size={48} />
```

Missing files fall back to simple geometric shapes tinted with `color`.

## Thumbnail pipeline

Not shipped. `ImageWidget` + `loadImage` are the intended primitives when generators exist.
