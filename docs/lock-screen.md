# Lock screen

The compositor owns the session lock. While locked, no frame shows client content, no input
reaches a client, and only the session user's password (checked by pam_unix's `unix_chkpwd`) or
logind's `Unlock` for the session ends the lock. The shell draws the lock UI. If the UI fails,
the compositor draws its own prompt and the session stays locked.

## Threat model

**Protected against:** someone at the keyboard and screen of an unattended, locked session.

- **Screen:** while locked, composition takes a separate path (`compositeLocked` in
  `packages/core/src/server.ts`) that never reads a client surface. It draws black on every
  output, plus the obscured wallpaper, the lock UI and the compositor's own cursor on one output.
  Windows, popups, client cursor images, drag icons, the panel and notification banners are not
  drawn. The locked frame is flat on every renderer, so no retained scene with client layers is
  built. A window that maps while locked is never drawn.
- **Input:** keys and pointer events go only to the lock. Clients receive `wl_keyboard.leave` and
  `wl_pointer.leave` when the lock starts. As a backstop, `ClientSession` refuses to send keyboard
  enter, key and modifier events, pointer events, DnD enter and new selection offers while
  locked. That holds for focus changes made during the lock, xdg-activation, and Xwayland pointer
  feeding. Popup grabs, interactive move/resize and drags end when the lock starts. A client
  cannot start a drag or paste while locked.
- **Unlock keys:** keys pressed on the lock screen, such as the Enter that unlocks, never reach a
  client, and neither do their repeats or releases. After unlock, keyboard focus returns to the
  focused window, with only the keys held since before the lock.
- **Password handling:** the compositor turns keys into UTF-8 with its own XKB state
  (`XkbKeyboardState.keyText`, which honours the active layout). It writes them into one fixed
  512-byte buffer and never makes a JS string from them. Submitting copies the buffer for the
  check and wipes it at once. The copy is wiped once the verdict arrives, and the checker's
  NUL-terminated pipe copy is wiped once written. The UI only sees the length. The password goes
  to `unix_chkpwd` on stdin, never in argv or the environment (the helper runs with an empty
  environment). Nothing logs it.
- **Guessing:** every wrong password costs 2 s. Five wrong in a row lock checks for a minute
  (`createPasswordThrottle`, shared with the management service but a separate instance).
- **Suspend:** with "Lock on suspend", the session holds a logind `sleep` delay inhibitor and
  releases it only after a locked frame has been presented. When the outputs are off, nothing is
  on screen, so the lock counts as presented at once and the first frame after waking is locked.
- **Fail closed:** if the shell's lock UI throws, returns an invalid raster, or the shell is
  missing, the compositor draws its own text-free prompt: a padlock, one dot per character, and
  the field's colour for the state. Keys keep working. If building the locked frame itself
  throws, a black frame with that prompt is presented. If the authenticator throws or the helper
  is missing, the state is "unavailable" and the session stays locked.

**Not protected against:**

- **Code running as the user.** It can call logind's `UnlockSession` for its own session (logind
  lets the session owner do that without polkit), kill the compositor (which ends the session
  and shows the greeter), or read the user's files. The lock is a screen lock, not a sandbox.
- **Root, physical access to storage, a VT switch to a root shell, and DMA attacks.**
- **Clients behind the lock keep running.** They get frame callbacks and buffer releases once a
  second, and their surfaces report not visible. Audio keeps playing, and network activity
  continues.
- **Process memory.** JS strings already created elsewhere (Settings' password fields, D-Bus) are
  outside this path. The lock's own buffers are wiped, but V8 may have copied bytes during
  `Buffer` operations.
- **Input fixture tracing** (`MOIRE_INPUT_FIXTURE_TRACE`, a developer diagnostic) records raw key
  codes at the device layer. The installed session wrapper unsets it.

## Behaviour

- **Lock screen:** clock and long date, the user's initial and full name (GECOS, else the
  username), a password field with dots and a caret, a status line, "Caps Lock is on", and at the
  foot the battery, the keyboard layout (with more than one), and a power menu. The power menu
  offers Suspend, Restart and Shut down only when logind's `CanSuspend`/`CanReboot`/`CanPowerOff`
  answer "yes" (the same capabilities Quick Settings › Power reads). The compositor checks that
  again before calling logind. The style follows the greeter.
- **Typing:**
  - Text, Backspace (one code point), Escape and Ctrl+U (clear), Enter (submit).
  - Ctrl and Super combinations type nothing.
  - The layout switch shortcut still switches layouts.
  - Power keys follow the power settings.
- **States:**
  - Checking: dots dim, no caret.
  - Wrong: red field, a shake, and "That password didn't work".
  - Rate limited: typing is kept, and Enter waits until the minute is up, which the lock tracks
    itself.
  - Unavailable: "can't be checked right now".
