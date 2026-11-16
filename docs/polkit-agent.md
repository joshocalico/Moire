# Moire polkit authentication agent

Status: **built and in use.** Approved 2026-10-11; built through 2026-10-31 and checked in the VM
through R68 (see "Decided on 2026-10-31" below).

Decided on 2026-10-11:

- **Helper:** the stock helper over its socket (option A).
- **Standard users:** an administrator may type their password at a standard user's prompt.
- **Verification key:** yes, **Super+Escape**. Ctrl+Alt+Delete is taken. Super combinations are
  the compositor's, so no client sees the key.
- **Open questions 4 to 9:** the recommendations stand.

Decided on 2026-10-31, after the R65 VM run:

- **No kept authorization:** the administrator actions answer `AUTH_ADMIN`, not
  `AUTH_ADMIN_KEEP`; every change asks. See "Policy changes".
- **The greeter is excluded in the rule:** `00-moire-admin.rules` answers NO for the greeter
  account and for any subject not in an active, local session, before its prompt branch.
- **One prompt per change (all recommendations approved):** Settings calls moire-accounts, a
  small unprivileged system service, which asks polkit once per change about Settings and then
  makes the AccountsService calls itself. The prompt names Settings, and the management service
  leaves the administrator path. See "One prompt per change".
- **Automatic login asked for by Settings too (approved follow-up):** Settings calls
  moire-dm-settings itself, so the prompt says "Requested by Settings", not "Moire Management".
  The management service no longer serves automatic login at all (`org.moire.LoginSettings1` is
  gone; Settings reads the status from moire-dm-settings as well).
- **No direct AccountsService administration from a session (approved follow-up):**
  `org.freedesktop.accounts.user-administration` answers NO, with no prompt, for every subject
  but root and the `moire-accounts` system account. Nothing in Moire asks for it from a session
  any more. See "Policy changes".

The design:

- **Who is the agent:** the compositor. It registers with polkit for its own logind session
  before it starts any client, and draws the prompt itself in a protected layer, as it draws the
  lock screen.
- **How a password is checked:** polkit's own `polkit-agent-helper-1`, reached over its socket
  (`/run/polkit/agent-helper.socket`). No program is spawned and nothing setuid is added. Moire
  writes no new root code.
- **What changes in policy:** the deny-all model stays. The two grants that are a plain YES for
  `wheel` today become "ask for an administrator's password". Every further action is a separate
  approval.
- **Settings:** its two authorization sheets (the admin unlock and automatic login) go away.
  Its data-entry sheets (new passwords, Wi‑Fi passwords) stay.

The prompt machinery is shared with [secret-service.md](secret-service.md), whose unlock and
consent prompts use the same protected layer.

## Why

Polkit can answer yes, no, or "ask the user". Moire has no agent, so the third answer is
unusable, and every image forces the first two (`nix/moire-settings-services.nix`: pkexec off,
the helper's socket and service off, an assertion that they stay off).

What that costs today:

- **Admin grants are a YES for any process of an administrator.** `00-moire-settings.rules`
  gives `org.freedesktop.accounts.user-administration` to every active, local `wheel` process,
  and `00-moire-dm.rules` does the same for `org.moire.dm.set-autologin`. The password re-entry
  is a gate in Moire's own UI path (the management service's per-connection unlock, checked with
  `unix_chkpwd`), not a boundary. [settings-redesign.md](settings-redesign.md) states the
  consequence: code running as an administrator can create a second administrator and reach
  `sudo` without the password. It also says "a real agent with a helper-backed prompt removes
  this".
- **Everything else is a flat no**, with no way to say yes from the desktop. From the rules'
  own "not granted" comments:

  | Area                  | Denied today                                                                                                                         | What the user sees                                                                                           |
  | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
  | Date & time           | `timedate1.set-time`, `set-local-rtc`                                                                                                | No manual clock                                                                                              |
  | Network               | `NetworkManager.settings.modify.system`, `wifi.share.*`, `enable-disable-network`, hostname, global DNS                              | Shared profiles can't be edited; Settings saves a per-user copy instead (`userCopy` in `network-manager.ts`) |
  | Power                 | `login1.*-multiple-sessions`, `*-ignore-inhibit`, hibernate, reboot to firmware                                                      | Restart is refused while another user is signed in or an app blocks it                                       |
  | Storage               | Everything in UDisks except mount, eject and power-off of removable drives                                                           | No encrypted unlock, no formatting, no fixed disks ([removable-drives.md](removable-drives.md))              |
  | Accounts              | `accounts.set-login-option`, `change-own-password` (both stay denied; Moire has its own paths)                                       | —                                                                                                            |
  | Terminal and services | `systemd1.manage-units`, `run0`, and any third-party action (firmware updates, Flatpak system installs, printers, anything `pkexec`) | "Not authorized" or "Interactive authentication required", with `sudo` in a terminal as the only way through |

- **Callers are written around the gap.** `time-settings.ts` and moire-dm's `settings-entry.ts`
  ask polkit with interaction off and say so in comments. `accounts-settings.ts` describes its
  unlock as "the prompt polkit cannot show".

One thing the agent does not fix: `apps/system/compositor/src/logind-power.ts` holds logind
inhibitors through a `systemd-inhibit` child. That is because `@moire/dbus` can't pass file
descriptors, not because of polkit, and the actions it needs are plain YES rules. Nothing in the
repo spawns `pkttyagent`. Once Moire's agent is registered, terminal tools that would start
`pkttyagent --fallback` (systemctl, loginctl, `systemd-inhibit` on a terminal) use Moire's prompt
instead, since a fallback agent gives way to a registered one.

## What exists to build on

| Piece                                        | Where                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Lock state machine, byte-only password entry | `packages/core/src/session-lock.ts` (`SessionLock`, 512-byte buffer)                       |
| Locked composition and seat gates            | `packages/core/src/server.ts` (`compositeLocked`, `enterLockedSeat`, `lockKey`)            |
| Server-side key text                         | `packages/sys/src/keyboard-state.ts` (`keyText`)                                           |
| Fallback prompt painter                      | `packages/core/src/lock-screen-paint.ts`                                                   |
| Shell-drawn lock UI and its raster bridge    | `packages/shell/src/lock/`, `lockRaster` / `onLockPointer`                                 |
| Throttle                                     | `packages/system-management/src/password-check.ts` (`createPasswordThrottle`)              |
| System-bus connection in the compositor      | `logind-power.ts` (`SessionBus.connect(SYSTEM_BUS_ADDRESS)`)                               |
| An exported agent object, as precedent       | `apps/system/management-service/src/bluez-pairing.ts` (`org.bluez.Agent1`)                 |
| Each Wayland client's pid                    | `conn.peerPid` in `server.ts`                                                              |
| Policy rules and their test                  | `nix/moire-*.rules`, `nix/moire-deny-unapproved.rules`, `scripts/test-settings-policy.mjs` |

`@moire/dbus` already does what the agent needs: exported objects, handlers that reply later,
signals and message flags. It needs no descriptor passing for this.

## Architecture

```
mechanism (moire-accounts,      polkitd                         compositor (session user)
 timedated, moire-dm-settings)   rules: YES / NO / AUTH_ADMIN     polkit-agent.ts
   CheckAuthorization ─────────▶ finds the subject's session ──▶ BeginAuthentication(action,
   (interaction allowed)         and its registered agent          message, details, cookie,
                                                                    identities)
                                                                       │ secure prompt (core)
                                                                       │ keys → 512-byte buffer
                                                                       ▼
   AuthenticationAgentResponse2 ◀── polkit-agent-helper-1 (root) ◀── /run/polkit/agent-helper.socket
   (root only)                       PAM "polkit-1", SO_PEERCRED      "user\n" "cookie\n" answer bytes "\n"
```

- **Agent** (`apps/system/compositor/src/polkit-agent.ts`, new): a system-bus object at
  `/org/moire/PolicyKit1/AuthenticationAgent` implementing
  `org.freedesktop.PolicyKit1.AuthenticationAgent` (`BeginAuthentication`,
  `CancelAuthentication`).
