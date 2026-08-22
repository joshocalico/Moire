# Rendering and widget v2

This is the active queue for moving Moire from a correct software desktop to a
renderer-flexible, effect-capable desktop—and for removing visual policy from
individual widgets.

## Current checkpoint

The compositor accepts `MOIRE_RENDERER=auto|software|egl`.

- `software` is the deterministic reference and fallback.
- `egl` creates a surfaceless GBM/EGL GLES context, uploads the shared logical
  scene, and performs per-output crop and scale on the GPU.
- `auto` attempts EGL and reports a concrete fallback reason before selecting
  software.
- The first EGL path reads back into the existing dumb KMS framebuffer. This
  validates context ownership, shaders, output geometry, orientation, and
  channel order without entangling rendering with page-flip lifetime.
- `[renderer/profile]` reports average scene construction, output rendering,
  and KMS presentation times. Scene construction is split into wallpaper,
  desktop, window, chrome, and top-overlay phases so optimization is driven by
  measured cost.

The EGL backend also has a retained composition entry point. It caches source
textures by stable layer id and content revision, composites premultiplied
layers with opacity, sampling and projective 4×4 transforms, and reclaims stale
textures. The live desktop now uses retained layers for wallpaper, desktop
icons, every client surface, SSD strips interleaved in window stack order,
shell chrome, popups, client drag icons, failed-drop return animations, and the
cursor. Xdg window geometry is a native shader mask: opaque client padding is
discarded while translucent pixels remain available as shadows. Shell-owned
drag chips without a Wayland icon are the remaining flattened drag case. A
retained-scene failure also rebuilds the same frame through the compatibility
path instead of looping on a black output.

Backdrop blur is now a native stacking operation. The EGL backend snapshots
the accumulated scene, downsamples it, applies separable horizontal and
vertical passes through independent ping-pong targets, then composites the
result only inside the requesting layer before its foreground is drawn. The
bottom panel is the first live material consumer, with saturation and tint
carried by the backend-neutral effect description.

Native 4×5 color matrices execute on retained layer sources in semantic RGBA
order. The shader converts from the compositor's BGRA byte storage,
unpremultiplies before applying the matrix, and premultiplies the result before
source-over composition, so translucent effects retain correct blend math.

The composition vocabulary already describes stable z-order, source and
destination rectangles, opacity, blend mode, clipping, corner radii, and an
effect stack. Effects include backdrop blur, drop shadow, and color matrix.
Backends advertise actual capabilities; declaring an effect does not silently
claim that the current flattened path executes it.

Window nodes additionally describe deformable meshes and namespaced extension
effects. Extensions are resolved through compositor-owned registrations rather
than accepting shader source from applications. This leaves room for Compiz-
style workspace/window deformation and Quartz-style material passes without
making widgets or window-management policy depend on GLES.

## Rendering queue

### R1 — current: EGL execution and conformance

- Keep software and EGL selectable at runtime.
- Conformance-test BGRA channels, top-left desktop orientation, crop, scale,
  padded output pitch, and fallback behavior.
- Profile real VM output at normal and high resolutions.

### R2 — active: split the flattened scene into compositor layers

Replace direct writes into `CompositorServer.stage` with a `CompositionScene`:

1. wallpaper
2. desktop
3. each toplevel tree and its SSD in interleaved stack order
4. shell overlays
5. native popups
6. drag preview
7. cursor

Client commits and shell rasters carry revisions so an EGL backend uploads only
dirty textures. Software consumes the same ordered layers and remains the
correctness oracle. Hit testing continues to use retained geometry, never
painted pixels.

The first supporting pieces are active: client surfaces carry monotonic buffer
revisions, the EGL texture cache is revision-aware, known-opaque software
surfaces use row copies, and cached shell rasters retain per-row alpha runs for
future regional upload/damage.

### R3 — active: native effects

- Layers render into an offscreen scene target.
- Per-corner rounded clipping and bounded analytic rounded-rectangle window
  shadows execute in GLES and follow projective transforms.
- Separable, downsampled backdrop blur executes against the accumulated
  backdrop and is clipped to the requesting layer; it is a stacking effect,
  not a widget screenshot trick.
- Propagate bounded blur damage so unchanged regions do not rerun the pass.
- Saturation/tint, rounded masks, shadows, and semantic RGBA color matrices
  execute in GLES; preserve their ordering when effects move behind plugins.
- Define effect quality tiers so software, low-power EGL, and full EGL can make
  explicit tradeoffs without changing widget APIs.

### R4 — GBM scanout and page flips

- Resolve the current Parallels GBM window-surface `EGL_BAD_MATCH` by matching
  `EGL_NATIVE_VISUAL_ID` to the GBM format, or render through EGLImages into
  explicitly allocated GBM BOs.
- Register BOs with DRM, page-flip, retain the previous front buffer until the
  flip event, then release it.
- Allocate targets per physical output and rebuild them transactionally across
  mode/hotplug changes.