- **Motion:** the UI fades and rises in over 320 ms, and a wrong password shakes the field. Reduce
  motion turns both off.
- **Light and dark:**
  - Dark theme: the backdrop keeps half the wallpaper's light.
  - Light theme: the backdrop is lightened instead, so the dark text reads.
  - Either way the wallpaper is box-blurred heavily and pulled toward grey.
- **Several outputs:** the UI is on the output under the pointer, else the primary (among outputs
  that can show a frame). Other outputs are black.
- **Idle:** an untouched lock screen goes dark after 60 s (`LOCKED_SCREEN_OFF_MS`). While locked,
  idle inhibitors don't count, since nothing a client shows is visible.
- **Greeter:** the lock is offered only when a lock environment is set (the desktop session).
  Super+L does nothing in the pre-login compositor.

## Triggers

| Trigger                                              | Path                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Super+L                                              | `routeKey` in core, before the shell                                          |
| Quick Settings › Power › Lock                        | `createShell(…, onLock)` → `server.lockSession("request")`                    |
| Idle: "Lock after" screen off                        | `IdlePolicy` → `PowerSession({ lock })` → `server.lockSession("idle")`        |
| Suspend with "Lock on suspend"                       | `PrepareForSleep(true)` → lock → inhibitor released after the locked frame    |
| `loginctl lock-session` / `unlock-session`           | logind `Lock`/`Unlock` → `lockSession("logind")` / `unlockSession("logind")`  |
| D-Bus `org.moire.Lock1.Lock()` on `/org/moire/Lock1` | Resolves true once a locked frame is shown; `GetLocked()`, `LockedChanged(b)` |

Every lock and unlock calls `PowerSession.setLocked()`, which updates the idle policy, the
`Idle1` status (`locked`, `capabilities.lock: true`) and logind's `SetLockedHint`. There is no
D-Bus Unlock.

## Code

- `packages/core/src/session-lock.ts`: the pure state machine (lock, password buffer,
  authentication round trip, presented-frame tracking).
- `packages/core/src/lock-screen-paint.ts`: the obscured backdrop and the fallback prompt.
- `packages/core/src/server.ts`: `lockSession`, `unlockSession`, `setLockEnvironment`,
  `lockScreenView`, `compositeLocked`, seat handling (`enterLockedSeat`/`leaveLockedSeat`,
  `lockKey`, `lockPointer`) and the `ClientSession` gates.
- `packages/sys/src/keyboard-state.ts`: `keyText` (`xkb_state_key_get_utf8` into a caller buffer).
- `packages/system-management/src/password-check.ts` (moved from the management service, which
  now imports it): `unix_chkpwd` checker (string or bytes), throttle with `retryAt()`.
- `packages/shell/src/lock/`: `LockScreen.tsx` (view), `lock-surface.tsx` (root, raster, pointer
  dispatch for the power menu), `types.ts`; the bridge methods `setLocked`, `lockRaster` and
  `onLockPointer` in `controller.tsx`; the Lock tile in `QuickSettingsDetails.tsx`.
- `apps/system/compositor/src/lock-session.ts`: user, authenticator, `org.moire.Lock1`. Wired in
  `main.ts`, with `PowerSession` gaining `unlock`, `setLocked` and `requestPowerAction`.
- `nix/moire-power-services.nix` asserts the `unix_chkpwd` wrapper. Checking your own password
  needs no polkit action.

## Verification

- `packages/core/src/session-lock.smoke.ts`:
  - Lock and unlock, editing (UTF-8 backspace, clear, control text), the capacity.
  - Wiping at submit and after the verdict.
  - Wrong, rate limited with the lockout timer, unavailable, a throwing or missing authenticator.
  - A stale "ok" from an earlier lock, and presented-frame epochs.
  - The password in no view or log line.
- `packages/core/src/lock-screen.smoke.ts`, on a portable `CompositorServer` with fake clients
  and a recording renderer:
  - Super+L, and keyboard and pointer leave.
  - The locked frame is flat, shows the lock UI and no client colour, and is byte-identical when
    clients redraw or a new window maps.
  - No key, pointer or focus event reaches any client while locked; no paste.
  - The fallback prompt on a throwing UI, still locked and still client-independent.
  - A wrong then right password, focus restored, the unlocking Enter swallowed.
  - `lockSession` resolves only after a locked composite; logind unlock; no Super+L without a
    lock environment.
- `packages/core/src/lock-screen-gpu.smoke.ts`: the same server driving the real
  `EglCompositorOutputRenderer` and `EglOutputScaler` methods over a fake GL:
  - After retained desktop frames, the flat locked frame is uploaded into allocated storage and
    is what each output pass samples (r55 showed black: the upload went to an unallocated texture).
  - The UI, or the compositor's prompt when the UI throws, on exactly one output; the other
    black; a missing wallpaper image still gives a backdrop; no client pixel.
  - Output choice with an absolute (tablet) pointer, off every output, and with no motion.
