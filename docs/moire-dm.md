# moire-dm: Moire's login daemon

Status, 2026-10-11:

- **Design approved, with four changes:** a Moire login protocol instead of greetd's, an
  unprivileged front process that alone reads greeter bytes, automatic login limited to an admin's
  own account, and crash recovery over a live session. All four are built.
- **VM verified (r58-dm):** boot to the greeter under moire-dm, a wrong password denied
  (`auth-denied`), the right one opening a PAM session as uid 1000 and the desktop, and logout
  (`session-end`) back to a fresh greeter (`greeter-start`).
- **Default (Phase 4):** the native desktop image now uses moire-dm. greetd stays one flag away
  for rollback (`--dm greetd`).
- **Automatic login (Phase 5):** built end to end: Settings › Users & Login, the management
  service, `moire-dm-settings` and polkit `org.moire.dm.set-autologin`. Since
  [polkit-agent.md](polkit-agent.md) Phase 4 the authorization is polkit's own password prompt,
  not a Settings sheet. Needs a VM run (below).

moire-dm replaces greetd. It is written in TypeScript like the rest of Moire, with native calls
(libpam, libc, sd-login) going only through three audited koffi files in `@moire/sys`. One greeter
binary works with either backend: it picks its client from the socket variable its session was
started with.

## Why

- **Automatic login is baked into the image.** greetd reads `initial_session` from a configuration
  file that Nix generates into the read-only store, so Settings can't turn it on or off.
  AccountsService's `AutomaticLogin` only edits GDM's file.
- **greetd runs whatever the greeter asks for.** It joins `start_session.cmd` with spaces, runs it
  through a shell, and passes environment entries the greeter supplies.
- **There's nowhere to put Moire policy:** throttling, per-user default sessions, crash recovery
  that knows the boot handoff, and which accounts may log in at all.

## What exists

| Piece                                   | Where                                                                      |
| --------------------------------------- | -------------------------------------------------------------------------- |
| libpam binding (koffi)                  | `packages/sys/src/pam.ts` (`@moire/sys/pam`)                               |
| libc account, privilege drop, exec      | `packages/sys/src/privilege.ts` (`@moire/sys/privilege`)                   |
| logind session listing (sd-login)       | `packages/sys/src/login-sessions.ts` (`@moire/sys/login-sessions`)         |
| Moire login protocol v1                 | `apps/system/moire-dm/src/protocol.ts`                                     |
| Front (unprivileged, greeter-facing)    | `front.ts`, `front-entry.ts`, `front-channel.ts`                           |
| Seat state machine (pure)               | `state.ts`, `seat.ts`                                                      |
| Broker driver and entry (root)          | `daemon.ts`, `process-launcher.ts`, `main.ts`                              |
| PAM sequence (session worker, root)     | `conversation.ts`, `worker.ts`, `worker-entry.ts`, `worker-channel.ts`     |
| Exec helper (privilege drop and exec)   | `exec-entry.ts`                                                            |
| Configuration and automatic-login state | `config.ts`, `session-env.ts`                                              |
| Greeter clients                         | `display-manager/src/moire-dm-connection.ts`, `moire-dm-client.ts`         |
| `LoginBroker` over moire-dm             | `display-manager/src/moire-dm-broker.ts`                                   |
| Greeter's backend choice                | `apps/system/greeter/src/native/login-client.ts`, used by `pre-login.ts`   |
| Package (bundles, smokes in its build)  | `nix/moire-dm-package.nix`, flake output `moire-dm`                        |
| Backend flag, unit, PAM, accounts       | `nix/moire-dm.nix` (`moire.dm.backend`)                                    |
| Desktop image switch                    | `nix/moire-native-desktop-image.nix` (`dmBackend` argument)                |
| ISO build switch                        | `scripts/build-native-login-probe.py --desktop [--dm greetd]`              |
| Automatic-login file (read and write)   | `apps/system/moire-dm/src/autologin-file.ts`                               |
| Automatic-login writer (system bus)     | `login-manager.ts`, `settings-entry.ts` (`moire-dm-settings`)              |
| Polkit action, rule, bus policy         | `nix/moire-dm.policy`, `nix/moire-admin.rules`, `nix/moire-dm-dbus.conf`   |
| Session side                            | `apps/system/management-service/src/login-settings.ts`                     |
| Settings client and fake                | `packages/system-management/src/login-settings.ts`                         |
| Settings row                            | `apps/core/settings/src/pages/users.tsx` (Users & Login › Automatic login) |
| Test controls (test images only)        | `nix/moire-dm.nix` (`moire.dm.testControls`)                               |

## Architecture

```
greeter (uid greeter)        front (uid moire-dm-front,       broker (root)
 MOIRE_DM_SOCK ─────────────▶ no groups)                       state.ts ◀─ logind (sd-login)
 Moire protocol v1            /run/moire-dm-front/greeter.sock   │
                              SO_PEERCRED = greeter uid         │ spawn, fd 3
                              parse, re-encode typed ──fd 3───▶ │ (parses again)
                                                                ▼
                                       session worker ×N (root; one per attempt or session)
                                         libpam, blocking conversation on fd 3
                                         pam_systemd moves it into session-N.scope
                                                │ spawn, plan on fd 3
                                                ▼
                                       exec helper (root → user): setsid, TIOCSCTTY,
                                       initgroups, setresgid, setresuid, verify, execve ─▶ session
```