- **Secure prompt** (`packages/core/src/secure-prompt.ts`, new, next to `session-lock.ts`): a
  pure state machine for one modal, compositor-owned question. It has two users: this agent and
  the keyring. The lock screen stays its own machine; the prompt reuses its entry buffer, key
  routing and painter seams.
- **Helper client** (`apps/system/compositor/src/polkit-helper.ts`, new): about 150 lines over
  `node:net`, speaking the helper's line protocol in bytes.
- **Greeter:** the pre-login compositor never registers. A greeter session has no agent.

### Registration

- **Subject:** `("unix-session", { "session-id": <s> })`, the compositor's own logind session,
  sent as `RegisterAuthenticationAgent((sa{sv}) subject, s locale, s object_path)`. The agent
  reads the id over its own system-bus connection (logind `GetSessionByPID`, then the session's
  `Id`). Polkit sends a request to the agent of the session the requesting process belongs to.
  Processes outside a session (ssh, system services) get no prompt and keep today's answer.
- **When:** during compositor start, before `spawnApp` runs anything (`main.ts` awaits
  `startSessionPolkitAgent` first). Polkit allows one agent per session, so registering first is
  what stops a user process from becoming the _session's_ agent. A per-process agent can still
  register, but Moire's polkitd patch makes it fallback-only: it is asked only when the session
  has no agent (see "Protected against" and open question 10).
