# Desktop portals

Portals are how an app asks the desktop for something it should not do by itself: pick a file,
show a notification, learn whether the desktop is dark, keep the screen awake. Flatpak and Snap
apps have no other way; GTK, Qt, Electron and Firefox use them on the host too when they are
there.

Moire keeps `xdg-desktop-portal` as the public frontend (`org.freedesktop.portal.Desktop`) and
provides a backend for it: `apps/system/portal`, a TypeScript process that owns
`org.freedesktop.impl.portal.desktop.moire` on the session bus. The frontend handles sandbox
identity, permissions and the document portal; the backend supplies Moire's own windows and
services.

## What Moire implements

In the order they were built. "Frontend" means `xdg-desktop-portal` does it without a backend.

| Portal                                                   | Backend                  | Maps onto                                                           |
| -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| AppChooser                                               | Moire                    | The Open With picker and `mimeapps.list` defaults                   |
| Settings                                                 | Moire                    | Appearance in `~/.config/moire/settings.json`                       |
| OpenURI                                                  | Frontend                 | Moire's AppChooser and `mimeapps.list`; `org.moire.FileActivation1` |
| Notification                                             | Moire                    | Moire's notification server, banners and tray                       |
| Inhibit                                                  | Moire                    | The compositor's idle controller and logind                         |
| FileChooser                                              | Moire                    | Moire's file chooser                                                |
| Account, Email, Print, Lockdown, DynamicLauncher, Access | `xdg-desktop-portal-gtk` | GTK dialogs, until Moire has its own                                |
| Screenshot, ScreenCast, RemoteDesktop                    | none                     | See [Later](#later)                                                 |
| Secret                                                   | none                     | Planned in [secret-service.md](secret-service.md)                   |
| Background, Wallpaper                                    | none                     | See [Later](#later)                                                 |

"none" is deliberate. The GTK backend's versions of those call GNOME Shell or gsettings, which
do not exist here; an app is better told that the portal is unavailable than shown a dialog
that does nothing.

## Registration

Three files tell the frontend and the session bus about the backend.

`apps/system/portal/moire.portal` declares the backend and what it implements:

```ini
[portal]
DBusName=org.freedesktop.impl.portal.desktop.moire
Interfaces=org.freedesktop.impl.portal.AppChooser;org.freedesktop.impl.portal.Settings;…
UseIn=Moire
```

`apps/system/portal/moire-portals.conf` chooses a backend per interface. The frontend picks the
file from `XDG_CURRENT_DESKTOP=Moire` (lower-cased):

```ini
[preferred]
default=gtk;
org.freedesktop.impl.portal.AppChooser=moire;
org.freedesktop.impl.portal.Settings=moire;
org.freedesktop.impl.portal.Notification=moire;
org.freedesktop.impl.portal.Inhibit=moire;
org.freedesktop.impl.portal.FileChooser=moire;
org.freedesktop.impl.portal.Screenshot=none;
…
```

A D-Bus service file, `org.freedesktop.impl.portal.desktop.moire.service`, lets the session bus
start the backend on first use. Nothing starts it at login.

Where the files come from:

- **Development session** (`apps/system/session/moire-session`): installed into
  `$XDG_DATA_HOME` at session start, with `Exec` pointing at the source tree's `moire-portal`.
- **Nix package** (`nix/moire.nix`): `bin/moire-portal` (a wrapper that sets
  `MOIRE_UI_PLATFORM` and the FFI library path, because a bus-activated process does not inherit
  the compositor's environment), `share/xdg-desktop-portal/portals/moire.portal`,
  `share/xdg-desktop-portal/moire-portals.conf` and the service file under
  `share/dbus-1/services`.
- **Native session** (`nix/moire-native-desktop.nix`): puts the package's `share` first on
  `XDG_DATA_DIRS` before starting the session bus, which is where the bus looks for services.
- **Frontend** (`nix/moire-portal-services.nix`): enables `xdg.portal` with Moire's
  registration and `xdg-desktop-portal-gtk`, and writes the same choices as
  `/etc/xdg/xdg-desktop-portal/moire-portals.conf`. **This module is not imported by any image
  yet.** Add it to the native desktop image's module list to ship portals; until then the image
  has the backend but no frontend, so only Moire's own apps (through
  `org.moire.FileActivation1`) reach it.

## How each portal maps onto Moire

### AppChooser

`ChooseApplication` shows the Open With picker (`OpenWithPicker` from `@moire/ui`) for the
application ids the frontend offers; `UpdateChoices` replaces the list while it is open. "Always
use" writes `[Default Applications]` and `[Added Associations]` in `~/.config/mimeapps.list`.
See [freedesktop-mime-and-actions.md](freedesktop-mime-and-actions.md).

### Settings

`org.freedesktop.appearance`, read from `~/.config/moire/settings.json`:

| Key              | Type    | Value                                                           |
| ---------------- | ------- | --------------------------------------------------------------- |
| `color-scheme`   | `u`     | 1 (prefer dark) when `dark`, else 2 (prefer light)              |
| `accent-color`   | `(ddd)` | `accent` if the person chose one, else the theme style's accent |
| `contrast`       | `u`     | 0. Moire has no increased-contrast setting yet                  |
| `reduced-motion` | `u`     | 1 when `reducedMotion`, else 0                                  |

The backend watches the settings directory (Settings replaces the file by rename) and polls
every two seconds as a fallback, and emits `SettingChanged` for each key whose value changed.
The appearance schedule flips `dark` in the same file, so scheduled dark mode reaches portal
clients the same way. `ReadAll` honours the frontend's namespace patterns (exact, or a prefix
ending in `*`).

### OpenURI

There is no backend interface for OpenURI. The frontend resolves the handler itself from
`mimeapps.list` (the file Moire's default-app settings write), calls Moire's AppChooser when the
person should choose, and launches the result. It turns `OpenFile`'s descriptor into a path
before any backend sees it.

Moire's own apps get the same behaviour without the frontend, from `org.moire.FileActivation1`
on the backend's object:

| Method                                               | Does                                              |
| ---------------------------------------------------- | ------------------------------------------------- |
| `OpenWith(s path, o handle) → u`                     | The picker for one file                           |
| `OpenURI(o handle, s parent, s uri, a{sv}) → u`      | `file:`, `http(s):` and any registered scheme     |
| `OpenFile(o handle, s parent, h fd, a{sv}) → u`      | The file a descriptor refers to                   |
| `OpenDirectory(o handle, s parent, h fd, a{sv}) → u` | The folder holding that file, in the file manager |

The reply is a portal response: 0 opened, 1 cancelled, 2 failed. `ask` in the options forces
the picker. The rules, in `src/open-uri.ts`:

- **Files are never executed.** Whatever is opened is passed to an application as one
  single-quoted argument of its `Exec` line. Programs, installers, `.desktop` launchers and
  unrecognised files with the executable bit are refused (`…portal.Error.NotAllowed`). The check
  follows symbolic links, so a program behind `report.txt` is still a program.
- **Scripts need a choice.** A shell or Python script opens only in an application the person
  picks in the chooser, and that pick cannot become the default, so a script never gains an
  interpreter as its handler through this path.
- **Links** go to the default for `x-scheme-handler/<scheme>`. `javascript:`, `data:`,
  `vbscript:`, `blob:`, `about:`, remote `file://host/…` and anything with control characters or
  whitespace are refused. A scheme nobody handles fails without a dialog.
- **Descriptors:** the path comes from `/proc/self/fd`, the kernel's record of what was opened,
  and must still name the same inode. The caller never supplies the path.

### Notification

`AddNotification` becomes a `Notify` call on Moire's notification server
(`org.freedesktop.Notifications`, in the management service), so a portal notification follows
the same per-app rules, Do not disturb, banners and tray history as any other.

| Portal field                    | Becomes                                                |
| ------------------------------- | ------------------------------------------------------ |
| app id                          | `desktop-entry` hint (the rule key) and the app's name |
| `title`, `body` / `markup-body` | summary and body (the server strips markup)            |
| `priority`                      | urgency: low 0, normal and high 1, urgent 2            |
| `default-action`                | the `default` action                                   |
| `buttons` (up to 8)             | actions                                                |
| the same id again               | `replaces_id`, so the notification updates in place    |

When someone presses a button the server's `ActionInvoked` arrives here and is re-emitted as the
portal's `ActionInvoked(app_id, id, action, [target])`. `RemoveNotification` closes it.
`NotificationClosed` forgets it. Icons and sounds are not passed on: the server shows neither.
The notification tray itself is unchanged.

### Inhibit

The compositor owns idle handling and the session's logind connection, so the backend forwards
to it. `org.moire.Idle1` (on `org.moire.Display1`) gained:

| Method                                     | Does                                         |
| ------------------------------------------ | -------------------------------------------- |
| `Inhibit(s app_id, u flags, s reason) → u` | Take an inhibitor; returns a cookie          |
| `Uninhibit(u cookie)`                      | Release it; only the caller that took it can |
| `ListInhibitors() → a(sus)`                | Everything held, for the shell               |

| Portal flag   | Effect                                                                             |
| ------------- | ---------------------------------------------------------------------------------- |
| 8 idle        | A display inhibitor: no dim, screen off, idle lock or idle suspend                 |
| 4 suspend     | No idle suspend. Also no lid-close suspend, only for an app the user allowed there |
| 1 logout      | Recorded; listed by `ListInhibitors`                                               |
| 2 user switch | Recorded; listed by `ListInhibitors`                                               |

An inhibitor lasts as long as its portal `Request` object. The app (through the frontend) calls
`Close` to let go, and the compositor drops everything a caller held when that caller leaves the
bus, so a crashed backend cannot keep a laptop awake. Reasons appear in Settings › Power
alongside the Wayland idle-inhibit ones.

`CreateMonitor` reports `screensaver-active` from the lock screen (`org.moire.Lock1`) and
`session-state` 1 (running). Moire's logout does not ask apps first, so the query-end states
are never sent.

**logind inhibitors are file descriptors.** `Manager.Inhibit` returns one end of a FIFO and the
inhibitor lasts until it is closed. `@moire/dbus` now negotiates descriptor passing when given a
transport, and `@moire/sys/dbus-fds` is that transport: `recvmsg`/`sendmsg` with `SCM_RIGHTS`
through koffi, the one native boundary involved. Descriptors arrive close-on-exec, so an
inhibitor never leaks into an app the compositor starts. This replaced the `systemd-inhibit`
child the compositor used for its lid, power-key and sleep-delay inhibitors.

One limit today: the shell's logout flow does not consult `ListInhibitors` yet.

### Sleep blocking

Decided 2026-10-11: nothing stops a lid close or a chosen Suspend by default. Asking to block
sleep stays an API, since long-running tools and coding agents use it, and what the request
achieves is the user's choice, per app, in Settings › Power.

**What a suspend inhibitor does.** An app takes one through the portal's `Inhibit` (flag 4) or
`org.moire.Idle1.Inhibit` directly. The request always succeeds.

| Event                                      | App not allowed (the default) | App allowed in Settings › Power        |
| ------------------------------------------ | ----------------------------- | -------------------------------------- |
| Idle suspend timer                         | Held off                      | Held off                               |
| Lid closes (lid action Suspend)            | Suspends                      | Stays awake until the app lets go      |
| Suspend chosen by the person               | Suspends                      | Suspends                               |
| Battery critical (UPower critical, action) | Suspends                      | Suspends, at once if the lid is closed |
| Lid action Shut down                       | Shuts down                    | Shuts down                             |

- **The person outranks the app.** Suspend from Quick Settings, the lock screen's power menu, the
  sleep key or the power button, and `systemctl suspend`, sleep without asking. There is no
  "Sleep anyway" prompt to answer: the simpler rule is that choosing Suspend means suspend.
- **When the block ends** (the app releases it or exits, the switch is turned off, or the
  battery turns critical) with the lid still closed, the held-off suspend happens then.
- **The lid hold locks.** A session held awake under a closed lid locks as the hold starts,
  when "Lock on suspend" is on, as the suspend would have locked it.
- **A critical battery** also drops every app's hold on the idle suspend timer.

**Where the decision is made.** In the compositor's power session (`power-session.ts`), not in
logind. The compositor already holds logind's `handle-lid-switch` inhibitor and acts on the lid
itself, and the idle suspend is its own timer, so honouring an allowed app is a branch in code it
already runs. No block-mode logind `sleep` inhibitor is taken for an app, by anyone:

- polkit cannot grant `org.freedesktop.login1.inhibit-block-sleep` to the compositor alone. A
  rule sees the subject's user, session, seat and pid, and nothing that tells the compositor from
  any other process of that user in that session. Granting the action would hand every app a
  veto, so `nix/moire-power.rules` still leaves it out, and a block-mode `systemd-inhibit` for
  `sleep` is refused.
- A logind block would also stop the suspends the person chooses, which is the opposite of the
  rule above.

**Who is asking.** The allowlist keys on an identity the app does not choose
(`apps/system/compositor/src/sleep-blockers.ts`). The name passed to `Inhibit` is shown for an
app that cannot be identified and is never matched against a grant.

| Identity         | How it is derived                                                             |
| ---------------- | ----------------------------------------------------------------------------- |
| `launch:<argv0>` | The caller is, or descends from, a process the compositor started (see below) |
| `portal:<appid>` | The caller owns the portal backend's bus name; the app id is the frontend's   |
| `exe:<path>`     | Any other caller (a user service, a daemonised tool): `/proc/<pid>/exe`       |
| none             | No launch, no readable executable, or a portal request with no app id         |

The caller's pid is the bus daemon's (`GetConnectionUnixProcessID`, read from the socket's peer
credentials). The compositor walks up from it through `/proc/<pid>/stat` until it reaches a pid
in its own launch records, and the identity is the command it ran for that launch.

- **A grant follows the launch.** A tool run in a terminal is the terminal's launch, so allowing
  Terminal allows what runs inside it. This is the "responsible process" rule macOS uses for its
  privacy permissions.
- **Portal requests.** The backend gets no pid from the frontend, only the app id the frontend
  derived: Flatpak and Snap metadata (which the app cannot forge), or the caller's systemd scope.
  Moire does not start apps in scopes yet, so a host app that goes through the portal usually
  arrives with no app id and cannot be allowed. Host tools should call `Idle1.Inhibit`.
- **Unidentified apps** are listed in Settings with a switch that cannot be turned on.
- **X11 apps** are one trust zone. Any X11 client can send input to any other, so an allowed X11
  app's request can be triggered by its neighbours. Settings marks such a row "Runs under X11"
  and says what that means. The mark is a label from kernel pids only (Xwayland is running and
  nothing in the app's process tree has a Wayland connection), so a launched process with no
  window at all is marked too.

**What the person sees.**

- **Settings › Power, "Apps that can keep this computer awake".** Every app that has asked this
  session, and every app already allowed, with a switch; all off by default. A row says "Asking
  now, but closing the lid still sleeps", "Keeping this computer awake now" and so on. Grants
  are stored in `settings.json` under `power.sleepBlockers`, as `{ id, name, x11 }`.
- **After the lid opens**, a notification names the apps that kept the computer awake and for
  how long, with a pointer to the setting.
- **`org.moire.Idle1` status** carries `sleepBlocking`: the requests (identity, name, allowed,
  holding) and `lidHeld`. The panel does not show a live "kept awake" mark yet (see Later).

**Limits.**

- **The allowlist binds apps that play by the rules and apps in a sandbox.** `settings.json` is
  the user's own file, so a process running as the user outside a sandbox can add itself to it,
  as it can change any other preference. It could equally start its own scope under a chosen
  name or take the portal backend's bus name before the backend starts. A Flatpak app can do
  none of these. Closing the gap needs a store that only a confirmed change can write (the
  management service behind the secure prompt); that is a follow-up.
- **Interpreters.** `exe:` names the interpreter for a script, so allowing `/usr/bin/python3`
  allows every Python program not started from the launcher. Launch identities do not have this
  problem.
- **pid reuse.** The pid is read from the bus daemon and then looked up in `/proc`; a caller
  that exits in between could be mistaken for a process that reused its pid. The window is a few
  milliseconds and the caller must still be on the bus to keep the inhibitor.
- **Heat.** An allowed app can keep a closed laptop running in a bag. The screen goes off on its
  usual timer, not at once.

### FileChooser

`OpenFile`, `SaveFile` and `SaveFiles` show Moire's file chooser (`FileChooser` from
`@moire/app-tools`, built from `@moire/ui` widgets) in a window of the backend.

| Request                        | Chooser                                               |
| ------------------------------ | ----------------------------------------------------- |
| `multiple`                     | Several files may be picked                           |
| `directory`                    | Folder mode                                           |
| `filters`                      | The extensions any offered filter admits (see below)  |
| `current_folder`               | Starting folder, if absolute                          |
| `current_name`, `current_file` | The suggested name and folder when saving             |
| `SaveFiles` `files`            | Folder mode; each name is placed in the chosen folder |
| app id                         | Keeps each app's last folder and recent files apart   |

- **Filters:** globs like `*.png` and `*.[pP][nN][gG]` and MIME types (through
  shared-mime-info's globs) become extensions. The chooser has no filter menu, so it shows the
  union of all offered filters; if any filter cannot be reduced to extensions (`*`, an unknown
  MIME type) it shows every file. The result's `current_filter` is the filter the chosen file
  matches.
- **Names are confined.** `current_name` and `SaveFiles` names lose any directory part, so a
  request cannot steer a save outside the folder the person picked. Saving over an existing file
  asks first.
- **Choices** (the extra combo boxes some apps add) are not shown; each reports the value the
  app proposed.
- **Parent window:** the frontend passes `wayland:<xdg-foreign handle>` or `x11:<xid>`. Moire's
  compositor does not implement xdg-foreign yet, so the dialog is an ordinary top-level window,
  not attached to the caller's. `modal` has no effect for the same reason.
- **One dialog at a time.** A second request while a chooser is open gets response 2.

## Security

**Who may call.** The backend interfaces take the calling app's id as an argument, and that
argument is only trustworthy from the frontend, which derives it from the caller's D-Bus
credentials (its cgroup, or Flatpak/Snap metadata). So every `org.freedesktop.impl.portal.*`
method answers the current owner of `org.freedesktop.portal.Desktop` and returns `AccessDenied`
to anyone else. Sandboxed apps cannot reach the backend's bus name at all (their D-Bus proxy
only lets them talk to the frontend); the check also stops a host process from sending a
notification or taking an inhibitor under another app's name. With no frontend running, the
backend interfaces answer nobody.

**App identity comes from the sender, never from the message.** `org.moire.FileActivation1`
is open to any process in the session and takes no app id. Nothing it does depends on who the
caller claims to be. The compositor's `Idle1.Inhibit` records the caller's unique bus name and
ties the inhibitor's lifetime to it, and for a suspend inhibitor it derives who the caller is
from its process ("Sleep blocking" above); the app id argument is trusted only from the owner of
the portal backend's name.

**The Request handle.** Each dialog or inhibitor is represented by an object the frontend names.
The backend exports it only under `/org/freedesktop/portal/desktop/request/` (a handle that
would shadow another object is `InvalidArgs`), and only the connection that made the request can
`Close` it. Session handles (Inhibit's monitor) follow the same rule under `…/session/`.

**Sandboxed and host apps.** A sandboxed app reaches only the frontend, which enforces
permissions and hands files over through the document portal; the backend never widens that. A
host app already runs as the user with the user's files, so portals protect it from nothing, but
it gets the same dialogs and the same refusal to execute files.

**X11 apps.** Every X11 client shares one rootless Xwayland and can read its siblings' windows,
input and properties there. Two consequences:

- Portal dialogs (file chooser, app chooser) are Wayland windows of the backend, placed by the
  compositor. An X app can neither read what is typed or picked in one nor send it input.
- An X client is identified by its D-Bus credentials like any other caller. Nothing trusts an X
  window property (`WM_CLASS`, `_NET_WM_PID`), and the `x11:<xid>` parent handle is treated as a
  placement hint that proves nothing about who is calling.

**Untrusted input.** Options are read only when they have the expected D-Bus type. Text is
length-limited and stripped of control characters before it is shown or forwarded. Paths from
byte strings must be absolute. Per-caller and total limits bound inhibitors (64 and 256),
tracked notifications (256) and monitors (64).

**Descriptors.** Received descriptors are close-on-exec, and are closed when the handler returns
unless it kept them. `OpenFile` never keeps one.

## Test plan

Smokes run from the repo root with
`node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs <file>`. The portal
smokes start the backend on a private `dbus-daemon` with a scratch home and a connection that
owns the frontend's name (`apps/system/portal/src/testing.ts`).

| Smoke                                                | Covers                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `apps/system/portal/src/smoke.ts`                    | AppChooser, native Open With, caller and handle checks                             |
| `apps/system/portal/src/settings.smoke.ts`           | Values, namespaces, live `SettingChanged`                                          |
| `apps/system/portal/src/open-uri.smoke.ts`           | Links, files, folders, refusals, shell-hostile URIs, scripts; descriptors on Linux |
| `apps/system/portal/src/notification.smoke.ts`       | Translation, replace, actions with targets, removal                                |
| `apps/system/portal/src/inhibit.smoke.ts`            | Request lifetime, flags, the monitor, the app id and sender a suspend inhibit has  |
| `apps/system/portal/src/file-chooser.smoke.ts`       | Options and results for all three methods, request lifecycle                       |
| `apps/system/compositor/src/power-session.smoke.ts`  | `Idle1.Inhibit`, the idle policy, the sleep-blocking allowlist, logind `Inhibit`   |
| `apps/system/compositor/src/sleep-blockers.smoke.ts` | Launch records, the process-tree walk, the X11 label, caller identities            |
| `apps/core/settings/src/power.smoke.tsx`             | The "keep awake" list: rows, switches, stored grants, unidentified and X11 apps    |
| `packages/sys/test/dbus-fds.native.smoke.ts`         | Descriptor passing through a real dbus-daemon (Linux)                              |

Needs a VM, with `nix/moire-portal-services.nix` imported:

1. `busctl --user introspect org.freedesktop.portal.Desktop /org/freedesktop/portal/desktop`
   lists Settings, Notification, Inhibit, FileChooser and OpenURI; the journal shows the
   frontend choosing `moire` for each and `gtk` for the rest.
2. Settings: a GTK4 or libadwaita app follows Dark mode and the accent as they change in
   Settings, with no restart.
3. FileChooser: `GDK_DEBUG=portals` in a GTK app, or Firefox with
   `widget.use-xdg-desktop-portal.file-picker=1`. Open one file, open several, save over an
   existing file, pick a folder. Check the window is focused, sized sensibly and closes with the
   app.
4. Notification: `gdbus call` to the portal's `AddNotification` with a button; press it in the
   banner and in the tray; check Do not disturb and a per-app "off" rule apply.
5. Inhibit: play a video in Firefox; Settings › Power lists it; the screen does not dim; it dims
   again after pausing. Kill the backend while inhibited and check the inhibitor goes.
6. OpenURI: click a link in a GTK app and in a Flatpak app; `xdg-open` a PDF with
   `xdg.portal.xdgOpenUsePortal`.
7. logind: `systemd-inhibit --list` shows Moire's handling and sleep-delay inhibitors (now taken
   over D-Bus), and they disappear when the session ends. It never shows a block-mode `sleep`
   inhibitor, and `systemd-inhibit --what=sleep --mode=block sleep 60` is refused.
8. Sleep blocking, on a laptop or a VM with a lid switch. In Terminal, run a script that calls
   `org.moire.Idle1.Inhibit("x", 4, "test")` on `org.moire.Display1` and stays connected (the
   inhibitor goes when its caller leaves the bus, so `gdbus call` alone is not enough):
   - Settings › Power lists Terminal, off; closing the lid suspends.
   - Turn it on; closing the lid no longer suspends, the session locks, and after opening the
     lid a notification says Terminal kept the computer awake.
   - With the lid held: end the script and the machine suspends; Suspend in Quick Settings
     suspends at once.
   - The same script started outside the launcher (a user service) is listed by its executable.
   - An X11 app (`xterm`) running it is listed with "Runs under X11".
   - A Flatpak app's portal request is listed under its app id.
9. The frontend's reading of each interface's `version` property: the backend reports
   AppChooser 2, FileChooser 3, Inhibit 3, Settings 1, Notification 1.
10. An X11 app (`xterm`, `xdotool`) cannot list, read or send keys to an open portal dialog.

## Later

- **Screenshot and ScreenCast** need PipeWire video: the compositor has to publish output and
  window frames as PipeWire streams, and the picker has to say what is shared. They come after
  PipeWire video. RemoteDesktop follows ScreenCast. They are how other apps will read the
  screen: the compositor's own `Display1.CaptureScreenshot` answers only the bundled Screenshot
  app ([screenshot.md](apps/screenshot.md#who-may-capture)) and is not to be widened for them.
- **Secret** is planned in [secret-service.md](secret-service.md).
- **Access** (the generic permission dialog other portals use for camera, location and so on),
  **Account** (name and avatar, from AccountsService) and **Background** (apps running without a
  window, and autostart) each need a Moire dialog and, for Background, compositor state about
  which apps have windows. Access and Account stay with the GTK backend meanwhile; Background is
  off.
- **Parent windows:** xdg-foreign in the compositor, so dialogs attach to the app that asked.
- **A filter menu** in the file chooser, and the portal's `choices`.
- **Contrast:** an increased-contrast setting, reported as `contrast` 1.
- **Logout inhibitors** in the shell's logout confirmation, and the monitor's query-end states.
- **Sleep blocking:** a "kept awake" mark on the panel's battery chip while an allowed app holds
  the computer awake (the state is already in `Idle1`'s `sleepBlocking`); a protected store for
  the allowlist, changed only through the secure prompt; starting apps in systemd scopes so the
  portal frontend can name host apps; turning the built-in screen off as a lid hold starts.
- **Notification** icons, and v2's descriptor-passed images and sounds.