- **Front** (`front-entry.ts` → `front.ts`, uid `moire-dm-front`): the only moire-dm process that
  reads bytes from the greeter.
  - The broker spawns it with spawn's `uid`/`gid`, which also clears supplementary groups.
  - It owns the greeter socket and checks the peer with `SO_PEERCRED`.
  - It reassembles and strictly parses Moire protocol frames. It then hands the broker each
    request re-encoded from typed values, never the greeter's bytes.
  - It holds no policy. If the broker goes away, it exits.
- **Broker** (`main.ts` → `daemon.ts` → `state.ts`, root, one per seat): owns the seat's state
  machine, timers, worker processes and the logind check.
  - It parses each request from the front a second time with the same strict decoder. It never
    reads a greeter socket and never holds a PAM handle.
  - The only secrets it sees are answer bytes in transit.
- **Session worker** (`worker-entry.ts` → `worker.ts` → `conversation.ts`, root): one process per
  login attempt, greeter session and user session.
  - It runs the whole PAM transaction synchronously, blocking on fd 3 inside the conversation.
  - Once a session opens, it stays as that session's parent until it ends, then closes PAM. This
    is greetd's model.
- **Exec helper** (`exec-entry.ts`, root → user): turns into the session. It exists because Node
  can't `fork()` safely, and Node's own `spawn({ uid, gid })` clears supplementary groups (wheel,
  video, audio) and has no hook for `setsid`/`TIOCSCTTY`.
- **Greeter:** today's greeter. moire-dm starts it like any session (the `moire-dm-greeter` PAM
  service, class `greeter`, as the `greeter` account) with `MOIRE_DM_SOCK` set. Under greetd it
  gets `GREETD_SOCK`. `login-client.ts` picks the client from whichever is set (moire-dm's if
  both are), so the controller and UI are backend-agnostic.

### Why PAM runs in a worker process

PAM's conversation is a synchronous callback. `pam_authenticate()` waits inside it for an answer
that arrives asynchronously from the greeter. In one Node process those can't meet:

- **Synchronous koffi calls (the only safe kind):** the callback runs on the main thread while the
  event loop is blocked.
- **koffi's `.async()`:** marshals the callback back to that same loop.
- **`PAM_CONV_AGAIN`:** unsupported by `pam_unix`.

A dedicated process can simply block on fd 3. It can be killed outright on cancel or timeout, and
it is the process pam_systemd puts into the session scope anyway.

## Moire login protocol, version 1

Binary, little-endian, one message per frame:

```
u32 length (of everything after it) | u8 version (1) | u8 type | body
```

Body fields have fixed order and kinds:

- **u8**
- **text:** u16 length, then UTF-8, no control characters, fatal decoding.
- **bytes:** u16 length, then raw bytes. Used only for answers.

A body must be consumed exactly. A short, long, unknown-type or wrong-version message is a
violation, and the front closes the connection.

| Request (greeter → moire-dm) | Body                                           | Reply (moire-dm → greeter) | Body                                                         |
| ---------------------------- | ---------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `0x01 begin`                 | account: text (≤ 32 bytes)                     | `0x81 prompt`              | style: u8 (secret, visible, info, error), text (≤ 512 bytes) |
| `0x02 answer`                | `0` (acknowledge) or `1` bytes (≤ 512, no NUL) | `0x82 authorized`          | —                                                            |
| `0x03 start`                 | session: text (catalog id)                     | `0x83 scheduled`           | —                                                            |
| `0x04 cancel`                | —                                              | `0x84 cancelled`           | —                                                            |
| `0x05 sessions`              | —                                              | `0x85 error`               | code: u8                                                     |
|                              |                                                | `0x86 sessions`            | n: u8 (≤ 16), then n × (id: text, label: text)               |

**Error codes:**

| Code              | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `denied`          | Any refusal: wrong password, unknown account, expired or locked account |
| `busy`            | A login is already in progress                                          |
| `bad-state`       | Request out of phase, or the answer's shape doesn't match the prompt    |
| `unknown-session` | Not in the catalog; the attempt stays authorized                        |
| `unavailable`     | Infrastructure failure; it doesn't count against the user               |
| `protocol`        | Reserved                                                                |
| `version`         | Reserved                                                                |

The greeter maps the codes to its own sentences. Daemon or PAM text never becomes an error
message, and prompt text is shown only as the fixed sentences the clients already use.

**Rules:**

- **One request in flight.** A second before the reply is a violation.
- **Socket access:** `/run/moire-dm-front/greeter.sock` sits in a directory that is 0750
  `moire-dm-front:greeter`, which the broker creates, so only the greeter group can reach it. The
  socket is 0666 inside it, because the groupless front can't give it the greeter's group. The
  front's `SO_PEERCRED` check then admits only the greeter's uid. In the container test, another
  member of the greeter group was dropped and everyone else got `EACCES`.
- **Sessions are chosen by catalog id.** `sessions` lists the catalog, and its first entry is the
  default. The greeter's client asks for the list and starts the first entry, because the image's
  desktop is the only entry today. The greeter can't name a program or add environment variables.
- **Account names** must match `^[a-z_][a-z0-9_-]{0,30}\$?$`. Anything else is denied without
  running PAM (syntax reveals nothing about which accounts exist), and counts as a failure.
- **Secrets stay bytes end to end:** the greeter's encoder, the front, the broker, the worker's
  fd 3, then libpam. The greeter's UI string is the only JS string a password ever becomes (see
  the threat model).

Why binary rather than JSON with bytes: the parser stays a fixed-layout cursor of about 100
lines. There is no escape handling and no way for a secret to pass through a text decoder.

## Responsibilities

### Seat, VT and boot ordering