- **If registration fails** because an agent already exists (polkitd answers
  `org.freedesktop.PolicyKit1.Error.Failed`, "An authentication agent already exists for the
  given subject"), the compositor doesn't retry in a loop or fall back. It logs
  `polkit-agent: code=agent-taken` and reports the status through `onStatus`. It registers once
  per polkitd: again only when `org.freedesktop.PolicyKit1` changes owner or the system bus
  connection drops and is re-made. The shell's persistent warning is not built yet; `main.ts`
  has the status to feed it.
- **Who may call the agent:** only the connection that owns `org.freedesktop.PolicyKit1`
  (checked against `GetNameOwner`, re-read when the name changes owner). Calls from anyone else
  are refused before any state is touched. This is the second layer: polkit's bus policy
  (`org.freedesktop.PolicyKit1.conf`) already lets only the `polkituser` account send calls on
  the agent interface, and the system bus refuses the rest with `AccessDenied`.

### The protected layer

The prompt is drawn by the compositor after everything a client can influence, the way
`compositeLocked` draws the lock.

- **Screen:** the frame is the lock-style obscured wallpaper with no client surface in it, then
  the prompt. A window that maps or redraws while the prompt is up isn't shown. Showing no client
  pixels is deliberate: nothing a client draws can sit beside, under or over the real prompt.
- **Input:** keys and pointer events go only to the prompt. Clients get keyboard and pointer
  leave, and the existing `ClientSession` gates refuse to deliver while a prompt is up, as while
  locked. Popup grabs, drags and interactive moves end. Xwayland gets no keys.
- **Password entry:** the lock's path. `keyText` writes UTF‑8 into a fixed buffer, the UI sees
  only the length, and no JS string is made.
- **Arming delay:** keys count 400 ms after the prompt appears, and keys held from before never
  type. A prompt that pops up mid-sentence doesn't swallow what the user was typing elsewhere.
  The delay covers Escape and clicks too, so a keystroke or click already on its way neither
  cancels nor allows anything.
- **Keys the prompt takes:** text, Backspace, Ctrl+U (clear), Enter (submit), Escape (cancel),
  Up and Down (another administrator), the layout switch, Super+L and the verification key.
  The keys that were down when a prompt closes (the submitting Enter) are swallowed, releases
  included, as after unlock.
- **Captures:** `CaptureScreenshot` answers only the Screenshot app the compositor launched from
  its own install tree, identified by the bus daemon's pid for the caller and the compositor's
  launch records, never by anything the caller says; everyone else gets `AccessDenied`
  (docs/apps/screenshot.md, "Who may capture"). While a prompt is up it is refused for Screenshot
  too (`capturePrimaryOutput` throws).
- **Fail closed:** the shell draws the prompt's UI through a raster bridge like `lockRaster`
  (`securePromptRaster`, `onSecurePromptPointer`). If it throws or is missing, the compositor
  draws its own text-free prompt (a shield, dots, the field colour;
  `secure-prompt-paint.ts`). If that fails too, the request ends as "failed". Authentication is
  never granted by a failure. A view that failed is tried again for the next prompt.
- **Outputs:** the prompt is on the output under the pointer, else the primary. Others are black.
- **Clients behind it** are kept alive like clients behind the lock: frame callbacks and buffer
  releases once a second, never drawn. Nothing is pasted and no drag starts.
- **Pre-login:** a greeter compositor refuses every request unseen.

### The verification key

Super+Escape, which only the compositor sees: the Escape, its repeats and its release reach no
client and not the shell.

- **A real prompt is open:** its badge lights inside a ring for about a second and the prompt
  says "Verified: this request comes from the system". Nothing else changes.
- **None is open:** for 2.5 s the compositor shows "No system password request is open" on the
  protected frame (the obscured wallpaper, no window), and clients lose the seat meanwhile. Any
  key or click puts it away, and is swallowed. Without the shell the notice is a text-free empty
  shield.
- **Locked:** nothing beyond the lock screen; the key does not clear its field.
- The prompt carries the hint "Press Super+Escape to check that this is a system request".

### For requesters

`packages/core/src/secure-prompt-types.ts` is the contract. The compositor app gets:

- `server.securePrompts` (`SecurePrompts`): `request()` returns a handle with `result` and
  `cancel()`. The prompt bounds and strips the request's text a second time.
- `server.onSecurePromptFlood((program) => …)`: called once when a requester's cancels become
  a flood (below), with its advisory name, for the one notification.
- A request's `coolDownKey` (executable plus action) keys the 2 s cool-down after a cancel;
  its `requesterKey` (the program) keys the flood count and the 5-minute pause.
- A consent prompt (`kind: "consent"`, for the keyring) has Allow and Deny and no field. Allow
  takes the pointer: Enter never allows, Escape denies.

### What the prompt says

| Element        | Source                                                                                               | Trust                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Headline       | Polkit's `message` for the action, as plain text, control characters stripped, cut at 200 characters | From a root-installed `.policy` file; a mechanism may substitute its own text    |
| Requested by   | `polkit.subject-pid` from `details`, matched to a Wayland client by `conn.peerPid`                   | Advisory. A pid can be reused, and the requester may be a child of the app shown |
| …if no window  | `/proc/<pid>/exe`, plus the nearest ancestor that owns a window ("systemctl, from Terminal")         | Advisory                                                                         |
| …if an X11 app | The same kernel-derived name, plus "runs under X11" (see the threat model)                           | `_NET_WM_PID` is never used                                                      |
| Who signs      | The identity chooser                                                                                 | From polkit                                                                      |
| Details        | Action id and pid, behind a disclosure                                                               | Action id is authoritative                                                       |

- **Which pid:** `polkit.subject-pid` is the process the authorization is for: Settings itself
  for account changes and automatic login (it calls moire-accounts and moire-dm-settings
  directly). `polkit.caller-pid` is the mechanism that asked polkit (moire-accounts,
  moire-dm-settings), and is used only when polkit sends no subject pid.
- **Naming:** `polkit-requester.ts` shares `sleep-blockers.ts`' process inspector and the
  compositor's launch records. A windowless service the compositor started is named by its
  launch ("Moire Management"). The X11 flag needs all of: no Wayland connection in the process
  or above it, Xwayland running, and an X client library in `/proc/<pid>/maps`.
- **No vendor:** `BeginAuthentication` carries the action id, message, icon name, details,
  cookie and identities. The vendor would need a second call (`EnumerateActions`), so version 1
  leaves it out.

The prompt never shows text from the helper or PAM. As in moire-dm, those map to fixed
sentences: "That password didn't work", "Too many attempts", "can't be checked right now".

### Identity chooser

- Polkit passes the identities allowed to answer. For an administrator action on NixOS these
  come from `security.polkit.adminIdentities` (`unix-group:wheel` by default).
- polkitd 127 expands groups itself: the agent receives `("unix-user", { "uid": <u> })` only,
  one per member. The agent still accepts `unix-group` and expands it from `/etc/group`.
- The agent keeps accounts from `/etc/passwd` with uid ≥ 1000 and a login shell, puts the
  session user first, and lists at most eight.
- With no administrator at all, polkitd offers uid 0. The agent offers root no prompt: the
  request is refused (`code=no-identity`).
- **One identity:** no chooser; the prompt names who signs.
- **The session user is among them:** they are preselected. The chooser is a quiet "Use another
  administrator" control.
- **The session user isn't** (a standard user asked for an admin action): the prompt says "An
  administrator's password is needed" and lists administrators by full name, as the greeter's
  picker does. See open question 2.
- Changing identity clears the buffer and starts a new helper conversation. It is not possible
  while a check runs.
- Where the list does not fit (a small or heavily scaled output), it becomes one row with
  previous and next. Past four names the list has two columns.

### Cancel, timeout and queueing

- **Cancel:** Escape or the Cancel button. The helper socket is closed, the buffer is wiped, and
  `BeginAuthentication` returns `org.freedesktop.PolicyKit1.Error.Cancelled`.
- **`CancelAuthentication(cookie)`** from polkit (the requester went away): the same, with no
  message.
- **Timeout:** 120 s without a key or pointer event cancels.
- **Wrong password:** the prompt stays, the field shakes, and a new helper conversation starts
  with the same cookie.
- **One at a time.** Up to three more requests wait in arrival order, each for at most 120 s.
  A fifth is refused at once.
- **Session lock:** locking cancels the visible prompt and holds the queue. Requests that arrive
  while locked wait, each for at most 120 s, and are shown after unlock. A prompt is never drawn
  over the lock screen.
- **What polkitd is told.** `BeginAuthentication` replies:

  | The prompt ended as                                        | Reply                                        | The mechanism sees                 |
  | ---------------------------------------------------------- | -------------------------------------------- | ---------------------------------- |
  | Completed, after the helper accepted a password            | Empty return                                 | Authorized                         |
  | Cancelled, timed out, locked, refused (queue or cool-down) | `org.freedesktop.PolicyKit1.Error.Cancelled` | Not authorized, `polkit.dismissed` |
  | Failed to draw, or completed with no accepted password     | `org.freedesktop.PolicyKit1.Error.Failed`    | Not authorized                     |

  An error reply refuses the request even when the helper has already succeeded.

- **Why a request was dismissed.** polkitd passes no reason with `polkit.dismissed`, so the
  mechanism (and Settings behind it) can't tell a person's cancel from a refusal. The
  compositor tells the requesting process itself, and nobody else
  (`apps/system/compositor/src/prompt-outcomes.ts`, wire constants in
  `packages/system-management/src/prompt-outcome.ts`):
  - Before it answers `Cancelled`, the agent records the reason under polkit's
    `polkit.subject-pid` (the kernel's pid for the process the authorization is for, which
    polkitd got from the system bus daemon), that process's start time, and the action id.
    Never under `polkit.caller-pid`: a mechanism asking on someone's behalf is not told.
  - `org.moire.SecurePrompt1.TakeDismissal(s action_id) → s` at `/org/moire/SecurePrompt1` on
    the compositor's session-bus name (`org.moire.Display1`) answers from the record for the
    caller's own pid, as the session bus daemon reports it (`GetConnectionUnixProcessID`), and
    only if the start time still matches (a reused pid gets nothing). It returns `refused`,
    `cancelled`, `timed-out`, `locked`, `withdrawn` (polkit cancelled it), or an empty string.
  - A record is read once and lives 60 s; at most 32 are kept.
  - **What can't leak:** a process learns a reason only for a request polkit made on its own
    behalf, which it already knows was dismissed. It can't learn whether a prompt is open, nor
    anything about another app's requests; it can't read another process's record by naming
    a pid or by guessing action ids.
  - **Not protected:** a process that takes `org.moire.Display1` before the compositor (it
    can't while the compositor holds it) could answer Settings falsely. The
    worst it does is choose between silence and "Password requests are paused" in Settings.

  | The prompt ended as                                      | `TakeDismissal` | Settings shows                                               |
  | -------------------------------------------------------- | --------------- | ------------------------------------------------------------ |
  | Refused at once (full queue, cool-down, flood pause)     | `refused`       | "Password requests are paused. Try again in a little while." |
  | Refused after waiting in the queue (cool-down, flood)    | `refused`       | The same                                                     |
  | Cancelled by a person                                    | `cancelled`     | Nothing                                                      |
  | Timed out (120 s)                                        | `timed-out`     | Nothing                                                      |
  | The session locked while it was on screen                | `locked`        | Nothing: the person locked the screen themselves             |
  | `CancelAuthentication`, or polkitd went away             | `withdrawn`     | Nothing                                                      |
  | No reason kept (another agent answered, compositor gone) | empty           | Nothing                                                      |

- **Callers must wait long enough.** A D-Bus call that may raise a prompt needs a timeout above
  120 s. Settings waits 170 s for moire-accounts and moire-dm-settings, and shows "Waiting for
  your password" meanwhile.

## Authenticating: the helper, weighed

Polkit only accepts `AuthenticationAgentResponse2` from root. So something that runs as root
must check the password and tell polkit. The choices:

| Option                                                   | For                                                                                                                       | Against                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **A. Stock helper over its socket (recommended)**        | Upstream's sanctioned path; small C, already in the image; socket-activated, not setuid; no CLI spawn; no Moire root code | A line-based text protocol; one PAM stack (`polkit-1`) that Moire configures but doesn't drive                                   |
| B. Stock helper, spawned setuid                          | Works on polkit older than 126                                                                                            | A setuid binary and a spawned program, both against Moire's rules; NixOS already ships the socket form                           |
| C. Moire's own root responder (`@moire/sys/pam` + D-Bus) | Full control: byte framing, Moire's throttle inside the root side, other PAM factors later                                | New root code; a root Node process on the system bus, which moire-dm deliberately avoided; duplicates a reviewed upstream helper |
| D. Replace polkitd                                       | —                                                                                                                         | Every system daemon Moire uses (logind, NetworkManager, UDisks, AccountsService, timedated) asks polkitd                         |

**Recommendation: A.** It is the only option that adds no privileged Moire code, and the
compositor talks to it over a socket with `node:net`. "Build our own" applies when an upstream
boundary blocks a feature, and this one doesn't yet. C is the fallback if it does: the two
plausible triggers are fingerprint or security-key prompts the line protocol can't carry, and a
password containing a newline.

The task's wording says "setuid helper". On this image the helper is not setuid:
[removable-drives.md](removable-drives.md) records "packaged helper binaries without setuid
permissions", and the units Moire disables are `polkit-agent-helper.socket` and
`polkit-agent-helper@.service`. Option A turns those two back on. `pkexec` stays off.

### The helper protocol

Pinned against polkit 127, the version in the image (nixpkgs `7fc6f2c`); see "Pinned against
polkit 127" below for how.

1. Connect to `/run/polkit/agent-helper.socket`. systemd starts one helper per connection
   (`Accept=yes`), with the connection as its stdin and stdout.
2. Write the account name and a newline, then the cookie and a newline. A cookie is
   `<n>-<32 hex>-<n>-<32 hex>`.
3. The helper takes the agent's uid and a pidfd from the socket (`SO_PEERCRED`, `SO_PEERPIDFD`),
   not from anything the agent says, and runs PAM service `polkit-1` for the named account. On
   the image that stack is `pam_unix` alone: one secret prompt.
4. It sends lines: `PAM_PROMPT_ECHO_OFF <text>`, `PAM_PROMPT_ECHO_ON <text>`, `PAM_ERROR_MSG
<text>`, `PAM_TEXT_INFO <text>`, and finally exactly `SUCCESS` or `FAILURE`. The text is
   C-escaped, so a line never holds a raw newline.
5. The agent answers a prompt with the answer bytes and a newline. The helper reads the answer
   with `fgets` into 512 bytes, so 510 bytes and the newline are the most it takes whole.
6. On success the helper itself tells polkit (`AuthenticationAgentResponse3`, with the agent's
   pidfd and uid), then writes `SUCCESS`, waits 100 ms and exits. The agent only learns the
   outcome. polkitd accepts the response only for a cookie of that uid's agent and an identity
   it offered.
7. A wrong password ends the conversation with `FAILURE`. The next try is a new connection with
   the same cookie, which stays valid until `BeginAuthentication` returns.

**The helper's stderr.** Upstream's unit leaves stderr on the socket (systemd's
`StandardError=inherit`), so the helper's own diagnostics arrive as lines before `FAILURE`:
`polkit-agent-helper-1: pam_authenticate failed: <localized text>` for a wrong password, and
others (`pam_acct_mgmt failed`, `error response to PolicyKit daemon`) for the rest. Upstream's
own agents treat such a line as unknown and fail. NixOS sets `StandardError=journal` on the
unit for that reason, so on the image the socket carries `FAILURE` alone. The client handles
both:

| The stream after an answer                           | Verdict       |
| ---------------------------------------------------- | ------------- |
| `SUCCESS`                                            | `accepted`    |
| `FAILURE` alone (the image)                          | `rejected`    |
| `pam_authenticate failed` diagnostic, then `FAILURE` | `rejected`    |
| Any other helper diagnostic, then `FAILURE`          | `unavailable` |
| `FAILURE` before any prompt was answered             | `unavailable` |

On the image, a failure that isn't about the password (an expired account, a cookie polkitd no
longer knows) is therefore shown as "That password didn't work". The throttle and the prompt's
timeout bound it, and the journal has the helper's reason.

Moire's rules on top:

- **Bytes only.** The answer is written from the entry buffer as a `Buffer` and wiped when the
  write completes. It is never a string.
- **No newline or NUL in an answer**, and at most 510 bytes (the helper's limit, above; the
  prompt's own buffer is 512). Enter submits and `keyText` never yields a newline, so this only
  refuses pasted or synthetic input. Such an answer is `rejected` without a connection.
- **Only secret prompts are answered**, and only one per conversation. A visible prompt (a
  one-time code, a new-password dialogue for an expired account) or a second secret prompt ends
  the attempt with "can't be checked here". Version 1 is passwords only.
- **Strict reader.** Lines over 1 KiB, anything that is not one of the four `PAM_` keywords,
  `SUCCESS`, `FAILURE` or a `polkit-agent-helper-1: ` diagnostic, or anything after the verdict
  close the connection and count as unavailable. Nothing from the stream is shown, logged or
  kept.
- **Account names** match moire-dm's pattern. The cookie is passed through as opaque printable
  ASCII of at most 128 bytes.
- **Deadlines:** 10 s to connect and get the first prompt, 30 s for a verdict.

### Pinned against polkit 127

Phase 1 ran polkit 127 from the image's nixpkgs pin in a container: the real `polkitd`, a
system `dbus-daemon` loaded with polkit's own bus policy, and the real
`polkit-agent-helper-1 --socket-activated` with PAM (`pam_unix`), driven first by upstream's
`pkttyagent` and `pkcheck`, then by Moire's helper client. The container has no systemd or
logind, so the socket was served inetd-style by `socat` (the accepted connection as the
helper's stdin, stdout and stderr), and those two parts were read from source instead.

| Fact                                                                                                                                 | How                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `BeginAuthentication(sssa{ss}sa(sa{sv}))`: action id, message, icon name, details, cookie, identities                                | Live (`dbus-monitor`, and Moire's D-Bus code)          |
| `details` holds `polkit.caller-pid` and `polkit.subject-pid` as decimal strings, plus the mechanism's own                            | Live; source for the absent-pid cases                  |
| Identities arrive as `("unix-user", {"uid": u})`, groups already expanded; uid 0 when there is no admin                              | Live; source for the fallback                          |
| The helper's line protocol, in bytes, for a wrong and a right password; the same cookie works for a retry                            | Live (`strace` of the helper, Moire's client)          |
| The helper refuses an identity polkitd did not offer and a cookie it does not know (`FAILURE`)                                       | Live                                                   |
| An empty return after `SUCCESS` authorizes; `Error.Cancelled` gives `polkit.dismissed`; `Error.Failed` refuses, even after `SUCCESS` | Live (`pkcheck`)                                       |
| A second registration for one subject: `Error.Failed`, "An authentication agent already exists for the given subject"                | Live                                                   |
| The bus refuses agent-interface calls from anyone but `polkituser` (`AccessDenied`), even the same user                              | Live                                                   |
| A `unix-process` agent registered by any process of the user receives that process's requests                                        | Live; outranks session agent upstream; patched (OQ 10) |
| `unix-session` registration: subject form, "the caller must be in that session", one agent per session                               | Source (no logind in the container)                    |
| The unit's stdio (`StandardInput=socket`, `StandardOutput=socket`, stderr inherited upstream, journal on NixOS)                      | Source and the evaluated NixOS module                  |
| The helper is not setuid: mode 0555 in the store, no `polkit-agent-helper-1` wrapper, `polkit-1` PAM service present                 | Live `ls`; the evaluated NixOS module                  |

Corrections this made to the design: the answer limit (510 bytes, not 512); the helper's
diagnostics on the socket; the subject pid, not the caller's, names the requester; polkitd
expands groups, not the agent; no vendor in the request; and a session agent does not exclude
per-process agents.

The image's polkitd is no longer stock polkit 127: it carries
`nix/patches/polkit-process-agent-fallback.patch` (open question 10), which changes only the
agent lookup in `src/polkitbackend/polkitbackendinteractiveauthority.c`. The patch was checked
against the exact source nixpkgs `7fc6f2c` fetches (`polkit-org/polkit` tag `127`, NAR hash
`sha256-YTugETy0rqu/bv53jV1UeGqSK79bRXR52EJNcTblvzo=`). `nix/moire-settings-services.nix`
asserts `pkgs.polkit.version == "127"`, so a nixpkgs bump that moves polkit fails evaluation
until the patch is re-reviewed. Nothing in the table above depends on the lookup order except
the per-process row.

## Policy changes

The deny-all model stays: `00-moire-*.rules` allow, `01-moire-deny-unapproved.rules` denies the
rest. The agent adds a third answer for chosen actions.

- **New file** `nix/moire-admin.rules` (`00-moire-admin.rules`, built): for an explicit list of
  action ids (two: `org.moire.accounts.administer` and `org.moire.dm.set-autologin`) it returns NO for the greeter account (`greeter`, by name or group; moire-dm's
  pre-login account) and for any subject not in an active, local session, then
  `polkit.Result.AUTH_ADMIN` for everyone else but root, who keeps stock authority. Apart from
  the greeter it does not look at the subject's groups, so a standard user is asked too and an
  administrator answers. `moire-settings-services.nix` installs it next to
  `00-moire-settings.rules`; `moire-dm.nix` asserts it is present.
- **Phase 4 moved exactly two actions into it:** `org.freedesktop.accounts.user-administration`
  and `org.moire.dm.set-autologin`. Their YES rules for `wheel` are deleted, and with it the
  whole of `nix/moire-dm.rules` (`00-moire-dm.rules`), which held nothing else. "One prompt per
  change" then added `org.moire.accounts.administer` and took `user-administration` out again
  (below).
- **Who may answer:** `security.polkit.adminIdentities`, which must yield `wheel`. That is the
  NixOS default (`[ "unix-group:wheel" ]`), and `moire-settings-services.nix` asserts it.
- **`AUTH_ADMIN`, never `AUTH_ADMIN_KEEP` (decided 2026-10-31): every check asks.** Phase 4
  shipped `AUTH_ADMIN_KEEP` to match the old 5‑minute unlock. The R65 VM run (2026-10-30) showed
  polkit keeps that authorization for the whole session, not the process that asked: after
  `testtwo`, a standard user, answered with the admin password once, a second
  `busctl … CreateUser` from a different process in the same session created a user with no
  prompt. Any program in that session held the admin authorization for 5 minutes. The cost was
  two or three prompts for one Settings change, since the management service's own check and
  each AccountsService call it made were separate checks. moire-accounts removed that cost
  ("One prompt per change").
- **`org.moire.accounts.administer`** (moire-accounts, `nix/moire-accounts.policy`) is in
  `00-moire-admin.rules` with the same answers as automatic login.
- **`org.freedesktop.accounts.user-administration` is refused to sessions** (decided
  2026-10-31). `nix/moire-accounts.rules` (`00-moire-accounts.rules`, ordered before
  `00-moire-admin.rules`) is the only rule that decides it: YES for the `moire-accounts` system
  account, nothing for root (stock authority), and NO for every other subject, with no prompt:
  administrators and standard users, active and local or not, the greeter, and every other
  system account (moire-dm-settings and moire-dm-front included; neither calls AccountsService's
  write methods, and the greeter's user list only reads). Before, a session process (`busctl`,
  any app) calling `CreateUser` got the administrator prompt and could pass it off as the
  system's request; nothing in Moire made that call any more (Settings goes through
  moire-accounts), so it is now refused outright. The user's own changes are other actions and
  are unchanged: `change-own-user-data` is YES in `00-moire-settings.rules`, and
  `change-own-password` stays ungranted (Moire uses `passwd`).
- **The greeter is refused in the rule** (decided 2026-10-31). A greeter session has no agent,
  and moire-dm-settings refuses accounts below uid 1000, but the rule no longer relies on either:
  it never hands the greeter an `AUTH_*` answer.
- **Everything granted YES today stays YES** (time zone, Wi‑Fi, suspend, the inhibitors, own
  name and avatar). No prompt appears at login or for everyday actions.
- **Candidates for later, each needing its own approval:**

  | Action                                                | Unlocks                                   |
  | ----------------------------------------------------- | ----------------------------------------- |
  | `timedate1.set-time`, `set-local-rtc`                 | A manual clock in Settings                |
  | `NetworkManager.settings.modify.system`               | Editing shared profiles, no per-user copy |
  | `hostname1.set-static-hostname`                       | A computer name in Settings               |
  | `udisks2.encrypted-unlock`, `filesystem-mount-system` | Encrypted and internal drives in Files    |
  | `login1.*-multiple-sessions`                          | Restart while someone else is signed in   |
  | `systemd1.manage-units`                               | `systemctl` and `run0` from the terminal  |

- **Image:** `moire-settings-services.nix` enables the helper's socket and service, and the
  assertion becomes "pkexec stays off; the helper socket is on; `polkit-1` has a PAM service".
- **`scripts/test-settings-policy.mjs`** (built) evaluates the new files and asserts: the three
  actions return `auth_admin` for active local users, in `wheel` or not, and `no` from the same
  rule for the greeter (by name or group, active or not) and for inactive or remote subjects;
  the file names exactly those two ids and answers only `NO` and `AUTH_ADMIN`; no Moire rule
  returns a `_KEEP` result; no other Moire rule mentions them; `user-administration` is decided
  only by `00-moire-accounts.rules`: `no` for every session user (in `wheel` or not, active and
  local or not), the greeter, other system accounts and look-alike names or the group, `yes` for
  `moire-accounts` alone (nothing else for it), and root falls through; the user's own actions
  are not decided there; the files are listed in polkitd's order; the
  moire-accounts unit, action and bus policy are as described; everything YES before is still
  YES; the deny fallback still catches a fixture YES.

## Settings' password sheets

Settings has seven sheets on Users & Login (`apps/core/settings/src/pages/users.tsx`) and a
Wi‑Fi password sheet. They do two different jobs.

| Sheet                                   | Job           | With the agent                                                       |
| --------------------------------------- | ------------- | -------------------------------------------------------------------- |
| Unlock (administrator actions)          | Authorization | **Removed.** The agent's prompt appears when the action is requested |
| Automatic login (password, then switch) | Authorization | **Removed.** The switch calls the service; the agent prompts         |
| Change your password (current, new)     | Data entry    | Stays. `passwd`'s PAM stack checks the current password              |
| Add user, set another user's password   | Data entry    | Stays for the new password. Authorization comes from the agent       |
| Delete user, account type, name         | Confirmation  | Stays. Authorization comes from the agent                            |
| Wi‑Fi password                          | Data entry    | Stays                                                                |

**Can the authorization sheets be replaced? Yes. Should they? Yes.**

- **It closes the stated residual risk.** Today any process of an administrator gets a YES. With
  `AUTH_ADMIN`, polkit itself requires a password typed into a prompt no client can draw, for
  every check; nothing is kept for the session.
- **The password stops crossing the session bus.** Today `authenticate(password)` carries it as
  a JS string in a D-Bus body, which any process of the user can read with `BecomeMonitor`
  (settings-redesign.md says so). The agent's path is compositor buffer → helper socket.
- **Settings is an ordinary client.** Any app can draw a sheet that looks like Settings'. Only
  the compositor can draw the protected layer.

What changed in code (Phase 4, built):

- **Management service:** `org.moire.Accounts1` and `org.moire.LoginSettings1` dropped the
  per-connection unlock (`Authenticate`, `Lock`) and the `auth_required` code. A cancelled prompt
  maps to a new fixed code, `cancelled`, which Settings shows as nothing at all. Since "One
  prompt per change" neither administrator path is there: Settings calls moire-accounts and
  `moire-dm-settings` itself, with D-Bus's `ALLOW_INTERACTIVE_AUTHORIZATION` flag and a 170 s
  timeout, and `org.moire.LoginSettings1` is gone.
- **Telling a dismissal from a refusal:** AccountsService answers both with `PermissionDenied`.
  Phase 4 had the management service ask polkit itself first, then call AccountsService, whose
  own checks asked again. That is replaced by moire-accounts ("One prompt per change"), which
  asks polkit once and reads `polkit.dismissed` from that one reply.
- **`moire-dm-settings`:** checks `org.moire.dm.set-autologin` with interaction allowed, for a
  caller that set the D-Bus flag (140 s, withdrawn on timeout), and reports a dismissal as the
  error `cancelled`. A caller without the flag gets polkit's answer with no prompt.
- **Refused unseen:** a request the prompt turns away without showing (cool-down, flood pause,
  full queue, at once or after waiting in the queue) also reaches the mechanism as
  `polkit.dismissed`; polkitd carries no reason. After a dismissal Settings, being the subject,
  asks the compositor why (`TakeDismissal`, "Why a request was dismissed" above): `refused`
  becomes
  the code `refused`, with the sentence "Password requests are paused. Try again in a little
  while."; anything else, or no answer, stays `cancelled`. Nothing is guessed from timing. (Before
  this the service called any dismissal under 400 ms `refused`, which missed refusals after
  queueing and misreported a prompt the lock closed at once.)
- **Timeouts, innermost first:** prompt 120 s idle; `moire-dm-settings` and moire-accounts →
  polkit 140 s; Settings → moire-accounts and `moire-dm-settings` 170 s. `@moire/dbus` now
  allows calls up to 180 s (it capped at 120 s).
- **Clients:** `authenticate()`, `lock()` and `policy.unlockSeconds` are removed from
  `accounts-settings.ts` and its fake, and `canChange` from the login status (anyone at the seat
  may ask). The fakes take a `prompt` that stands in for the system's. `unix_chkpwd` stays for
  the lock screen only.
- **Settings:** the Unlock row and sheet and the Automatic login password sheet are gone. Rows
  and sheets say "Waiting for your password" while a call is pending ("Waiting for an
  administrator's password" for a standard user, whose rows also say "Needs an administrator's
  password"). `cancelled` leaves everything as it was. `refused` says the service's sentence
  in muted text on the row or under the sheet's form for 8 s, never as an error banner.
- **Who asks:** account changes and automatic login come from Settings' own process, so the
  prompt names Settings. A rogue process can call moire-accounts or `moire-dm-settings` too, and
  is then named itself; it can no longer hide behind the management service. Calling
  AccountsService's administrator methods directly is refused with no prompt. See open
  question 5.

The data-entry sheets keep a weakness the agent doesn't address: a new password is a JS string
in Settings and in a D-Bus body. A compositor-owned "secure field" for data entry is possible
with the same layer, and is left as open question 6.

## One prompt per change

Built 2026-10-31 (Josh approved the recommended design). With `AUTH_ADMIN` every polkit check
asks, and one Settings change used to make two or three checks: the management service's own,
then AccountsService's for each call. Now each change is one check.

| Settings change                           | Prompts before | Prompts now | Requested by (prompt) |
| ----------------------------------------- | -------------- | ----------- | --------------------- |
| Add a user, with a password               | 3              | 1           | Settings              |
| Delete a user                             | 2              | 1           | Settings              |
| Account type                              | 2              | 1           | Settings              |
| Another user's password                   | 2              | 1           | Settings              |
| Another user's name or picture (API only) | 2              | not offered | —                     |
| Automatic login                           | 1              | 1           | Settings              |
| Your own name, picture or password        | 0              | 0           | —                     |

**moire-accounts** (`apps/system/management-service/src/account-admin.ts`, entry
`account-admin-entry.ts`; `org.moire.AccountAdmin1` at `/org/moire/AccountAdmin1` on the system
bus):

- **Methods:** `AddUser(s username, s realName, b administrator, ay password) → u`,
  `DeleteUser(u uid, b removeFiles)`, `SetAccountType(u uid, b administrator)`,
  `SetPassword(u uid, ay password)`. Errors are `org.moire.AccountAdmin1.Error.<code>` with fixed
  sentences (`invalid`, `permission`, `cancelled`, `busy`, `unavailable`, `failed`).
- **One check, then the calls:** each method checks its arguments, then asks polkit once:
  `CheckAuthorization` for `org.moire.accounts.administer`, subject `system-bus-name` of the
  caller, `AllowUserInteraction` only if the caller set D-Bus's
  `ALLOW_INTERACTIVE_AUTHORIZATION`, 140 s and withdrawn after that. If authorized it makes the
  AccountsService calls as itself, never with interaction: `nix/moire-accounts.rules` gives its
  account `user-administration`, so they can't raise a second prompt. A method can't ask twice.
- **Who the subject is:** Settings calls moire-accounts itself
  (`packages/system-management/src/account-admin.ts`), so polkitd takes the subject's pid from
  the system bus daemon for Settings' connection. The prompt names Settings, the compositor
  records a dismissal under Settings' pid, and Settings reads it with `TakeDismissal` on its
  session-bus connection (same process). `refused` and `cancelled` are reported as before.
  The management service is no longer in the path: `org.moire.Accounts1` keeps the list and the
  session user's own name, picture and password, and refuses another account's name or picture.
- **Automatic login, the same way:** Settings calls `moire-dm-settings`
  (`org.moire.LoginManager1` on the system bus, `packages/system-management/src/login-settings.ts`)
  itself, for the status and for `SetAutomaticLogin`, with the interactive flag. Its bus policy
  already lets anyone call it (`nix/moire-dm-dbus.conf`); its own checks are the gate: the
  caller's uid from the bus daemon (people's accounts only, never the greeter) and one polkit
  check for `org.moire.dm.set-autologin` about the calling connection. The prompt names
  Settings, and Settings asks `TakeDismissal` after `cancelled`, as for account changes. The
  management service's `org.moire.LoginSettings1` is removed.
- **What it refuses before asking:** callers below uid 1000 (the greeter among them; the bus
  policy also denies the greeter), accounts that aren't people's (uid < 1000, system, non-local,
  `nologin`), the caller's own account (delete, password), the last administrator (delete,
  demote), a taken or invalid name, a password under 8 characters, over 256 bytes, with a line
  break or NUL, or not valid UTF-8. One change at a time per caller uid (`busy`).
