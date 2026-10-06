# Moire welcome

An own-React welcome for the existing authorized Moire session. It displays the current process username, local date/time, and a single **Start session** action. It does not select accounts or authenticate users.

## Session integration

`runGreeter({ onContinue: async () => { /* session owner's continuation */ } })` returns `true` after an explicit Start action completes the callback and destroys the window/event loop. Callback errors stay in the welcome and allow retry. Concurrent pointer/key/repeat activations cannot invoke the callback twice. Ordinary window close quits with a `false` result. The parent then continues the already-authorized desktop through the same existing handoff used after a welcome failure. Closing does not invoke the explicit Start callback; the welcome is not an authentication barrier.

The installed welcome entry is `@moire/session`'s `src/welcome.ts`, wrapped as `moire-welcome` by Nix. It supplies the real `requestDesktopStart` callback, which awaits the current session bus's `org.moire.Display1.StartDesktop` acknowledgement. The session parent invokes the same idempotent handoff after ordinary close or failure, then launches its normal applications. It owns failure fallback, process supervision, compositor visibility and Nix/session wiring.

The standalone `@moire/greeter start` CLI is a presentation demo: its callback performs no desktop startup work, and it exits successfully only after explicit Start. Use the installed session entry for the real handoff.

The window requests native fullscreen, is undecorated and remains resizable. The compositor supplies its actual dimensions. `GreeterApp` exports the presentation separately, taking `width`, `height`, `username`, `onContinue`, `reducedMotion`, and optional `onReducedMotionChange`, `active`, fixed `now`, or an injected `backdrop`. `active={false}` suspends input and clock updates. Session owners may use this lifecycle when they have authoritative visibility information.

## Production motion status

Documentation-only correction: the immutable `createSilkBackdrop` source is cached per theme palette, then passed to shared `Backdrop`. Production already supplies `window.getRetainedMotionAdmission()` and the saved Reduce motion preference. The backdrop remains static because the graphics backend cannot supply the required positive rendering qualification. EGL availability alone does not authorize animation. Motion admission also requires authoritative visible output and matching submission acceptance and frame opportunity.

The C25 source diagnostic exercised 300 accepted moving frames with one additional component reconciliation and at most one pending frame. It used owned diagnostic context and output generations. This proves source lifecycle behavior, not installed or native GPU motion, frame timing, or tear-free output. Native qualification remains unfinished. See [rendering authority and motion qualification](../../../docs/architecture/gpu-residency.md#rendering-authority-and-motion-qualification).

## Keyboard and layout

Start receives initial focus. Enter/Space activate controls; Tab moves between Start and Accessibility. The Accessibility popover contains a keyboard-operable Reduce motion checkbox. Escape dismisses it and restores its opener focus. A compact form reduces type/gaps and scrolls naturally if long usernames or error text require more space.

The shared BrandMark supplies the interference blossom and a bundled, licensed serif wordmark. Other text uses bundled IBM Plex Sans. Password, user switching, network status, layout switching and power controls from the reference are absent because this welcome does not implement those workflows.

## Verification

Run `pnpm --filter @moire/greeter smoke` and `pnpm --filter @moire/greeter typecheck` from the repository. The smoke uses disposable HOME/XDG/TMP fixtures and actual Window/headless event dispatch and presented pixels. It checks continuation/retry, fullscreen, ordinary close, mixed rapid activation, inactive lifecycle, popover focus restoration, and 40 static frames spanning all ten theme variants, two sizes and scales 1/1.5.

Set `MOIRE_GREETER_CAPTURE_DIR` to save selected PNGs elsewhere. Reviewed captures and logs are preserved under `vm/verification/2026-10-03-greeter-v2-headless`. Headless success does not establish native startup/GPU acceptance; C14's accelerated startup blocker and root-owned C15 session integration remain separate gates.
