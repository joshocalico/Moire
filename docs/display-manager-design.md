# Display manager and authenticated session design

Status: architecture proposal with a device-free C55 source fixture, reviewed against current source on 2026-10-04. No production display-manager service, entered-credential authentication, account/PAM change, device permission or session activation is implemented. Existing immutable checkpoints remain preserved.

## Required behavior and current status

The requested startup has three top-level logical applications:

1. The Moire React splash presents boot status and releases its graphics ownership.
2. The combined Moire React greeter and display manager selects an account and an installed desktop session, authenticates, and owns the transition into that session.
3. The selected user's session runs Moire or another installed desktop environment. Moire uses its own React shell and applications. Another desktop runs its normal session, rather than being embedded inside the greeter or the Moire compositor.

Authentication and account authorization must succeed before the selected user's login session is opened or its desktop is launched. A pre-login greeter has its own separate identity and lifetime. An authentication transaction is not a running user desktop, even if an upstream protocol calls that transaction a "session". Logout and failed launch return to the greeter only after the previous session has released its resources. These are requirements, not claims about the existing welcome screen.

The existing welcome is an in-session prototype and does not satisfy this requirement. The inspected implementation is explicit about that limitation:

| Current source                                                                                                                                                                                  | Actual behavior                                                                                                                                                  | Required change                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [VM service configuration](../nix/moire-vm.nix)                                                                                                                                                 | `moire-session.service` has a fixed `User=moire`, home, runtime directory and `PAMName=moire-session`. The service starts before the welcome.                    | Replace the automatic fixed-user entry with a separately approved pre-login manager and broker-controlled user session. Keep recovery configuration separate. |
| [Session wrapper](../apps/system/session/moire-session)                                                                                                                                         | Starts a session bus, System Management and the compositor; waits for sockets; then runs the welcome. Closing or failing the welcome continues into the desktop. | Make this an authenticated Moire session entry, with no login facade or fail-open welcome continuation.                                                       |
| [Greeter entry](../apps/system/greeter/src/main.tsx) and [controller](../apps/system/greeter/src/controller.ts)                                                                                 | Displays the current process user's name. `SessionContinuation` invokes an already authorized continuation, with no authentication or session selection.         | Retain reusable React presentation; replace continuation semantics with a broker-driven authentication and launch state machine.                              |
| [Compositor entry](../apps/system/compositor/src/main.ts)                                                                                                                                       | `MOIRE_GREETER=1` delays attaching the desktop shell. The user's compositor is already running; its D-Bus failure path attaches the shell anyway.                | Introduce a separate greeter-only compositor lifecycle. A pre-login failure must never attach a user desktop.                                                 |
| [Boot coordinator](../apps/system/boot/src/initial-startup.ts), [desktop admission](../apps/system/boot/src/desktop-admission.ts) and [console latch](../apps/system/boot/src/console-latch.ts) | Serialize splash start/stop, authenticate ownership evidence, preserve console intent and gate graphical startup.                                                | Preserve those checks and extend their protected handoff to the greeter stage. Do not turn successful boot cleanup into login authorization.                  |

The existing PAM session hook is not an interactive authentication implementation. There is no implemented account/session chooser or complete logout-to-greeter lifecycle in these entry points. This inspection made no account, credential or device queries.

## Specifications and conventions

There is no single display-manager API established by the references below that covers all of authentication, session discovery, display ownership and logout. Use the relevant formal formats and platform contracts, and name implementation conventions accurately.

