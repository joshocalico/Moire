# Daily-use integration plan

Build complete workflows on Moire's existing React widgets, Wayland compositor,
XWayland support and app suite. Existing LibreOffice integration remains a
compatibility baseline; C33 did not repeat its native acceptance. This plan
does not activate authentication, grant permissions or add credentials/services.
The [C36 review](quality-review.md#candidate-36-scrolling-and-native-keyboard-results)
records the current built image and its limits; C35, C34, C33 and all earlier images
remain preserved fallbacks.

Current priority: finish persistent data first, then real system status and
controls. Manual typing/input diagnostics are parked while Josh is away.
C44 now verifies clean cold-boot persistence through the installed Editor,
preferences and Notes APIs, plus retained manual `/etc/moire` configuration.
See [build/run commands](nixos-vm.md#keep-home-and-system-configuration-c44).
This does not qualify native typing, clipboard or physical tearing.

| Order | Ownership and useful outcome | Required evidence |
| --- | --- | --- |
| 1. Reliable daily session | Core owns native input routing; app tools own launch/save/close contracts; Files and app owners finish file → default app → edit/save/reopen. Trace C33's failed crop through the existing input owner before fixing it. | Native pointer and keyboard workflows, rapid typing and clipboard; canceled/failed saves preserve bytes; close retires resources. Existing crash/input ownership evidence stays separate from automatic recovery. |
| 2. System status and quick settings | D-Bus owns typed incoming signal subscriptions, owner changes, disconnects and cancellation. Shell owns one shared anchored panel surface. Reuse Settings display/volume controls; show actual network, sound/mute/device, supported brightness, battery, power and DND state. | Private-bus daemon loss/replacement and stale-reply fixtures, installed state changes and readback, keyboard navigation/focus restoration, compact/theme/scale placement. Suspend/resume must preserve the session, restore input/display/audio, and report denied or failed suspend requests; no success claim from merely calling a power method. Unsupported devices show unavailable states. Any privileged backend activation needs separate authorization. |
| 3. Notifications | One session service owns notification IDs, replacement, expiry and actions; shell/shared widgets own banners/history and DND presentation. Existing local Toast feedback remains app-local. | Real D-Bus client replacement/close/action tests, sender/service restart, bounded hints/images/history, honest advertised capabilities and keyboard actions. Archived items must not call a restarted sender. |
| 4. Persistent VM data | C44 preserves the immutable base and optionally mounts a separate ext4 disk for home and `/etc/moire`. No-data boot remains disposable RAM. Overlays/QMP remain separate. | Installed Editor/preferences/Notes exact readback across a clean power-off and cold boot passed as UID 1000; root-owned manual config survived and reached the restarted compositor. Native UI saves and sudden-power-loss durability remain unqualified. |
| 5. Login, logout and lock | Follow the existing [display-manager design](display-manager-design.md) using a synthetic broker first. Preserve splash → combined greeter/display manager → selected session boundaries. | Failed/canceled authentication never launches a desktop; logout retires descendants before greeter. Real PAM, broker, account, seat and service activation require separate authorization. A cosmetic overlay is not accepted as a lock. |
| 6. Desktop interoperability | Preserve existing Wayland/XWayland behavior; extend the native AppChooser/portal, MIME/Exec and Files implementations where interfaces are missing. Then removable volumes and advanced multioutput behavior. | Real client cancellation/path delivery, quoted filenames, LibreOffice regression, volume disappearance during transfer, and physical display unplug/scale/rollback. Controlled output fixtures do not establish physical hotplug. |
| 7. Background apps and accessibility | Add SNI watcher/host and remote menus as a later slice, separate from system quick settings. Reuse ContextMenu/focus widgets; add actual IME and assistive-technology adapters. | Real apps register/update/disappear/restart without ghost icons or stale actions; bounded remote menus, nested/disabled/toggle actions and keyboard focus. Real IME and screen-reader consumers are required. |

The initial source audit found that `SessionBus.receive` dropped incoming
signals and that notifications and system status lacked a service. The
[C34 installed milestone](desktop-services.md) now implements typed incoming
signals, observed audio/local addresses and a bounded notification service.
The rejected initial Quick Settings draft has been replaced in source against
inspected approved references. Notifications have a separate bell/tray; details
are alternate views of one popup. Revision-bound producer actions and captured
Clear all identities have actual private-bus checks. Five installed gates and
automatic HVF boot pass. Native DND On/Off, producer action, individual dismissal
and history were observed in C34. C35 fixes unchanged audio-poll revision churn;
its native 18-second quiet window stays at one revision with no Changed signals.
Native Clear All returns dismissed3/skipped0 while the original producer remains
alive, and fast single clicks switch DND On/Off with readback. C36 adds shared
opt-in reading keys and verifies native history Page Down/End/Home, body/Back
focus traversal and Clear All through real guest keys. Wheel records reach the
input owner. A [fresh C36 follow-up](c36-input-wheel-review.md) now verifies
absolute tablet movement with UTM capture released, followed by native history
wheel offsets 0 → 704 → 1041 → 0, visible text movement, fixed footer interiors
and the original notification producer alive throughout. Captured drag attempts
still produce no relative movement in the recorded production and exclusive-reader
cohorts; their upstream cause remains unassigned. The [native crop follow-up](c36-native-crop-review.md)
captured the primary display, but native path typing produced `6rn` and the
isolated drag was rejected as zero-area. The original image remained intact;
saved-pixel crop acceptance and clipboard remain pending. Delivered-event
TextField controls pass, so no additional crop or text-field fix is justified
by this evidence. Next, correlate bounded compositor-owned input with client
receipt for a private fixture, then repeat crop/save/reopen and rapid typing/
clipboard workflows. Qualify physical tearing separately. SNI remains unimplemented.
A preference switch or an XWayland notification role alone does not implement
the notification protocol.

Notifications use the [freedesktop specification](https://specifications.freedesktop.org/notification/latest-single/).
History, DND and visual placement are Moire policy. Background app support uses
the [draft SNI model](https://specifications.freedesktop.org/status-notifier-item/latest-single/)
and verified deployed KDE interfaces; remote menus use the separate
`com.canonical.dbusmenu` convention. Keep bus owner identity and lifecycle
explicit so delayed replies cannot mutate a replacement service's UI.

Each slice ends with production workflow checks and exact installed native
evidence. CPU and unqualified motion remain static; physical tearing and the
unimplemented EGL rounded-group resource lifecycle need their own graphics gates.
