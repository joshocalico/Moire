# Native greeter wave: narrow admission proposal

Status: bounded software-wave implementation approved through Bridge/Loop on
2026-10-05 within Josh's existing task. Source implementation and focused checks
passed, and the separate C63 R3 image passed bounded native pixel, reduced-motion
and lifecycle acceptance. See [the tested image](native-desktop-vm.md#current-tested-image-c63-r3-software-greeter-wave).
C63 R2 remains preserved.

The smallest visual change is to animate the existing Silk backdrop's paint-only
translation using its existing `useOscillation` participants and the greeter's
Window-owned admission. Keep the immutable Silk source, motion ownership,
reduced-motion override and login/session/logout teardown. This proposal does
not add a new renderer, shader, compositor mesh, GPU transport or app campaign.

## Concrete blocker

`WindowRetainedMotionController.isActive()` in
`packages/ui/src/retained-motion-admission.ts` requires `hardware-retained`.
Its `renderingChanged()` also resets participants for `static/software`.
The current output is software EGL (llvmpipe), so the gate correctly refuses
that hardware-only contract.

Merely accepting `static/software` is insufficient. In
`packages/ui/src/platforms/wayland/rendering.ts`, `submitted()` clears output
acceptance but `update()` immediately reports `static/software` for a software
submission. That state can precede any compositor acceptance. A matching frame
callback is also a pacing opportunity, not output acceptance by itself.

The native frontend additionally fixes reduced motion in both
`apps/system/greeter/src/native/main.tsx` and `native/view.tsx`. Its current
Accessibility popover explicitly says motion stays reduced. Removing those
constants alone would neither establish pacing authority nor enable this gate.

## Proposed contract change

1. Add a distinct `UiFrameEvent` variant:

   ```ts
   { type: "output-accepted"; commitId: number; execution: "software" }
   ```

   Produce it only from an actual `moire_surface_state_v1.rendering=software`
   observation matching the live submission token. Reuse the rendering
   tracker's rejection of stale tokens, closed windows and lost backends.
   Do not produce it on submission, buffer release or `wl_callback.done`.
   Clear eligibility on every newer submission and on unknown/lost output.
   No new Wayland protocol or hardware assertion is needed.

2. Add an explicit Window-owned motion policy, with the existing hardware-only
   behavior as the default and a `software-wave` profile used only by the native
   greeter. Under that profile, motion requires all of:

   - actual software output acceptance for the current commit;
   - compositor-observed visible surface;
   - matching submitted and compositor-frame tokens;
   - no pending presentation/backpressure or backend loss;
   - an active participant and reduced motion disabled.

   Keep `UiRenderingState`, execution classification, output facts and hardware
   admission unchanged. Software stays software; virtual/unknown execution gets
   no new authority. Hidden/pending windows keep their phase without advancing;
   unknown/lost output resets to canonical static geometry. One window cannot
   advance another window's participants.

3. Reuse the current `beforePresent`/submitted/frame/retry ownership flow. Cap
   the software-wave profile at ten updates per second, with at most one next
   paint per qualified opportunity and no catch-up burst. Use the existing
   Application/Window scheduler rather than a new animation interval. Backend
   failure returns to the static backdrop and never delays authentication or
   device release.

4. Pass the greeter Window's admission to the existing `Backdrop`. Remove the
   two unconditional reduced-motion constants only as part of this approved
   path. Reuse Application personalization overrides and the existing Checkbox
   interaction for a local Reduce motion control. Respect the discovered/default
   motion preference; local changes last only for this sign-in window. Do not
   write another user's preferences or add settings permissions to demonstrate
   motion. Stop/unregister the participants on the existing dismiss path.

## Focused proof after review

Extend the existing rendering-tracker and per-window admission tests to prove
that submission/frame callbacks alone cannot animate software, stale acceptance
cannot arm a newer frame, the cap holds, and hidden/pending/lost/closed/reduced
states do not advance. Keep hardware/virtual/unknown classifications unchanged.
Exercise the actual public Window with independent changed-pixel evidence and
close/unmount cleanup; simulated acceptance is not native qualification.

After reserving a sole Recovery-coordinated VM window, build a fresh immutable
image. In the native greeter, prove changing backdrop pixels separately from the
clock/form, live reduced-motion stop/resume, no orphan motion after handoff, and
two real login/desktop/logout/fresh-greeter cycles. Record observed frame/copy
costs and software EGL identity without inferring hardware display timing or
tearing elimination. Preserve the final bootable image and C63 R2/R7 fallbacks.

The approved implementation adds a separate current-token output acceptance
event and paired revocation. An initial unknown observation for a new pending
commit holds phase; revoking an already accepted output resets canonical
geometry. Ordinary windows retain hardware-only admission. The native checkbox
uses application overrides with source=application and never calls session
preference persistence. This document records the contract, not native acceptance
or a graphics performance claim.