- **Passwords:** `ay`, never a string in moire-accounts: checked as bytes, hashed with SHA-512
  crypt (`$6$rounds=65536$`, `sha512-crypt.ts`, plain `node:crypto`; about 110 ms under
  `--jitless`), and the buffer wiped when the call ends. AccountsService gets only the hash.
  Adding a user hashes before `CreateUser` and deletes the account again if `SetPassword` fails.
  Log lines are `moire-accounts: code=<code>` with uids and the account type only.
- **Unit** (`nix/moire-settings-services.nix`, package `nix/moire-accounts-package.nix`, a
  bundled single file run with moire-dm's V8 flags): its own system account `moire-accounts`,
  never root; the hardening of `moire-dm-settings` (no capabilities, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateNetwork`, `AF_UNIX` only, `@system-service ~@privileged`,
  `MemoryDenyWriteExecute`); only that account may own the name (`nix/moire-accounts-dbus.conf`).

**Why this is not weaker:**

- **It grants nothing new to callers.** Any process of an active, local user could already call
  AccountsService and get a prompt per call. moire-accounts gives the same caller one prompt for
  one change, after the same `AUTH_ADMIN` rule, and refuses more than AccountsService does.
  Calling AccountsService directly is now refused with no prompt at all.
- **Nothing is kept.** The authorization is used for the calls of the method that asked, inside
  moire-accounts, and the next change asks again. Polkit's session-wide kept authorization (the
  R65 finding) is still never returned.
- **The prompt names the real requester.** The subject is the caller's own bus connection, as
  the bus daemon reports it, for account changes and automatic login alike. A process that is
  not Settings is named as itself. Before this, any process could ask the management service and
  be shown as "Moire Management".
- **The new YES is narrow.** It is for one action and one system account that nothing else runs
  as (an assertion keeps it a system account with an empty capability set). polkitd reads the
  account from the bus daemon. The rule test checks look-alike names and the group get nothing.
- **Not root.** A root mechanism would also have been possible (root passes polkit), but it
  would need a larger trust base, and AccountsService reads an icon file as its caller, so a
  root caller can read any file. moire-accounts never sets icons.

**What it doesn't change:** compromising moire-accounts itself would let an attacker administer
accounts (and so reach root), as compromising any account mechanism would. Its whole input is
four D-Bus methods with fixed signatures, and it holds nothing else.

## Threat model

**Assets:** administrator passwords in transit, the decision to authorize an action, and the
user's trust that a password prompt is the system's.

**Protected against:**

- **A client drawing over or beside the prompt.** The frame has no client content, and the prompt
  is composited by the compositor.
- **A client reading the password as it is typed.** Keys reach no Wayland client and no X client
  while the prompt is up. The screen shows dots, and captures are refused.
- **A process becoming the session's agent.** The compositor registers before any client
  starts, accepts calls only from polkitd, and reports loudly if it finds another agent.
- **A per-process agent taking the session's requests.** Polkit also lets any process register
  an agent for a single process of the same user (`unix-process`, what `pkttyagent --process`
  does). Upstream, such an agent outranks the session's unless it registered as a fallback, so
  a process could register one for Settings or the management service and draw its own
  password window for their requests. Moire's polkitd carries a patch
  (`nix/patches/polkit-process-agent-fallback.patch`, applied through `security.polkit.package`
  in `nix/moire-settings-services.nix`) that makes every `unix-process` agent a fallback: in
  `get_authentication_agent_for_subject()` the session's agent is chosen first, and a process
  agent only when the session has none or the subject has no session. Registration is
  unchanged, so `pkttyagent` still works over ssh and outside logind sessions. The patch is
  reviewed against polkit 127 only; an assertion fails the build on any other version until it
  is re-reviewed (open question 10).
- **A process borrowing another's name.** Account changes and automatic login are asked about
  Settings' own connection (moire-accounts, moire-dm-settings), so a process can't get its
  request shown as Settings' or the management service's. moire-accounts' YES for
  AccountsService is for its own system account only, used inside one call after one prompt;
  every session gets NO for it, so no process can raise an AccountsService prompt at all.
- **A process answering for the user.** Only the root helper can tell polkit an authentication
  succeeded, the helper takes the agent's uid from the kernel, and a successful answer needs the
  password. A process that connects to the helper socket itself gains nothing without one.
- **Guessing.** pam_unix's delay (about 2 s) applies inside the helper. The agent adds the lock
  screen's rule: five wrong in a row pause checks for a minute, counted per identity, across
  requests.
- **A flood of prompts.** One visible, three queued. After a cancel, the same executable asking
  for the same action is refused without a prompt for 2 s, and its requests already waiting
  are refused with it. Three cancels of one requester within two minutes, whatever it asked
  for, refuse that requester for 5 minutes, for every action, including its requests already
  waiting, and raise one notification naming the program; a waiting request refused by a cancel
  counts as one. The requester is the compositor's launch the process belongs to, else its
  executable (as for sleep blockers): never the pid, which is reused, and not the executable
  alone for launched services, since every Moire service and app is `node`. Other programs are
  unaffected. (The short refusal was 30 s until the r64 VM run: a person who cancelled by
  mistake and clicked again got nothing, with no message. Until the R65 VM run the 5 minutes
  were per action too, so the management service could still ask to add a user after a flood
  of automatic login prompts.)
  A requester that goes away, a timeout and the lock start no cool-down. Escape always works,
  and Super+L still locks, so a looping requester can't hold the desktop.
- **A malformed or hostile helper stream.** Bounded lines, a fixed keyword set, deadlines, and
  nothing from the stream shown to the user.
- **Misleading action text.** Shown as plain, bounded text with the action id one click away.

**Xwayland:** Moire runs one shared, rootless Xwayland with its own window manager
(`packages/core/src/xwayland.ts`, `xwm.ts`) and no X security options. Inside it, X11's rules
hold: any X client can log keys typed into another X window, inject input with XTEST, read other
X windows' pixels and read X selections.

- **All X apps are one trust zone.** The agent treats "an X app asked" as "some X app asked".
- **The prompt is out of X's reach.** X clients can't see or overlay the protected layer, and
  Xwayland receives no keys while it is up. A password typed into the prompt is not visible to
  any X client.
- **Secret entry never goes through an X window.** No Moire prompt is an X client, and none
  falls back to one.
- **Naming the requester:** from the kernel pid polkit reports, never from `_NET_WM_PID`, which
  an X client sets itself. An X requester is flagged "runs under X11".
- **What X can still do:** an X client can inject input into another X app to make _it_ request
  an action, and the prompt will then name that app truthfully. The password is still required.
  No authorization is kept (`AUTH_ADMIN`), so each further action asks again.

**Not protected against:**

- **A look-alike drawn by a client when no real prompt is open.** A fullscreen client can paint
  something that resembles the prompt and collect what is typed into it. No desktop prevents
  this by pixels alone. The mitigation offered is a reserved key that only the compositor sees
  (open question 3).
- **Code running as the user that controls the requesting app.** If malware drives Settings, the
  prompt names Settings, and it is Settings asking.
- **The agent's own memory.** As for the lock screen: the entry buffer and the socket write are
  wiped, but Node's stream layer and the kernel socket buffer hold copies Moire can't wipe.
  Marking the compositor non-dumpable (see secret-service.md) keeps same-user debuggers out.
- **Root, polkitd, the helper and the PAM configuration.** They are trusted.
- **Polkit's `active` being UID-wide** (removable-drives.md). A background process of the
  signed-in user counts as active. With `AUTH_*` results that matters less than with YES, since a
  password is still needed.

### Secrets in JS memory

**Path:** evdev → `keyText` → the prompt's 512-byte buffer → a copy for the write → the helper
socket. Each copy Moire owns is wiped: the buffer on submit, cancel, identity change, timeout and
lock; the write copy when the write completes or the socket errors.

The compositor never logs the action's details, the cookie or the answer. Log lines are
`polkit-agent: code=<code> action=<id>` from a fixed set of codes.

## Follow-ups (planned, not part of this work)

- **Xwayland hardening:** untrusted-client or SECURITY-extension mode, and XTEST and RECORD off
  where nothing needs them.
- **Clipboard policy:** the Wayland clipboard reaches X only while an X window has focus.
- **Per-app Xwayland instances:** the long-term isolation, so that X apps stop being one zone.
- **Descriptor passing in `@moire/dbus`**, which would retire the `systemd-inhibit` child.

## Phases

| Phase | Work                                                                                                                                               | State                 |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1     | This design. Pin the helper protocol, the `details` keys and the bus policy against polkit 127 in a container                                      | Done                  |
| 2     | `secure-prompt.ts` in core: state machine, composition, seat gates, fallback painter, capture refusal; the shell's prompt view; portable smokes    | Built; VM run pending |
| 3     | The agent: registration, sender check, queue, chooser, helper client; the helper units on in the image; fake-helper and private-bus smokes         | Built; VM run pending |
| 4     | `00-moire-admin.rules` with the two actions; management service and `moire-dm-settings` go interactive; Settings loses the two sheets; policy test | Built; needs 5        |
| 4b    | One prompt per change: moire-accounts; Settings calls it and moire-dm-settings itself; user-administration NO for sessions                         | Built; needs 5        |
| 5     | VM run (below)                                                                                                                                     | Josh's                |
| 6     | Further actions from the candidate table, one approval each                                                                                        | Needs approval        |

Phase 2 is shared with the keyring and can start first.

## Verification

Each smoke runs on its own with `pnpm exec tsx <file>` from its package, like the lock's.

- **`packages/core/src/secure-prompt.smoke.ts`:** entry, wipe on every exit, arming delay, held
  keys, timeout, queue order and limit, the cancel cool-down and the flood, the lock holding the
  queue, consent, stale verdicts, the password in no view or log.
- **`packages/core/src/secure-prompt-screen.smoke.ts`** (portable `CompositorServer`, fake
  clients, recording renderer): no client colour in the frame, a byte-identical frame when
  clients redraw or map, no key or pointer event to any client or to Xwayland, the fallback
  prompt on a throwing UI and "failed" when the fallback throws too, focus back and the Enter
  swallowed, lock and Super+L cancelling the prompt, capture refused, the verification key in
  each of its three cases, two outputs, a greeter refusing.
- **`apps/system/compositor/src/polkit-agent.smoke.ts`** (private `dbus-daemon`, a fake
  authority and logind, a fake helper on a socket, a fake secure prompt): registration before any
  spawn; calls from a non-authority refused; the answer on the socket only as bytes; wrong, then
  right; a visible prompt refused; oversized and unknown lines; `CancelAuthentication`; an agent
  already registered; a new polkitd and a dropped bus; the throttle; identities; every reply; the
  log's fixed form; naming the requester; the dismissal reason kept for the subject pid only,
  before polkitd hears the answer.
- **`apps/system/compositor/src/prompt-outcomes.smoke.ts`:** `TakeDismissal` answers only the
  subject's own pid (from the bus daemon), once, within 60 s, not after the pid is reused; the
  client trusts only a known reason.
- **`apps/system/management-service/src/account-admin.smoke.ts`** (Settings' client →
  moire-accounts → fake AccountsService, fake polkit and compositor on a private bus): one
  polkit check per change, about Settings' connection, with interaction only when the caller
  waits; AccountsService called by moire-accounts alone, never interactively; arguments checked
  before the prompt; `refused`/`cancelled` from the compositor's answer to Settings' process
  only; another caller named as itself; per-person busy; the check withdrawn on timeout; the
  rollback; hashes only at AccountsService, buffers wiped, nothing secret logged.
- **`apps/system/management-service/src/accounts-settings.smoke.ts`:** own name, picture and
  password with no polkit check; another account's name or picture refused; the old admin
  methods and `org.moire.LoginSettings1` gone.
- **`apps/system/management-service/src/autologin-client.smoke.ts`** (Settings' client → a fake
  moire-dm-settings and compositor on a private bus): one call, so one polkit check, per change,
  from Settings' own connection with interaction allowed; the status parsed strictly (on for
  you, for someone else, off, malformed); refused at once and after queueing is `refused`;
  cancelled, locked and no compositor are `cancelled`, asked on Settings' own session
  connection; fixed sentences only; one change at a time; no moire-dm-settings is "not
  available" with no call. `apps/system/moire-dm/src/login-manager.smoke.ts` covers the
  service's own checks.
- **`apps/system/compositor/src/polkit-helper.smoke.ts`** (a fake helper on a socket): the
  verdict table above, the strict reader, answer limits, deadlines, cancelling, a missing socket,
  and the write copy wiped.
- **`scripts/test-settings-policy.mjs`:** as above.
- **`packages/shell/src/secure-prompt/secure-prompt.smoke.tsx`:** the prompt view at 1020×700
  and 640×650, light and dark, scale 1 and 1.5, each state with its fixed sentence, the chooser
  with one, two and eight identities, consent, the notice, and pointer dispatch by focusId. Set
  `MOIRE_SECURE_PROMPT_DIR` for PNGs. Visreg scenes `polkit-prompt`, `polkit-prompt-wrong`,
  `polkit-prompt-chooser`.

## VM test plan

Image with the helper socket on, `moire-pam-test` (standard) and `moire-admin-test` (admin).

1. Registration: the journal has `polkit-agent: code=registered`, and
   `systemctl status polkit-agent-helper.socket` is active. No `polkit-agent-helper-1` file is
   setuid.
2. As `moire-admin-test`, Settings › Users & Login › Add user: Moire's prompt appears over an
   obscured backdrop with no window visible, names Settings, and preselects the admin. A 60 fps
   recording shows no desktop frame between the click and the prompt.
3. Type the password with a terminal focused beforehand: nothing reaches the terminal. Check
   after closing the prompt.
4. Wrong password: shake, "That password didn't work", the prompt stays. Five wrong: "Too many
   attempts" for a minute.
5. Right password: the user is created, with its password, after that one prompt and no second
   one. A second admin action prompts again at once, and so
   does `busctl … AddUser` to moire-accounts from a terminal in the same session (no kept
   authorization; that prompt names `busctl`, not Settings). `busctl … CreateUser` straight to
   AccountsService, as the admin and as `moire-pam-test`, is refused at once with no prompt
   (`pkcheck --action-id org.freedesktop.accounts.user-administration --process $$
   --allow-user-interaction`: not authorized, no prompt). Changing your own name and picture in
   Settings still works with no prompt. As the greeter, the rule answers NO (`pkcheck` as
   `greeter`: not authorized, no prompt).
6. Escape: the action is refused quietly, and Settings shows no error banner.
7. Leave the prompt untouched for 2 minutes: it closes and the action is refused.
8. As `moire-pam-test`, the same action: "An administrator's password is needed" with
   `moire-admin-test` listed (or a refusal, per open question 2).
9. Automatic login: the switch raises one prompt, with no Settings sheet, and it says
   "Requested by Settings". Cancel it: nothing is said and the switch stays. The management
   service is not involved (`busctl --user introspect org.moire.SystemManagement1
   /org/moire/LoginSettings1` finds nothing).
10. From a terminal as the admin, an unlisted action (`systemctl restart polkit`): still refused
    with no prompt. The deny fallback holds.
11. Flood: a loop of ten `busctl` calls to moire-accounts (`org.moire.AccountAdmin1`) with
    interaction allowed. One prompt, three waiting, the rest refused. Cancel once: the three waiting are refused with it, which
    makes a flood, so no new prompt for 5 minutes. One notification names the program.
    Settings' own prompts still appear meanwhile. Then cancel automatic login three times
    within two minutes: Add user is refused too, with no prompt and no second notification.
12. Super+L with a prompt open: the lock screen appears, the request is refused, and no prompt is
    visible after unlock.
13. X11: with `xev` focused in Xwayland, raise a prompt and type. `xev` records nothing. Run an
    XTEST injector (`xdotool type`) while the prompt is up: nothing is typed into it.
14. Screenshot shortcut while the prompt is up: refused.
15. Stop the helper socket in a test VM: the prompt shows "can't be checked right now" and the
    action is refused.
16. `journalctl -b | grep <password>` finds nothing.
17. Two outputs: the prompt follows the pointer's output and the other is black.
18. Super+Escape with a prompt open: the badge lights and the prompt says it is verified. With
    none open, over a fullscreen app with `wev` focused: the notice shows for 2.5 s with no
    window visible, and `wev` records Super but no Escape. On the lock screen: nothing.

## Open questions for Josh

1. **Helper.** Use the stock helper over its socket (A), or write Moire's own root responder (C)?
   _Recommended: A. Revisit only when a factor the line protocol can't carry is wanted._
2. **Standard users and administrator actions.** May a standard user get through by having an
   administrator type their password at the prompt?
   _Recommended: yes, for active local sessions, as macOS and GNOME do. It replaces "log out and
   in as the admin". The alternative is to keep the `wheel` check in the rule and show standard
   users no prompt._
   _Decided: yes (2026-10-11). Since 2026-10-31 every change asks (`AUTH_ADMIN`): the kept
   authorization the R65 VM run found session-wide is gone, so a standard user's one admin
   password no longer lends the whole session admin for 5 minutes._
3. **A reserved verification key.** Should one key combination be reserved so that only the
   compositor sees it: with a real prompt open it pulses the prompt's badge, with none it shows
   "No system password request is open"?
   _Decided: yes, Super+Escape (Ctrl+Alt+Delete is taken), built in Phase 2. It is the only
   real answer to look-alikes, and it costs one shortcut._
4. **How much desktop shows behind the prompt.** The obscured wallpaper with no windows (as
   proposed), or the dimmed desktop with windows visible?
   _Recommended: no windows. It is what makes "nothing a client draws is on screen" true, and it
   matches the lock screen. The cost is losing sight of the app that asked; the prompt names it._
5. **Who may ask the management service for admin actions.** Any process of the user (today), or
   only Settings, identified from the kernel?
   _Recommended: leave it open to the user's processes for now. The polkit prompt is the gate,
   and it appears for every caller. Revisit with the keyring's client identity work, which
   builds the same check._
   _Decided (2026-10-31): only Settings, from the kernel. Built by taking the management service
   out of the path: Settings calls moire-accounts itself, so polkit's subject is Settings' own
   connection and the prompt names it. Any other caller is named as itself ("One prompt per
   change"). Automatic login followed: Settings calls moire-dm-settings itself, and the prompt
   names Settings._
6. **A compositor-owned secure field for data entry** (new passwords, Wi‑Fi passwords), so those
   stop being strings in an app and on the bus.
   _Recommended: later, after both prompts ship. The seam is the same layer._
7. **Timeout.** 120 s idle.
   _Recommended: keep. Long enough to fetch a password manager; short enough that a forgotten
   prompt doesn't sit over the desktop._
8. **`pkexec`.** Keep it off?
   _Recommended: yes. It is setuid. `run0` covers the use without one, if
   `systemd1.manage-units` is approved in Phase 6._
9. **Fingerprint and security keys.** Out of scope for version 1?
   _Recommended: yes. Passwords only, as on the lock screen._
10. **Per-process agents** (found in Phase 1). Any process of the user can register a
    `unix-process` agent for another of the user's processes and take its prompts away from the
    compositor.
    _Decided (approved by Josh): Moire's polkitd treats every `unix-process` agent as a
    fallback, so the session's agent always wins and `pkttyagent` still works where no session
    agent exists (ssh, no logind session). It is the first root-side change in this design:
    `nix/patches/polkit-process-agent-fallback.patch`, pinned to polkit 127 by an assertion in
    `nix/moire-settings-services.nix`. See the threat model and "Pinned against polkit 127"._
11. **Ending the kept authorization on leaving the Users page.** Should Settings end the 5-minute
    authorization when the Users page closes?
    _Decided (2026-10-31): moot. No authorization is kept (`AUTH_ADMIN`), so there is nothing to
    end._
12. **Excluding the greeter explicitly.** Should `00-moire-admin.rules` refuse the greeter
    itself, rather than relying on the greeter having no agent and moire-dm-settings refusing
    uid < 1000?
    _Decided (2026-10-31): yes. The rule answers NO for the `greeter` account (name or group)
    and for any subject not in an active, local session, before the `AUTH_ADMIN` branch._