| Reference                                                                                                                                                                                                                                                                                                                       | Scope used here                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Freedesktop [Desktop Entry basic format](https://specifications.freedesktop.org/desktop-entry/latest/basic-format.html), [recognized keys](https://specifications.freedesktop.org/desktop-entry/latest/recognized-keys.html), and [Exec rules](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html) | Formal file syntax, localized names, executable availability and argument/field-code rules. They do not define a complete login manager.                                                                                                   |
| Freedesktop [XDG Base Directory specification](https://specifications.freedesktop.org/basedir/latest/)                                                                                                                                                                                                                          | Runtime-directory ownership and lifetime. A home-directory substitute is unsuitable for claiming an established login runtime.                                                                                                             |
| Freedesktop [Desktop Application Autostart specification](https://specifications.freedesktop.org/autostart/latest/)                                                                                                                                                                                                             | Application startup after login. It is not authentication or a session-descriptor discovery specification.                                                                                                                                 |
| systemd [login1 interface](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.login1.xml) and [pam_systemd](https://raw.githubusercontent.com/systemd/systemd/main/man/pam_systemd.xml)                                                                                                                 | Linux session registration, runtime resources and managed seat/device ownership. These are systemd platform contracts, not a cross-platform DM protocol.                                                                                   |
| [Linux-PAM application guide](https://raw.githubusercontent.com/linux-pam/linux-pam/master/doc/adg/Linux-PAM_ADG.xml)                                                                                                                                                                                                           | Authentication, account checks, conversations, credentials and session open/close. Local PAM policy chooses the authentication mechanism.                                                                                                  |
| [SDDM session directories](https://raw.githubusercontent.com/sddm/sddm/develop/data/man/sddm.conf.rst.in) and [GNOME custom sessions](https://help.gnome.org/system-admin-guide/session-custom.html)                                                                                                                            | Established desktop-session installation conventions. SDDM separates `wayland-sessions` from `xsessions`; GNOME also documents its session configuration and an X11 session directory. These conventions require distribution integration. |
| [greetd operation](https://raw.githubusercontent.com/kennylevinsen/greetd/master/man/greetd-1.scd) and [IPC](https://raw.githubusercontent.com/kennylevinsen/greetd/master/man/greetd-ipc-7.scd)                                                                                                                                | An existing broker/greeter boundary, authentication conversation and return-to-greeter model. This protocol is specific to greetd.                                                                                                         |
| [LightDM overview](https://raw.githubusercontent.com/canonical/lightdm/main/README.md) and [DisplayManager interface](https://raw.githubusercontent.com/canonical/lightdm/main/src/display-manager.xml)                                                                                                                         | Another established separation of greeter, authentication and session launch. Its `org.freedesktop.DisplayManager` interface name is not evidence that all DMs implement a universal authentication protocol.                              |

The upstream systemd manual sources are linked because the rendered freedesktop manual pages were unavailable during this review. The greetd sources are from the author's official GitHub mirror. Implementation must pin and inspect the actual packaged versions; current upstream documentation does not prove what a future ISO contains.

## Recommended process and privilege boundary

The three logical applications need not be exactly three processes. A compositor, authentication worker and lifecycle supervisor are internal infrastructure. They must have explicit owners.

| Choice                                                                          | Consequence                                                                                                                                                                                        | Decision                                                                                                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moire React greeter with an established login broker, initially evaluate greetd | Keeps PAM/session setup in an existing daemon and gives the React app a bounded authentication protocol. Requires a greeter compositor, trusted session launcher and verified cleanup integration. | Preferred design to prototype without activating system services. Backend adoption still needs approval.                                           |
| Moire React greeter with a new native PAM/session broker                        | Gives exact launch and ownership semantics, but Moire would own privileged authentication, credential setup, cancellation and PAM teardown.                                                        | Consider only if an established backend cannot meet the lifecycle contract. Do not put these responsibilities in the React renderer or compositor. |
| Treat the current welcome as a DM or use an existing DM's theme alone           | The current welcome authenticates nothing; a theme alone does not supply the requested own React login UI and lifecycle.                                                                           | Does not meet the requirement.                                                                                                                     |

The recommended logical greeter/DM consists of an unprivileged React client, a small controller and an established privileged broker. The broker owns authentication, account authorization and user-session creation. The controller owns session choice and presents broker events. It cannot assert authentication success locally. The compositor owns painting and input; it cannot grant login access.

The future greeter compositor reuses `CompositorServer` and the public `Application`/`Window` toolkit, but has a separate entry point. It launches only the greeter under a dedicated greeter identity. It must not start the user shell, Terminal, Files, user System Management, user portals, user preferences, Xwayland or the current session wrapper as a shortcut to display login UI. Closing that UI is a greeter failure, never permission to attach a desktop. Greeter identity, seat access and service changes remain outside the approved implementation scope of this document.

Moire currently opens DRM devices directly and attempts `drmSetMaster` in [KMS setup](../packages/sys/src/kms.ts). A comment mentioning logind does not implement its device lifecycle. The future seat adapter must handle authoritative acquisition, pause/resume, descriptor replacement and release, with one owner per active display stage. login1 documents exclusive session control and managed device descriptors, including asynchronous revocation. The React UI must not receive general device access merely to support login. Direct login1 `CreateSession`/`ReleaseSession` calls are inappropriate here; upstream assigns session registration to PAM/pam_systemd. [login1 contract](https://raw.githubusercontent.com/systemd/systemd/main/man/org.freedesktop.login1.xml)

### Broker conversation and secrets

Use broker-provided prompt variants: visible input, secret input, information and error. Support repeated prompts and cancellation. The UI must not assume one username/password exchange or infer authentication from a successful socket connection. greetd exposes these variants and only allows starting a successfully authenticated transaction. [greetd IPC](https://raw.githubusercontent.com/kennylevinsen/greetd/master/man/greetd-ipc-7.scd)

PAM authentication success alone is insufficient. Account authorization, credential establishment and session setup are separate operations. The broker owns their ordering, error handling and balanced teardown; authentication/account failure must never launch the selected user desktop. [Linux-PAM application guide](https://raw.githubusercontent.com/linux-pam/linux-pam/master/doc/adg/Linux-PAM_ADG.xml)

Secret responses are ephemeral input, not part of the ordinary serialized UI state. Never write them to preferences, diagnostics, receipts, logs, screenshots, clipboard or command/environment arguments. Clear input on cancellation, failure, account change and handoff. A JavaScript string cannot provide a strong memory-zeroization guarantee; the design must disclose that limitation rather than claim secure erasure. Minimize copies and let the native broker own the authoritative transaction. Tests use synthetic prompts and disposable fixtures, never real credential values.

Accounts come from an approved account-information adapter with public identity fields. The broker resolves and authorizes the account independently, including any canonical username returned by PAM. The UI does not read password databases or accept a client-supplied UID as authorization. Manual account entry can be offered without exposing every system account. Account enumeration policy and password-change support need explicit decisions before activation.

## Installed session catalog and launch

Introduce a dedicated session catalog instead of reusing application discovery unchanged. [Application discovery](../packages/app-discovery/src/applications.ts) searches `applications`, includes the user's XDG data directory and filters for the current desktop. [Its parser](../packages/app-discovery/src/desktop.ts) strips field codes for bare launch. [MIME activation](../packages/app-discovery/src/mime.ts) builds a quoted command string; [desktop spawning](../packages/core/src/spawn.ts) subsequently tokenizes without a shell. These are existing application contracts, not a validated pre-login session catalog.

The proposed catalog reads only configured administrator/package session roots. Include installed Nix profile roots as appropriate, with conventional `share/wayland-sessions` and `share/xsessions` directories and explicitly supported distribution alternatives. Do not use an unauthenticated account's writable `XDG_DATA_HOME` as the pre-login executable catalog. SDDM's documented defaults and GNOME's documented custom-session path demonstrate that directory policy is implementation-specific. [SDDM](https://raw.githubusercontent.com/sddm/sddm/develop/data/man/sddm.conf.rst.in), [GNOME](https://help.gnome.org/system-admin-guide/session-custom.html)

Each catalog record contains an opaque selection ID, protocol kind, localized label, descriptor provenance, validated executable/argv and availability reason. Keep protocol kind in identity so X11 and Wayland entries with the same filename cannot collide. Resolve duplicates with documented configured-root precedence. Validate canonical paths and trusted ownership while supporting immutable Nix store/profile symlinks; a blanket symlink ban would break legitimate package layouts. The privileged side independently resolves the selection ID against its catalog, not a pathname or command supplied by the UI. Bind authorization/launch to the catalog generation and reject changed or removed entries.

Parse UTF-8 groups and escaping, and reject ambiguous duplicate groups/keys. Require `Type=Application`, a usable localized `Name` and `Exec`. Initially exclude `Hidden=true` and `NoDisplay=true`; mark terminal-only or D-Bus-only launch entries unavailable. Retain extension fields without treating them as executable policy. Desktop identity extensions require a documented distribution/backend policy. Do not apply an application-menu `OnlyShowIn=Moire` filter that removes another desktop's login session. Show an honest unavailable reason for discovered entries whose launch requirements are unsupported. [Basic format](https://specifications.freedesktop.org/desktop-entry/latest/basic-format.html), [recognized keys](https://specifications.freedesktop.org/desktop-entry/latest/recognized-keys.html)

Decode `Exec` into argv using its desktop-entry quoting and escape rules. Expand supported field codes once: no file/URL arguments at login; `%c` is one label argument, `%k` is descriptor location, `%i` is a standalone icon expansion, and `%%` is literal percent. Reject unknown codes and undefined quoted-code combinations. Resolve executables against a controlled session PATH; validate `TryExec` availability. Never use `eval`, `bash -c` or shell expansion on descriptor text. Installed executable wrappers may be scripts; that does not justify treating the descriptor itself as shell code. [Exec rules](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)

There is a concrete greetd adapter constraint. Its documented request carries `cmd: string[]`, but the inspected [worker implementation](https://raw.githubusercontent.com/kennylevinsen/greetd/master/greetd/src/session/worker.rs) joins that array and invokes `/bin/sh -c`. Therefore sending parsed descriptor argv directly does not establish no-eval launching. Pass a fixed trusted launcher executable and a restricted opaque catalog ID through that boundary. The launcher revalidates the descriptor and directly executes argv after the broker has established the target identity. No descriptor text or arbitrary account/session label enters the broker's command string. The packaged backend must be tested for this exact behavior; a future backend with direct argv execution may remove this adapter.

### Wayland, X11 and environment

For a Wayland session, the selected entry starts that desktop's own compositor after the greeter compositor has relinquished its seat. Moire's entry uses an authenticated-session runner, not the current welcome-first wrapper. Register an installed Moire session descriptor during the later packaging stage; do not invent a selectable installed session in the UI before it exists.

X11 requires a genuine X server/session adapter, including its display lifetime and authentication-file ownership. Current [Xwayland startup](../apps/system/compositor/src/main.ts) supports X11 applications inside a Moire Wayland session. It does not establish independent X11 desktop-login support. The present VM configuration disables the X server service and does not provision an alternate desktop selection flow. Discoverable X11 entries remain unavailable until their adapter and installed dependencies pass acceptance. Other Wayland desktops also remain unverified until actually installed and exercised.

Derive user identity, home, groups and runtime from authenticated broker/session results. PAM/pam_systemd establishes login resources and supplies session metadata. Distinguish greeter and user session class; the user's runtime may be shared with other sessions and must not be recursively deleted on logout. [pam_systemd](https://raw.githubusercontent.com/systemd/systemd/main/man/pam_systemd.xml), [XDG runtime rules](https://specifications.freedesktop.org/basedir/latest/)

Build an allowlisted launch environment for the selected protocol and desktop. Do not leak the greeter's display socket, broker socket, boot `NOTIFY_SOCKET`, internal renderer controls or privileged helper environment into the user session. Set desktop identity for the selected entry rather than forcing Moire on other desktops. Preserve each desktop's documented bus/user-manager and session-wrapper integration; do not wrap every desktop with Moire's private `dbus-run-session` or force its GTK/portal settings. Moire-specific app registration, themes and portal setup belong only to Moire's authenticated session. Application autostart runs after login and remains the selected session's responsibility. [Autostart specification](https://specifications.freedesktop.org/autostart/latest/)

## Ownership and lifecycle

The controller's proposed public operations are `listSessions`, `beginLogin(account, sessionId)`, `answerPrompt(attemptId, promptId, response)` and `cancelLogin(attemptId)`. Starting the session is a broker-authorized transition, not a separate arbitrary UI command. Model states as distinct variants:

```text
booting → release-check → greeter-ready
greeter-ready → authenticating(attempt, selection)
authenticating → prompt(attempt, prompt) → authenticating
authenticating → authorized(attempt, canonical-account, selection-generation)
authorized → retiring-greeter → starting-user-session
starting-user-session → running(session-identity)
running → stopping(session-identity) → release-check → greeter-ready
authentication failure/cancel → greeter-ready
launch failure → stopping → release-check → greeter-ready with error
unresolved ownership or protected console request → console
```

Attempts, prompts, catalog generations and running session identities are broker/controller-owned opaque values. An old asynchronous reply cannot authorize a new account choice, canceled attempt, changed session descriptor or later greeter generation. Duplicate start/cancel/stop events converge on one lifecycle. If the display goes away, suspend presentation without manufacturing authentication or launch success.

The system coordinator preserves the existing boot ledger, exact invocation/cgroup retirement proof and protected console latch. It starts the greeter only after splash release is proven, and checks console intent at each new graphical admission boundary. Successful cleanup is not permission to erase a fresh console request. Automatic retries and direct unit starts must obey the same admission policy.

The broker owns the authenticated user's session identity and its bounded cleanup. On logout, terminate only that session's owned workload, wait for compositor/display release and descendants, close the PAM session and retire session-specific sockets. Do not kill another session of the same UID or the entire user manager as a substitute for proving ownership. A clean compositor exit is insufficient if descendants still hold the seat. Track session leader identity, logind session/scope and supervisor generation; PID reuse alone must not identify ownership.

The greeter process and its compositor require a coupled shutdown contract. greetd waits for its greeter process to terminate before launching the user session and returns to its default greeter after the session ends. That ordering is useful, but it does not by itself prove Moire's compositor descendants and device descriptors are retired. Make the greeter session runner own both UI and compositor, and verify complete release before allowing the new display owner. [greetd operation](https://raw.githubusercontent.com/kennylevinsen/greetd/master/man/greetd-1.scd)

Authentication failure keeps the greeter available with a broker-supplied safe message and retry/cancel controls. Session-exec failure returns a launch error after cleanup; it must not fall back to a different user or desktop. Greeter crashes use bounded restart policy and eventually preserve the console. Unresolved PAM, cgroup or display release blocks further graphical launch and records nonsecret diagnostic identity. Lock/unlock and user switching are separate future flows; normal logout requires fresh authentication before starting another user session.

## Proposed module boundaries

These paths describe the intended ownership. C55 implements only the display-manager source fixture described below; production entries and native authorities remain future work.

| Module                                          | Responsibility                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/system/boot`                              | Existing splash, protected console disposition and verified boot release.                                                                              |
| `apps/system/greeter`                           | Own React account/session selection, broker conversation, focus/accessibility and safe error presentation. Retire `SessionContinuation` for login use. |
| `apps/system/display-manager`                   | Login controller, session catalog, fixed launcher and broker adapter. Keep privileged authority in the selected established/native backend.            |
| Greeter compositor entry using `packages/core`  | Restricted greeter presentation and seat lifecycle, no user shell/service bootstrap.                                                                   |
| `apps/system/session`                           | Authenticated Moire session entry, readiness, logout and owned cleanup. No authentication bypass or pre-login welcome.                                 |
| Native seat/session adapter                     | Platform device acquisition/revocation and supervisor identity, outside React rendering.                                                               |
| Nix integration owned by the system coordinator | Immutable descriptors, broker/service graph, PAM integration, greeter identity and explicit recovery policy. Changes require activation approval.      |

Keep pre-login preferences separate from an unauthenticated user's home. The greeter can use packaged theme defaults and an approved service-owned preference file. Persist only nonsecret selection/preferences under the chosen policy. Existing reduced-motion and static CPU/unknown rendering behavior must work before any animation qualification; login availability must not depend on accelerated graphics or animation.

## Staged implementation and acceptance

This document does not replace the root-owned acceptance plan. It records the architectural gates that plan must cover.

1. Implement a device-free session catalog and controller with synthetic broker conversations. Test argv parsing, malformed/duplicate descriptors, paths with spaces, literal metacharacters, unknown field codes, `TryExec`, duplicate protocol IDs, Nix profile paths and changed catalog generations. Run real subprocess argv oracles; compilation alone is not evidence of no-eval behavior.
2. Extract the restricted greeter compositor/session runner and render the own React chooser with disposable accounts/session metadata. Exercise Tab/Shift+Tab, visible focus, Enter/Space, cancellation, repeated prompts, resize and reduced motion through real public Windows. These remain fixture proofs, not authentication or native-seat completion.
3. Prototype the chosen broker adapter without enabling it at boot. Test authentication denial, account denial, cancellation, broker EOF, stale prompts, duplicate launch and exec failure with bounded real subprocess cleanup. Verify that failure creates no running selected-user session. Check the packaged backend's command/privilege/environment semantics.
4. Prepare reviewable service/PAM/identity/seat integration and rollback configuration. Obtain explicit approval before installs, PAM/account changes, device access changes, enabling the DM or replacing automatic startup. Preserve current immutable checkpoint evidence and console recovery. No such activation is authorized by this design-only task.
5. Under the root-owned native lease, prove splash release → actual pre-login greeter → successful authentication → selected Moire session, then logout → complete cleanup → greeter. Separately test failed authentication, failed session exec, greeter/compositor death and console escape. Record actual process UID, session class, scope/invocation identity, descriptor selection and cleanup results without secret responses.
6. Install and verify a separate supported Wayland desktop, and later an X11 desktop with its real X server adapter, in an explicitly approved test image. Select each through the same React UI and prove login/logout/return independently. Do not infer compatibility from seeing a `.desktop` file or from Xwayland app support.

A login screenshot, a PAM session hook, a successful socket connection or an in-session welcome click cannot satisfy DM acceptance. Completion requires authentication before selected-user session creation, actual selected-desktop startup, and a demonstrated return path after logout and failure.

## C55 device-free login/logout source fixture

`apps/system/display-manager` contains a private source package with no production
entry or dependencies added to the lockfile. It supports one explicitly configured
Wayland fixture descriptor. Every broker, controller and lifecycle authority must
be explicitly injected and qualified as a fixture. It never discovers
`GREETD_SOCK`, enumerates accounts, reads credentials, imports a production session
entry or opens graphics/input devices.

Run the complete source workflows from the repository root:

```sh
./scripts/test-login-lifecycle.sh
pnpm --filter @moire/display-manager typecheck
```

The runner exercises the configured catalog, direct-argv launcher, private Unix
socket protocol client, controller, owned-process lifecycle and complete vertical
flow. The vertical flow makes repeated visible, secret, information and error
prompts, schedules a fixed-launcher request, waits for complete greeter retirement,
then observes an independently launched fixture process. Logout waits for its
supervisor and owned descendant to close before creating a fresh greeter. A second
login must make a fresh broker authentication request. Changing a descriptor during
authentication cannot launch a stale selection.

Broker success authorizes requesting a launch. It does not establish a canonical
account UID, PAM session, native seat or running desktop. The scripted private
broker performs no credential verification. Only synthetic responses are used;
responses and broker-controlled text never enter published state or diagnostic
errors. JavaScript strings still provide no memory-zeroization guarantee.

The broker command contains only a configured executable launcher path, quoted for
upstream greetd's shell join, and a restricted generation-bound catalog ID. Descriptor
arguments, labels, account names and responses cannot enter that command or its
empty environment. The launcher independently reloads the configured descriptor
and generation, then uses direct argv with `shell: false`. Its environment comes
from an explicit narrow allowlist, never inherited `process.env`. Native runtime
registration, display sockets and service addresses require a future authority.
The real macOS oracle also observes its runtime-added `__CF_USER_TEXT_ENCODING`
key; a caller-supplied forged value is excluded. An empty supplied environment
does not imply that the operating system adds no variables in the child.

Catalog trust is limited to explicitly configured fixture-owned roots and the
current UID. Descriptor/executable ownership and modes, canonical paths and
ancestors below each configured anchor are checked. Descriptor bytes, file
identity and executable identity bind the generation. The supported Desktop Entry
subset accepts double-quoted argv, literal escapes and `%c`, `%k`, `%i`, `%%`; it
rejects file/URL fields, unknown keys/codes, duplicate sections/keys, hidden entries,
terminal/D-Bus launch modes and leaf symlinks. It is not an arbitrary installed
session catalog. Production root-owned descriptors and Nix profile compatibility
must be qualified separately. Filesystem checks cannot establish a privileged
atomic-open-to-exec guarantee.

Lifecycle release requires the exact owned identity and generation, nonce-bound
IPC descendant evidence, supervisor close and supplementary descendant liveness
checks. Parent exit alone is not release. Held or missing acknowledgements, late
launches, stale identities and unknown cleanup keep new admission blocked. The
fixture supervisor owns real harmless child handles; this proof does not establish
Linux logind scopes, cgroups or device release. Fresh console intent blocks graphical
admission and return to greeter.

The frozen source receipt and rerunnable verifier are under
[the C55 checkpoint](../vm/verification/2026-10-04-c55-login-lifecycle/README.md).
C54 source/evidence and the C50 fallback image are preserved. No image build or VM
lifecycle is part of this slice. Real authentication activation, authoritative seat
ownership, restricted greeter presentation and secure lock remain unimplemented.

## Explicit unsupported boundaries

Current production has no authenticated Moire display manager, arbitrary-account login, installed-DE chooser, independent X11 desktop launch or proven logout-to-greeter ownership cycle. The device-free broker client, controller, catalog and launcher have fixture implementations. Their production integration and the restricted greeter compositor remain unimplemented. Hardware motion qualification remains separate and unfinished; CPU, virtual and unknown execution stay static.

Initial implementation should support one local seat and one running selected-user desktop at a time. Remote login, autologin, guest sessions, fast user switching, multi-seat orchestration, lock-screen authentication, password reset and specialized authentication UI remain unavailable unless their backend contract and acceptance are added. A backend-required unsupported conversation must cancel or deny safely, rather than bypass authentication. These limits must be visible in product behavior and release claims.