- Remove `glReadPixels`, dumb-buffer upload, and repeated `drmModeSetCrtc` from
  steady-state EGL presentation.

### Future — renderer and compositor effect plugins (earmarked)

There are two useful plugin seams once the render-pass API is stable. First,
the current `software` and `egl` output renderers should be registered backend
plugins with probe, capability, context-loss, presentation, and teardown hooks;
`auto` then selects from that registry instead of constructing concrete classes
in core. Software remains the always-present oracle and safe fallback.

Second, backdrop blur should become the first in-tree effect plugin. This is a
trusted compositor plugin boundary, not an application protocol for uploading
arbitrary shaders.

1. Add an `EffectPluginManifest` with a namespaced id, API version, required
   inputs (`source` / `backdrop`), damage padding, quality tiers, and backend
   capability requirements.
2. Add a compositor-owned registry that resolves the existing
   `extension(namespace, name)` composition effect into a validated pass
   factory. Unknown or unsupported effects must fail capability negotiation,
   never silently disappear.
3. Give backend plugins scoped render resources and lifecycle hooks for
   compile, resize, execute, context loss, and destroy. Do not expose the raw
   compositor context or permit unbounded target allocation.
4. Support an optional deterministic software implementation so effect tests
   can remain backend-independent; otherwise the manifest must explicitly
   declare EGL-only support and its fallback policy.
5. Move the built-in backdrop snapshot, regional downsample, separable blur,
   saturation, tint, and rounded material composite behind that interface as
   the conformance plugin.
6. Only after the in-tree ABI and resource limits settle, consider trusted
   loadable packages and development hot reload. Client-selected effects remain
   symbolic requests mediated by compositor policy.

### R5 — damage and direct scanout

- Propagate surface and widget damage through transforms and effects.
- Redraw only damaged output regions; expand blur damage by kernel radius.
- Direct-scanout an eligible opaque fullscreen dmabuf when no higher layer or
  effect requires composition.

## Widget styling queue

The existing widgets are reusable behavior wrapped around too much internal
visual policy. `Button`, for example, decides its own radius, fills, rim,
typography, padding, and state colors. That makes themes token substitutions,
not actual visual systems.

### W1 — semantic tokens and recipes

- Separate foundation tokens (color, type, space, radii, motion, elevation)
  from component recipes.
- Define recipes by widget, variant, size, and state.
- Resolve recipes through a theme context rather than calling the global
  palette from every widget.
- Permit application- or subtree-level theme overrides.

```ts
type ButtonRecipe = {
  root: StatefulStyle<BoxStyle>;
  label: StatefulStyle<TextStyle>;
  leadingIcon: StatefulStyle<IconStyle>;
  trailingIcon: StatefulStyle<IconStyle>;
  focusRing: StatefulStyle<StrokeStyle>;
};
```

States are semantic (`rest`, `hover`, `pressed`, `focused`, `disabled`,
`selected`, `danger`) and may alter geometry, paint, typography, or motion.
Recipes are plain data and remain renderer-neutral.

### W2 — slot-based primitives

- Give compound widgets named slots instead of one monolithic paint function.
- Accept `class`/recipe keys, local style overrides, and replacement slot
  renderers without forfeiting built-in behavior.
- Move interaction state into headless controllers/hooks; recipes paint it.
- Remove hard-coded pixel geometry from `Button`, `ListItem`, `TextField`,
  `Tabs`, menus, sidebar rows, titlebar controls, and collection items.

### W3 — primitive completeness

Extend the retained scene consistently across software and EGL:

- per-corner radii and rounded clips
- transforms and transform origins
- paths and icon geometry
- gradients and material fills
- shadows/elevation and effect layers
- text overflow/alignment and scalable metrics

### W4 — showcase and conformance

- Turn the widget gallery into a theme/variant/state matrix.
- Exercise pointer, keyboard, focus, disabled, high-scale, narrow-window, dark,
  light, and custom-theme cases.
- Snapshot the same conformance scene through software and EGL.
- Treat a new hard-coded widget color/radius/padding as a review failure unless
  it is itself a documented semantic default.

## Architectural rules

1. Widgets never branch on renderer identity.
2. Effects are scene semantics; backends report support explicitly.
3. EGL failure cannot make the desktop unavailable when software can run.
4. Software remains deterministic and tested, not a neglected debug mode.
5. Presentation owns scanout buffers; scene rendering does not own DRM policy.
6. Themes own visual recipes; widgets own semantics and interaction.
7. Blur and other backdrop effects obey compositor stacking and damage.

## Near-term acceptance criteria

- `auto`, forced `software`, and forced `egl` boot successfully in MoireDev.
- EGL output matches software orientation and color conformance.
- Timings distinguish CPU scene work from GPU/output work.
- The compositor can be migrated layer-by-layer without changing Wayland input,
  focus, stacking, or widget code.
- A first recipe-driven `Button` can reproduce the current appearance entirely
  from the default theme and also demonstrate a materially different theme
  without forking the component.