- **No Plymouth.** Moire's own boot stage (`apps/system/boot`, `nix/moire-native-boot.nix`)
  replaced it in the native image. `moire-dm.nix` asserts `boot.plymouth.enable == false` in every
  image that imports it, including the default greetd one.
- **Unit:** `moire-dm.service` (alias `display-manager.service`, `WantedBy=graphical.target`).
  It takes greetd's place in the boot order exactly:
  - `Wants`/`After`: `moire-boot-stage.service` (the stage opens its handoff, then signals ready),
    `moire-native-keymap-checks.service` (probe images), `systemd-user-sessions.service`,
    `systemd-logind.service` and `getty@tty1.service`. moire-dm.nix also adds `moire-dm.service`
    to those two units' `Before=` (mirroring their `Before=greetd.service`), so the greetd image is
    untouched.
  - `Conflicts=getty@tty1.service`, and `autovt@tty1` disabled, as greetd does.
  - `Type=simple`, as forced for greetd, so the greeter isn't held for the idle queue.
  - `Restart=always`, `RestartSec=1`, `StartLimitBurst=5` in 60 s, `IgnoreSIGPIPE=no`,
    `UnsetEnvironment=NODE_OPTIONS`, `KeyringMode=shared`, `restartIfChanged=false`.
- **Boot display for automatic login:** the boot stage's handoff directory is `root:greeter`
  0770, so only a greeter's compositor can ask it for the display. Before an automatic login the
  broker (root) asks instead (`requestBootRelease`), then republishes the released frame as a
  stage handoff in `/run/moire-stage`, exactly as the greeter does at login. The desktop seeds its
  first modeset from it. The journal logs `boot-display-released`. (Found by r60's `fresh-boot`:
  without it the user's compositor failed "logind device acquisition" while the stage held
  master.)
- **VT:** each session's exec helper calls `setsid()`, opens `/dev/tty1`, makes it the controlling
  terminal (`TIOCSCTTY`) and its stdin. PAM gets `PAM_TTY=tty1`, plus `XDG_SEAT`/`XDG_VTNR` in its
  environment.
  - moire-dm doesn't `VT_ACTIVATE`. greetd does by default. On this image VT1 is in front at boot
    and stays the login VT, so it doesn't matter there.
  - In the container test, a VT that was another session's controlling terminal made `TIOCSCTTY`
    fail. The result was fail-closed: no greeter, then the crash limit.

### PAM

```
pam_start_confdir(service, user, conv, NULL)
pam_set_item(PAM_TTY, "tty1"); pam_putenv(XDG_SEAT, XDG_VTNR, XDG_SESSION_CLASS)
pam_authenticate(PAM_DISALLOW_NULL_AUTHTOK)        # not for greeter / automatic login
pam_acct_mgmt  → PAM_NEW_AUTHTOK_REQD → pam_chauthtok(PAM_CHANGE_EXPIRED_AUTHTOK)
  … "authorized", wait for "start" …
pam_putenv(XDG_SESSION_TYPE=wayland, XDG_SESSION_DESKTOP)
pam_setcred(ESTABLISH); pam_open_session; pam_getenvlist
  … session …
pam_close_session; pam_setcred(DELETE); pam_end
```

- **Services:**
  - `moire-dm`: the NixOS-generated stack with `pam_unix` and `startSession` for pam_systemd.
  - `moire-dm-greeter` and `moire-dm-autologin`: `auth pam_permit` (as GDM's `gdm-autologin`
    does), then a real `account` stack (`pam_permit` for the greeter, `pam_unix` for automatic
    login), then `pam_env`, `pam_unix`, `pam_loginuid`, `pam_keyinit` and `pam_systemd` sessions.
- **Refusals look the same:** any refusal from `authenticate` or `acct_mgmt` is `denied`, and an
  unknown account still gets a password prompt first.
- **Expired passwords** are changed through the same conversation, before any session opens.
- **Conversation trampoline:**
  - It is a `koffi.register`ed callback, alive from `pam_start` to `pam_end`.
  - It answers with `malloc` memory that PAM owns, and wipes the JS bytes before returning.
  - Exceptions, a wrong answer count or shape, NULs and over-long answers all become
    `PAM_CONV_ERR`. It never truncates.
- **Cancel:** `cancel` goes to the worker's fd 3, its conversation returns `PAM_CONV_ERR`, and
  `pam_end` runs. If it hasn't within 1 s, the broker sends SIGTERM, then SIGKILL 10 s later.

### Session registration

The worker sets `XDG_SESSION_TYPE`, `XDG_SESSION_CLASS` (`user` or `greeter`),
`XDG_SESSION_DESKTOP`, `XDG_SEAT` and `XDG_VTNR` with `pam_putenv` before `pam_open_session`.
pam_systemd reads them there, and moves the worker into `session-N.scope`.

### Privilege drop and exec

`exec-entry.ts` reads an `ExecPlan` from fd 3 (account, argv, environment, VT; never a secret),
then:

1. `setsid` → open the VT → `TIOCSCTTY` → `dup2` it to stdin.
2. `initgroups` → `setresgid` → `setresuid`.
3. Verify: all three ids are the target, and `setresuid(0,0,0)` fails.
4. `chdir(home)`, falling back to `/` → `umask 022`.
5. Reset every signal disposition, and clear the signal mask. Node ignores SIGPIPE, and ignored
   dispositions survive `execve`.
6. Close fd 3 → `execve` (absolute `argv[0]`, no PATH search, no shell).

Any failure exits 126 before exec. uid 0 and gid 0 are refused. User sessions require uid ≥ 1000,
and the greeter must be exactly the configured account.

### Environment

The environment is built from scratch, never from the broker's own `process.env`. Precedence:

