# Silk boot artwork

`silk-fold.png` is generated with Moire's React reconciler, shared `Backdrop` and
`BrandMark`, and the bundled licensed DejaVu Serif wordmark. The artwork is a
shared-renderer approximation of the approved Silk Fold E reference. Its oval
coil remains simpler than the reference's multiple folds; alignment is unfinished.

Regenerate from the repository root:

```bash
corepack pnpm --filter @moire/ui exec tsx scripts/generate-boot-artwork.tsx ../../themes/boot/silk-fold.png
```

The generator rejects blank artwork, missing wordmark pixels and incomplete
viewport coverage. It reports the compressed/decoded size, geometry bounds,
SHA256 and separate generation/raster/PNG costs. The current 1280×800 artifact
is 1003842 bytes compressed and 4096000 bytes decoded. Its SHA256 is
`0c84a2bcf23b9d7ee660404404f5e516ae7b41ad205b652d389f373d7a2e300f`.
This is the next source wave's artifact; C15 retains its recorded older image.

Only the static PNG and Plymouth descriptor/script enter the boot theme.
The initrd does not run Node, React, the artwork generator or an animation loop.
Plymouth's script plugin owns this early fallback at runtime. It is not the
requested running Moire React boot root and does not complete Silk animation.
That requirement remains unfinished. Its intended owner is a separate early
Moire React root using the shared Backdrop, bounded retained graphics, native
input and a direct Escape-to-real-console path, with an explicit DRM handoff to
the session. Startup/closure/input/recovery costs must be verified before
replacing this bounded fallback; no artificial wait is added to extend a splash.
The script centers and contain-fits the complete image on each output and
updates when displays change. It does not handle keys or fabricate progress.
Plymouth's daemon owns Escape and switches to its real boot details buffer.
The NixOS configuration preserves serial and VT console parameters and patches
upstream details to avoid globally suppressing new serial kernel messages.
Native Escape and recovery behavior require verification on each boot candidate.

The theme smoke runs the actual pinned Plymouth script parser, PNG loader and
scale engine without a display or daemon:

```bash
python3 -B themes/boot/plymouth-theme.smoke.py --plugin /nix/store/ACTUAL-plymouth/lib/plymouth/script.so
```

Use the candidate's actual Plymouth path, not the illustrative path above.
Recorded C15 headless PNG loads were about 15 ms CPU/wall, excluding boot,
scaling and display time, with uncontrolled page cache. Generator costs and
headless theme evidence are in `vm/verification/2026-10-03-startup-presentation/`.
These measurements do not establish native startup latency or GPU acceleration.