- `packages/sys/test/egl-flat-after-retained.native.smoke.ts` (Nix install phase; prints SKIP
  without a render node, set `MOIRE_RENDER_NODE` in a VM): the same order with real EGL pixels.
- `apps/system/compositor/src/lock-session.smoke.ts`:
  - `capabilities.lock` and the sleep delay inhibitor; the idle lock at screen off, with
    `LockedHint`.
  - On suspend, the inhibitor is released only after the locked frame, and re-held on wake.
  - logind Lock and Unlock; the power menu limited to allowed actions.
  - The throttle's retry time; a fake `unix_chkpwd` showing the password only on stdin
    (NUL-terminated), never in argv or the environment.
  - GECOS name; `org.moire.Lock1`.
- `packages/shell/src/lock/lock-screen.smoke.tsx`: renders at 1020×700 and 640×650, dark and
  light, scale 1 and 1.5, plus each state. Checks power menu dispatch by focusId. Set
  `MOIRE_LOCK_SCREEN_DIR` for PNGs.
- `packages/sys/test/keyboard-state.native.smoke.ts` (runs in the Nix install phase): server-side
  `keyText` with real libxkbcommon.
- Visreg scenes: `lock-screen`, `lock-screen-wrong`, `lock-screen-power`.

## VM test plan

1. **Super+L** with a terminal focused and text selected:
   - The screen shows only the lock, with no flash of the desktop. Check this with a 60 fps
     screen recording of the host window.
   - Typing produces dots only, and nothing reaches the terminal (check after unlock).
   - `wl-paste` from another client while locked returns nothing.
2. **Wrong password** five times:
   - Red field and shake (none with Reduce motion).
   - Then "Too many attempts". Enter is ignored until a minute passes.
   - The right password then unlocks, and the terminal regains focus with no stray Enter.
3. **Non-US layout** (add German in Settings): type a password containing `z`/`y` and `ü`. It
   unlocks with the layout indicator showing "DE", and the layout switch shortcut works on the
   lock.
4. **Caps Lock:** turn it on and the notice appears; turn it off and it goes.
5. **Quick Settings:** Power › Lock locks. Also check that Settings shows "Lock after" and "Lock
   on suspend".
6. **Idle:** set screen off to 1 min with lock "immediately". After the fade the screen is off;
   a keypress wakes it to the lock, never the desktop. `loginctl show-session $XDG_SESSION_ID -p LockedHint`
   reads `yes`.
7. **Suspend:**
   - Run `systemctl suspend` from a terminal. The display shows the lock on resume, with no
     desktop frame.
   - `journalctl -b | grep -i inhibit` shows Moire's delay lock released before sleep.
   - In UTM, suspend through the lock screen's power menu.
8. **logind:** from an ssh session as the same user, `loginctl lock-session <id>` locks and
   `loginctl unlock-session <id>` unlocks.
9. **D-Bus:** `busctl --user call org.moire.Display1 /org/moire/Lock1 org.moire.Lock1 Lock`
   returns `true` once locked. `GetLocked` agrees.
10. **Fail closed:** in a dev build, make the shell's `lockRaster` throw. The compositor's
    padlock prompt appears, typing shows dots, and the right password unlocks.
11. **Multi-output** (two virtio heads): the UI follows the pointer between outputs, and the other
    output is black.
12. **Notifications:** `notify-send` while locked. No banner shows on the lock, and after unlock
    the notification is in the tray.
13. **Missing helper:** bind-mount `/dev/null` over `/run/wrappers/bin/unix_chkpwd` in a test VM.
    The lock shows "can't be checked" and stays locked. Recover with `loginctl unlock-session`
    from another VT.

## Deferred

- **`ext_session_lock_manager_v1`:** third-party lockers (swaylock and similar). The lock state
  machine has a single provider seam (`lockRaster`/`onLockPointer` and `SessionLock`), and a
  client lock surface could replace the shell raster on each output. That needs the protocol in
  `@moire/protocol`, per-output lock surfaces with configure/ack sizing, the `locked` event sent
  only after a frame without client content, and the "dead locker stays locked" rule. Not done
  here.
- **Lock-screen notification privacy setting:** notifications are simply not shown while
  locked.
- **Avatar image:** the AccountsService `IconFile` is not read. The initial is drawn, as in the
  greeter.
- **Keyboard navigation of the power menu:** keys are reserved for the password, so the menu is
  pointer-only.
- **Unlock transition:** the desktop returns at once; there is no fade.
- **Fingerprint and other PAM modules:** only `unix_chkpwd`, so only local passwords.