1. Defaults: `PATH=/run/wrappers/bin:/run/current-system/sw/bin` and `LANG=C.UTF-8`.
2. The PAM environment (`pam_env`'s `/etc/pam/environment`, pam_systemd's `XDG_RUNTIME_DIR` and
   `XDG_SESSION_ID`), except `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT` and `NODE_OPTIONS`.
3. Values moire-dm owns: `HOME`, `USER`, `LOGNAME`, `SHELL` and the `XDG_SESSION_*`, `XDG_SEAT`,
   `XDG_VTNR` and `XDG_CURRENT_DESKTOP` variables.
4. The greeter alone gets `MOIRE_DM_SOCK`.

### Launch, supervision and logout

1. **Authorize:** the worker reports "authorized".
2. **Schedule:** `start` with a catalog id gets `scheduled`.
3. **Retire the greeter:** the greeter exits after its scene handoff. If it's still there after 5 s,
   moire-dm stops it.
4. **Start:** only then is the worker told to open and run the session.
5. **Logout:** the session process exits, the worker closes PAM, and a fresh greeter (a new worker
   id) appears.

Worker ids are never reused, so late messages from old workers are ignored.

Shutdown (SIGTERM) stops every worker. Sessions get SIGTERM, then SIGKILL 5 s later. PAM closes,
and the broker exits 0.

### Crash and restart (built)

On every start, before drawing anything, the broker asks logind for seat0's sessions through
sd-login (`listSeatSessions`) and classifies them (`seat.ts`):

- **A live `class=user` session from `moire-dm` or `moire-dm-autologin`** (state `online` or
  `active`): the broker enters `recovering` and draws nothing. Sessions survive a broker restart:
  each lives in its own scope with its worker as parent, and the worker ignores the loss of fd 3
  once the session has started. The broker asks logind again every second. Once no user session of
  ours is left, it starts a greeter, never automatic login. A greeter connecting meanwhile is
  turned away.
- **A leftover `moire-dm-greeter` session:** its leader (the old worker, from
  `sd_session_get_leader`, systemd ≥ 254) gets SIGTERM, which ends that greeter and its PAM
  session. On older libsystemd the leader is unknown, and the old greeter ends by itself when its
  front connection is gone.
- **logind can't be asked:** the broker logs `seat-unknown` and boots normally. With no logind
  there are no pam_systemd sessions to draw over.

| What fails                    | Behaviour                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Greeter process               | A fresh greeter. More than 5 exits in 60 s: `greeter-crash-loop`, exit 1. Never a fallback session. |
| Front process                 | `front-exit`, broker exits 1. systemd restarts it, and recovery re-attaches to any live session.    |
| Authentication worker         | The pending request gets `unavailable`; the attempt is cleared.                                     |
| A session's worker            | Treated as the session ending: a fresh greeter.                                                     |
| Broker                        | Sessions survive; the restarted broker recovers as above.                                           |
| Malformed worker/front output | That process is killed.                                                                             |
| Bad configuration or accounts | Exit 1 before anything starts.                                                                      |

**After the start limit:** systemd stops retrying after 5 failed starts in a minute. The way back
in is a getty on another VT, which logind spawns on tty2 and up on demand. Only `autovt@tty1` is
disabled.

### Automatic login

- **State:** `/var/lib/moire-dm/autologin.json`, either
  `{"version":1,"user":"alice","session":"moire"}` or `{"version":1,"user":null}`.
- **Fail closed:** anything odd means off. Odd is: not a regular file (a symlink or directory),
  wrong owner (root or `moire-dm-settings` only), group- or world-writable, over 4 KiB, wrong
  shape or version, an invalid or greeter account, or a session not in the catalog. moire-dm logs
  `autologin-skipped detail=<reason>`. The broker opens the file with `O_NOFOLLOW` and checks the
  open descriptor, so nothing can be swapped in between the check and the read.
- **Once per boot:** the first broker of a boot writes a tmpfs marker
  (`/run/moire-dm/autologin-attempted`) before it reads the state, whatever the state says.
  Later brokers (a restart, a crash, a recovery) never sign anyone in, and a logout after an
  automatic login always shows the greeter (the state machine starts a greeter on
  `session-end`). So turning it on takes effect at the next boot.
- **The job:** a "trusted" worker with the real `account` stack. A password change or any failure
  falls back to the greeter.
