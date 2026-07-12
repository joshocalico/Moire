# Known issues (follow-ups)

## Launcher “works” but apps never appear (2026-07-12)

**Cause:** Session used `XDG_RUNTIME_DIR=/run/user/1000` via `runuser` with no logind session. systemd deleted `/run/user/1000`, removing the Wayland socket path while the compositor kept running (in-process launcher still painted). Spawned apps could not connect.

**Fix:** Guest session uses `$HOME/.moire-runtime` instead.

## Gradual memory leak → OOM (logged 2026-07-12, patched same day)

**Symptom:** Compositor RSS grows steadily while the session runs (foot + Files). CPU stays high (~30–40% on MoireDev) from the CPU composite path. After ~2h on MoireDev the kernel OOM-killed `node` (compositor):

```
Out of memory: Killed process … (node) total-vm:45671280kB, anon-rss:7774460kB
```

**Fixes applied:**

1. **`composite()`** — paint from `surf.pixels` directly (no `Buffer.from` every frame).
2. **`koffi.alloc` hot paths** — reuse scratch for `recvmsg`/`sendmsg`, `presentKms` connectors, and GBM import structs (was a native leak at ~60–200 Hz).
3. **Minimized surfaces** — still fire frame callbacks + `wl_buffer.release` (arrays were unbounded).
4. **Pixel snapshots** — reuse per-surface `Uint8Array` when size is unchanged.
5. **Commit logging** — gated behind `MOIRE_DEBUG_SURFACE=1`.
6. **Client disconnect** — purge `xwayByWid` / `xwayPendingBySerial`; clear surface pixels on destroy.

**Still watch:** large foot `wl_shm` pool mmaps (RSS floor).

**CPU present path (2026-07-12):** compositor loop is dirty-driven — skip wallpaper/`flushMmap`/`presentKms` when idle (~50 ms poll); `markDirty()` on commits, pointer motion, shell clock, stack/focus. Cached `drmModeSetCrtc` on `KmsOutput` (no per-frame `loadLibdrm`). On MoireDev idle ~11% CPU vs prior ~30–40% (measure with `scripts/guest-measure-cpu.sh`). Remaining idle cost is mostly per-client `recvmsg` poll (~5 ms).

## Xwayland / X11 apps (updated 2026-07-12)

**Working:**
- **Rootless Xwayland (default)** via `-rootless` + `-wm` socketpair; XWM in TypeScript; per-window `wl_surface` + React SSD (no nested “Xwayland on :N” window)
- Pairing: `WL_SURFACE_SERIAL` from XWM matched to `xwayland_shell_v1` surfaces (orphan path when Wayland `set_serial` races or is absent)
- Glamor via **`wl_drm`** / PRIME (`create_prime_buffer`)
- XRGB dmabuf snapshots force opaque alpha; GBM preferred over empty mmap
- Nautilus / LibreOffice may keep **CLIENT** CSD when they request it; session ships **`themes/Moire`** GTK theme + dark preference so CSD chrome matches Moire
- **xdg_popup** context menus: positioner + configure + grab + paint/hit above toplevels; dismiss on outside click / Escape
- Opening a dialog from a menu (About, Properties, …) **ends the popup grab** (`popup_done`) before the new toplevel takes keyboard focus — otherwise GTK aborts on the seat-focus violation
- **wl_buffer.release once per attach** — empty re-commits must not release again (was aborting Nautilus in `gdk_wayland_surface_attach_image` when opening About → Credits)
- **SSD close on X11 windows** — ICCCM `WM_DELETE_WINDOW` ClientMessage when advertised in `WM_PROTOCOLS`, else `DestroyWindow` (was incorrectly `UnmapWindow`)
- **SSD actions key by clientId + surfaceId** — Wayland object ids are per-connection; matching on surfaceId alone could close the wrong window
- **EWMH basics** — root `_NET_SUPPORTED` + `_NET_SUPPORTING_WM_CHECK`; `WM_TRANSIENT_FOR` / `_NET_WM_WINDOW_TYPE` read on map; dialogs centered over parent; menus/tooltips/splash undecorated
- **`_NET_ACTIVE_WINDOW`** — published on focus; ClientMessage requests raise/focus the paired surface
- **`_NET_WM_STATE_MODAL`** — read on map; modals with a transient parent are centered like dialogs
- **`xwayland_shell_v1` only for Xwayland** — detected via `SO_PEERCRED` + `/proc/<pid>/exe`; hidden from other clients’ registries

**Rootful fallback:** `MOIRE_XWAYLAND=rootful` for the nested screen.

**Still later:** fuller EWMH (maximize state sync, workspaces); confirm why Ubuntu’s Xwayland 23.2 sometimes skips `set_serial` on the wire.

## DE chrome foundation (2026-07-12)

- **`@moire/theme`** loads `themes/default/theme.json` (tokens + wallpaper)
- Shell TitleBar/Panel/Launcher use `themePalette()`; panel brand is 2× bitmap font
- Widget primitives: `Label`, `Button`, `Surface`, `Divider` in `@moire/shell`
- Compositor paints wallpaper from theme (`gradient` by default) instead of fixed teal