- **Policy (Josh's decisions):** automatic login is enabled **only for the caller's own account**,
  from an active, local session, with an administrator's password typed into the system's prompt.
  An administrator types their own; a standard user gets through when an administrator types
  theirs. Turning it off needs the same. One account at most: turning it on replaces anyone
  else's.

**Write path (built):**

```
Settings ──session bus──▶ management service ──system bus──▶ moire-dm-settings ──▶ /var/lib/moire-dm
 LoginSettingsClient       org.moire.LoginSettings1           org.moire.LoginManager1   autologin.json
                           no state of its own;               caller uid from the bus,  O_EXCL temp,
                           calls with interaction allowed     polkit set-autologin ─┐   fsync, rename
                                                                                    ▼
                                                  polkitd ──▶ the compositor's password prompt
```

- **Settings:** Users & Login › Automatic login, for your own account. It is shown only when the
  login daemon supports it (moire-dm; under greetd the status says `available: false`). The
  switch calls the service at once; there is no password sheet. While the system's prompt is up
  the row says "Waiting for your password" (for a standard user, "Waiting for an administrator's
  password", and at rest "Needs an administrator's password"). A dismissed prompt leaves the
  switch where it was and shows nothing.
- **Management service** (`org.moire.LoginSettings1`): keeps no authorization state and refuses
  nobody on account type. It calls `SetAutomaticLogin(b)` with D-Bus's
  `ALLOW_INTERACTIVE_AUTHORIZATION` flag and a 150 s timeout. `moire-dm-settings`' `cancelled`
  (the prompt was dismissed) passes through as the fixed code `cancelled`. Only its own fixed
  sentences reach Settings.
- **`moire-dm-settings`** (`org.moire.LoginManager1`, its own system account): the account is
  the caller's, from `GetConnectionUnixUser`, never an argument. It must be uid ≥ 1000, a valid
  name and not the greeter. Then polkit `org.moire.dm.set-autologin` is checked for the calling
  connection, with interaction allowed when the caller set `ALLOW_INTERACTIVE_AUTHORIZATION`
  (140 s, and the check is withdrawn if nobody answers) and without it otherwise. Polkit's
  `polkit.dismissed` becomes the error `cancelled`. On: `{user: caller, session: the catalog's first}`. Off: no one.
  The record is run through the broker's own parser before anything is written, then written to
  an `O_EXCL`/`O_NOFOLLOW` temporary file (mode 0644), flushed, renamed, and the directory flushed.
  It logs `code=autologin-on|autologin-off user=<name>` and nothing about refused callers.
- **Polkit:** `nix/moire-dm.policy` defines the action with every default `no`, and the
  `org.freedesktop.policykit.owner` annotation for `unix-user:moire-dm-settings` (otherwise only
  root may ask polkit about another process). `00-moire-admin.rules` returns `AUTH_ADMIN_KEEP`
  for active, local sessions, ahead of the `01` deny fallback: an administrator's password (a
  member of `wheel`, `security.polkit.adminIdentities`' default), kept five minutes for the
  asking process. `00-moire-dm.rules`, a YES for `wheel`, is gone. The action's `<message>` is
  the prompt's headline.
- **Bus policy:** only `moire-dm-settings` may own `org.moire.LoginManager1`; anyone may call it.
- **`/var/lib/moire-dm`:** 0755, owned by `moire-dm-settings` (tmpfiles). The broker only reads it.
- **Residual risk, mostly closed:** the old YES let code running as an administrator call
  `moire-dm-settings` directly. Now every caller meets polkit's prompt. What remains is the
  five-minute kept authorization of the management service's process, which acts for any process
  of the user (see [settings-redesign.md](settings-redesign.md) and polkit-agent.md, open
  question 5). It is still only ever the caller's own account.

### Default session per user

There is one catalog session today. The protocol already lists the catalog, so a per-user default
needs only the broker to record the last id per account in
`/var/lib/moire-dm/last-session.json` and to order the list accordingly. That is not built.

### Logging

Logs are `moire-dm: code=<code> [user=<name>] [detail=<reason>]`, from a fixed set of codes.

- Account names appear only for sessions that really started (and automatic login). People type
  passwords into the name field, so failed attempts carry no name.
- PAM messages, environments, argv and responses are never logged.

## Threat model

**Assets:** the root processes, account passwords in transit, the decision of who gets a session,
and the automatic-login setting.

**Protected against:**

- **Someone at the keyboard.** They can only reach PAM through the greeter. After 5 consecutive
  failures, unknown accounts included, every new attempt is held for 20 s before PAM starts. That
  stays under the greeter client's 30 s request timeout, and comes on top of pam_unix's own ~2 s
  failure delay. The count resets on success, not on reconnect.
- **A compromised greeter** (arbitrary code as `greeter`). It can guess at the throttled rate,
  refuse to show a UI, or start a catalog session for an account it has authenticated. It can't:
  - choose a program or environment;
  - open a second connection or pipeline requests;
  - learn which accounts exist;
  - reach any root process's parser with its own bytes.
- **A compromised front** (code execution through a parser bug, as `moire-dm-front`). It is a
  groupless system account with no files, and holds only the greeter socket. It can:
  - see passwords in transit;
  - deny service.

  It can hand the broker only messages that pass the broker's strict decoder, and those go through
  the same state machine as before (one request at a time, phases, throttle). It can't choose
  programs, skip authentication or reach PAM except through a conversation.

- **Other local processes and users.** The directory gate, the front's `SO_PEERCRED` check, and
  the refusal of any request outside greeter mode keep them out.
- **Tampered automatic-login state.** Owner, mode, size and shape checks turn anything odd into
  "off".
- **A buggy PAM module or worker.** Frames are bounded and validated, and a misbehaving worker is
  killed. Mapping a name to a system account gets no session.

**Not protected against:**

- **Root, physical access to storage, and the PAM configuration.** PAM modules are root code and
  are trusted, as in every login manager.
- **The greeter's own memory.** The greeter holds the typed password as a JS string, as it did with
  greetd, and its encoder copies it into wiped bytes.
- **Same-uid attacks on a running session** (see [lock-screen.md](lock-screen.md)).

### Privilege separation (built)

- **The broker never reads greeter bytes.** The front owns the socket, reassembly, the peer check,
  and the first parse.
- **The broker parses the front's re-encoded messages a second time** with the same decoder. That
  is a fixed-layout cursor of about 100 lines, with no JSON and no escapes, so a compromised front
  still meets a very small root surface.
- **Root by necessity:** the worker (`pam_unix` reading shadow for other users, `pam_setcred`,
  `pam_open_session`, pam_systemd) and the exec helper until it drops.
- **Root by role:** the broker spawns root workers and owns the seat's lifecycle.
- **Not root:** the front (`moire-dm-front`) and the automatic-login writer (`moire-dm-settings`,
  Phase 5).

### Password handling in moire-dm's own processes

**Path:** greeter encoder → front → broker → worker fd 3 → libpam. No moire-dm process makes a JS
string from it. Each copy moire-dm owns is wiped:

1. The socket chunk, once copied into the fixed per-connection frame buffer.
2. That buffer's region when the message is handed out, and the whole buffer on disconnect.
3. The message after parsing.
4. The parsed answer, after re-encoding.
5. The front→broker frame, once written.
6. The broker's copy of the request message, and the parsed answer once it is in the worker frame.
7. That frame, once written.
8. In the worker, the received frame _is_ the answer. The trampoline copies it into PAM-owned C
   memory and wipes it, and PAM overwrites its copy before freeing it.

**Residual:** Node's stream layer reads into its own allocation before handing over a chunk, and
kernel socket buffers aren't ours to wipe.

### Node/V8 as root

- **Small, fixed code:** four bundled single-file entries built at image time, run with plain Node.
  There's no tsx, and nothing is resolved at runtime except koffi, all on the read-only store.
  - The broker imports only `@moire/sys/privilege` and `@moire/sys/login-sessions`.
  - The worker imports `@moire/sys/pam` and `@moire/sys/privilege`, and the front only
    `@moire/sys/privilege`.
  - None of them loads the `@moire/sys` index (KMS, EGL, input), and there's no D-Bus in any root
    process.
- **V8 flags on every moire-dm process:** `--jitless`, `--no-expose-wasm`,
  `--disallow-code-generation-from-strings` and `--disable-proto=throw`. The broker passes them on
  to the front, workers and exec helper. `--jitless` already turns WebAssembly off; saying
  `--no-expose-wasm` explicitly stops Node 22's V8 printing "Warning: disabling flag --expose_wasm
  due to conflicting flags" at every process start. The package build fails if those flags print
  anything.
  `--jitless` was verified with koffi on Linux: the PAM conversation callbacks, sd-login and
  `execve` all work under it, both in the container tests and in the package build's bundled
  native check.
- **Clean child environments:** children get explicit allowlisted environments, sessions a
  constructed one.

### systemd hardening, and what a login manager can't use

Everything a unit applies to its main process is inherited by the sessions it starts. So these
can't go on `moire-dm.service`, as with greetd, GDM and SDDM:

- **Namespace sandboxing:** `ProtectSystem`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`.
- **`NoNewPrivileges`:** it would break `sudo`, `passwd` and `unix_chkpwd`.
- **Capability limits:** a smaller `CapabilityBoundingSet`, `SystemCallFilter`,
  `RestrictNamespaces`, `RestrictAddressFamilies`.
- **`MemoryDenyWriteExecute`:** it breaks every JIT in the session.

What does apply:

- **Unit:** `UnsetEnvironment=NODE_OPTIONS`, `KeyringMode=shared`, and a private umask (077) in
  the broker.
- **Processes:** `--jitless` and the flags above, and the front's privilege drop.
- **Greeter (proposed, not built):** `PR_SET_NO_NEW_PRIVS` for the greeter session.
- **`moire-dm-settings`:** full unit hardening, since nothing inherits from it:
  `NoNewPrivileges`, `ProtectSystem=strict` with only `/var/lib/moire-dm` writable,
  `ProtectHome`, private `/tmp`, devices, network and IPC, `RestrictAddressFamilies=AF_UNIX`,
  no capabilities, `@system-service` minus `@privileged`, `MemoryDenyWriteExecute` (it runs
  `--jitless`), and the kernel, clock, cgroup and `/proc` protections.

### Compared with greetd

| Aspect                    | greetd                             | moire-dm                                             |
| ------------------------- | ---------------------------------- | ---------------------------------------------------- |
| TCB                       | Rust, small static binary          | Node/V8 + koffi (mitigated above)                    |
| Who parses greeter bytes  | The root daemon                    | An unprivileged front; root re-parses typed messages |
| Protocol                  | JSON, greeter supplies cmd and env | Binary v1, sessions by catalog id, typed error codes |
| Password in daemon memory | Rust `String`s, not zeroed         | Bytes only, wiped at every hop moire-dm owns         |
| Throttling                | PAM delay only                     | PAM delay plus a 20 s hold after 5 failures          |
| Automatic login           | Static generated config            | Runtime state, own-account Settings path             |
| Restart over a session    | Draws a greeter                    | Waits for the session (logind)                       |
| Maturity                  | Years of use                       | New; the default, rollback is one flag               |

## Migration and rollback

- **Flag:** `moire.dm.backend` in `nix/moire-dm.nix`, default `"moire-dm"` (Phase 4, approved
  after the r58-dm VM run). The desktop image's `dmBackend` argument defaults to `"moire-dm"` too.
  - The native desktop image imports the module and sets `moire.dm.greeter` and
    `moire.dm.sessions` from the same values greetd uses.
  - With `"moire-dm"`, it disables greetd (and asserts that both can't be on) and adds the unit,
    the PAM services, the `greeter`, `moire-dm-front` and `moire-dm-settings` accounts,
    `/etc/moire-dm/config.json`, `/var/lib/moire-dm`, `moire-dm-settings.service`, the polkit
    action and rule, and the system-bus policy.
  - With `"greetd"`, the module only asserts. The greetd image is the previous default image: its
    units, `/etc`, users, groups and PAM services are those the greetd/moire-dm comparison checked
    (identical before and after the switch was added). What differs from the r57 image is
    outside this module: the session label, and the image-wide test additions below
    (`moire-admin-test`). `/etc/moire-build.json` has no `loginBackend` in the greetd image and
    `"loginBackend": "moire-dm"` in the default one.
  - Nix isn't available on the Mac host, so this comparison was not re-run for this change; the
    image builder evaluates both paths only when each is built.
- **Image build:** `scripts/build-native-login-probe.py --desktop` builds the moire-dm image;
  `--desktop --dm greetd` builds the rollback image (checkpoint `c63-native-desktop-greetd`). The
  build receipt records `loginBackend`. Directly: `nix build --impure --file
nix/moire-native-desktop-image.nix [--argstr dmBackend greetd]`.
- **Rollback:** boot a greetd ISO, or build with `--dm greetd`. Nothing moire-dm writes is read by
  greetd.

### Test controls (test images only)

`moire.dm.testControls = true` (set by the desktop image, which carries public test credentials;
the module asserts the `moire-pam-test` account exists) adds `/run/moire-dm-test`, mode 0770
`root:users`, watched by `moire-dm-test.path`. Any member of `users` (both test accounts) can
create a file there from a session's terminal or file manager, without a root shell:

| File         | What root does                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `crash`      | `systemctl kill --kill-whom=main -s KILL moire-dm`: the broker dies; systemd restarts it        |
| `restart`    | `systemctl restart moire-dm`: a clean stop (SIGTERM ends moire-dm's sessions), then a start     |
| `fresh-boot` | Stops moire-dm, ends every seat0 session, removes the once-per-boot marker, starts it: a reboot |

The directory is emptied (without following links) before acting, so each file acts once, and
the journal of `moire-dm-test.service` says what ran. Without the option (any non-test image)
none of this exists. In a session: `touch /run/moire-dm-test/crash`.

Note on `restart`: the broker's SIGTERM is a shutdown, which stops every worker and so ends the
user sessions it started (`daemon.smoke.ts` pins this). Recovery over a live session is the crash
path; `crash` exercises it.

**VM test plan** (the `r62-dm` image; public disposable test passwords: `moire-pam-test`, a
standard user, and `moire-admin-test`, an administrator):

1. Boot straight to the greeter, with no blank between the scene and the greeter. Then
   `systemctl status moire-dm` is active, there is no greetd unit, and
   `loginctl show-session <greeter>` reads `Class=greeter Service=moire-dm-greeter VTNr=1`. There
   are processes for `moire-dm-front` (uid of `moire-dm-front`) and the broker (root).
2. Wrong password, then an unknown account: both say "didn't work". The journal has
   `code=auth-denied` and no name.
3. Five wrong passwords: the sixth attempt waits about 20 s.
4. Right password:
   - the desktop appears and the scene dissolves as before;
   - `loginctl show-session $XDG_SESSION_ID` reads `Type=wayland Class=user Desktop=moire
Service=moire-dm`;
   - `id` shows the user's groups, and `sudo -v` works for an admin.
5. Log out: a fresh greeter appears, and needs the password again. Repeat twice.
6. During a session, `touch /run/moire-dm-test/crash`: the session survives, no greeter is
   drawn, and the journal shows `seat-busy`. Log out, and a greeter appears within a second
   (`seat-free`). (`touch /run/moire-dm-test/restart` instead ends the session and shows a
   greeter: SIGTERM is a shutdown.)
7. `systemctl kill -s KILL moire-dm` with the greeter showing: the old greeter goes, and one new
   greeter appears.
8. Kill the greeter six times in a minute: moire-dm stops after the start limit, and Ctrl+Alt+F2
   gives a getty.
9. Automatic login (the live ISO keeps `/var` in RAM, so `fresh-boot` stands in for a reboot):
   1. As `moire-pam-test`: Settings › Users & Login › Automatic login is off, "Needs an
      administrator's password". Switch it on: the system's prompt lists `moire-admin-test`.
      Escape: still off, no error. (Answering it turns it on for `moire-pam-test`; turn it off
      again the same way.)
   2. As `moire-admin-test`: switch it on; the system's prompt asks for the password, with no
      Settings sheet (a wrong password says so in the prompt). Then "On · starts without asking
      for your password", and the journal has
      `moire-dm-settings: code=autologin-on user=moire-admin-test`. The file is
      `-rw-r--r-- moire-dm-settings`.
   3. Log out: the greeter, not an automatic login.
   4. Log in again and `touch /run/moire-dm-test/fresh-boot`: the session ends, and the desktop
      returns as `moire-admin-test` without a prompt (`autologin-start`, `session-start`).
   5. Log out: the greeter. `touch`ing `crash` or `restart` from a later password session never
      signs in automatically again.
   6. Switch it off (within five minutes of the last prompt: no prompt; later: the prompt),
      `fresh-boot`: the greeter.
10. `journalctl -b | grep <password>` finds nothing.
11. `systemctl poweroff` from a session: it shuts down cleanly in under 15 s.

## Phases and approvals

| Phase | Work                                                                                               | State                             |
| ----- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1     | Design                                                                                             | Approved with changes             |
| 2     | Foundations: bindings, protocol, state machine, worker, exec helper, clients, smokes               | Done                              |
| 3     | Moire protocol, front, crash recovery, backend flag, package, test ISO                             | Done; boot test is Josh's         |
| 4     | Make moire-dm the desktop image's backend                                                          | Done (approved after r58-dm)      |
| 5     | `moire-dm-settings`, `org.moire.dm.set-autologin` (own account only), management service, Settings | Built; VM run on r59-dm is Josh's |
| 6     | Remove greetd and the greetd client paths                                                          | Needs approval                    |

## Defaults chosen for the earlier open questions

- **Throttle:** a 20 s hold after 5 consecutive failures, on top of PAM's own delay.
- **`pam_faillock`:** not added. A persistent per-account lockout can lock an owner out of their
  only account, and moire-dm's in-memory hold already limits guessing at the seat.
- **`--jitless`:** on, together with `--disallow-code-generation-from-strings` and
  `--disable-proto=throw`, verified with koffi.
- **Crash-loop recovery:** exit, let systemd retry (5 starts in 60 s), then a getty on another VT.
- **uid < 1000** (root included) never gets a user session.

## Verification

Run from the repo root with
`node --import ./apps/system/compositor/node_modules/tsx/dist/loader.mjs <file>`:

- **`apps/system/moire-dm/src/protocol.smoke.ts`** (54 cases):
  - Every request round-trips, fed one byte at a time; answers stay bytes, including invalid
    UTF-8.
  - The front's re-encoding matches the client's encoding.
  - 21 malformed messages are rejected: wrong version or type, a body that is too short or too
    long, a bad flag, a NUL in an answer, oversized fields.
  - Framing violations; no secret left in the reader.
  - Replies round-trip, with control characters replaced and limits cut.
  - The front↔broker channel: round trips, direction checks, size bounds.
- **`apps/system/moire-dm/src/state.smoke.ts`** (about 18,500 transitions): all earlier cases on
  the new message set, plus the session list and choosing a session by id or an unknown id. Also
  restart recovery:
  - waiting over a live session;
  - signalling the old greeter;
  - turning a greeter away while waiting;
  - a greeter (never automatic login) once the seat is free;
  - logind unavailable;
  - shutdown while waiting.
- **`apps/system/moire-dm/src/conversation.smoke.ts`:** PAM order and the XDG variables, wipes,
  every refusal path, expired passwords, trusted jobs, environment construction (`MOIRE_DM_SOCK`
  for the greeter only), strict configuration and automatic-login parsing.
- **`apps/system/moire-dm/src/daemon.smoke.ts`:** the real broker, front process and worker
  processes with fake PAM.
  - The peer check, garbage and pipelining.
  - The greeter's own `connectLoginClient`, chosen by `loginBackend` exactly as installed:
    denial, unknown account, cancel, login, `start`.
  - The session starts only after the greeter exits.
  - Logout; a mapped system account refused.
  - `connectMoireDmBroker`: a command refused, an unknown id, a catalog id accepted.
  - Shutdown; a restart over a live session that waits, then draws a greeter.
  - No secret in logs, records or state.
- **`apps/system/moire-dm/src/pam.native.smoke.ts`** (Linux; SKIP elsewhere):
  - Real Linux-PAM through the trampoline.
  - Account lookup, and the drop's guard rails.
  - The exec probe.
  - sd-login decoding against expected sessions when given.
- **`apps/system/moire-dm/src/autologin.smoke.ts`:** the writer only produces what the broker
  accepts (unknown session, greeter or bad names refused, old file kept), mode 0644, no temporary
  files left; the reader turns 0666, oversized, garbage, a symlink and a directory into "off"; a
  rename replaces a symlink instead of writing through it.
- **`apps/system/moire-dm/src/login-manager.smoke.ts`** (needs `dbus-daemon`; not in the package
  build): `org.moire.LoginManager1` on a private bus. The account is the caller's; interaction
  follows the caller's flag; a dismissed prompt is `cancelled`; a standard user gets through on a
  polkit yes, for their own account; polkit no, uid < 1000 and the greeter are refused (polkit
  isn't asked for those); bad arguments; one change
  at a time; odd files read as off with the reason; logs carry only the account changed.
- **`apps/system/management-service/src/accounts-settings.smoke.ts`:** also automatic login
  through the real session interface and a fake `moire-dm-settings`: called with the interactive
  flag, on and off, someone else's shown as theirs, `cancelled` passed through, refusals mapped
  to fixed sentences, a standard user allowed, and `available: false` without the service.
- **`apps/core/settings/src/users.smoke.tsx`:** the row with no sheet, "Waiting for your
  password", a dismissed prompt showing nothing, standard users, and no row under greetd.
- **`node scripts/test-settings-policy.mjs`:** `00-moire-admin.rules` (ES5) and the action file.
- **The `moire-dm` package build** (`nix build .#moire-dm`, verified in a Nix container on
  aarch64 Linux with Linux-PAM 1.7.2 and systemd 260) runs the five portable smokes. It then runs
  the native check from the bundle under the installed V8 flags, and fails if those flags print a
  warning.
- **Display-manager, greeter and compositor typechecks; the existing display-manager smokes**
  (the greetd clients, unchanged).

**Container runs** (podman, aarch64, Debian bookworm and trixie, run as root):

- **Full production path** (broker, front, worker, exec helper; real `pam_unix`; the scripted
  greeter uses the real `connectLoginClient`):
  - The front ran as `moire-dm-front` with no groups, and the flags reached every process.
  - Wrong password and unknown account were both `denied`.
  - The session ran as uid 1000 with its `initgroups` groups, as session leader on the VT, with
    `SigIgn` 0 and `SigBlk` 0, and exactly the constructed environment.
  - No copy of the password on disk.
- **Automatic login and shutdown:** the session ended cleanly and the broker exited 0. The marker
  stopped a second automatic login, and a 0666 file was skipped with `detail=mode`.
- **Restart recovery against sd-login with logind state files** (trixie, systemd 257): no greeter
  while a user session was live, the old greeter's worker was signalled, and a greeter came up
  once the session ended.

**Nix evaluation:** both image variants evaluate. For the default image, the evaluated units,
`/etc`, users, groups and PAM services are identical before and after this change.
