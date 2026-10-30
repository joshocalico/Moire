# Moire keyring: the Secret Service

Status, 2026-10-11: **approved by Josh with every recommendation below; built after the polkit
agent, whose secure prompt it shares. Nothing is built yet.**

Moire has no keyring. Nothing owns `org.freedesktop.secrets`, so apps that store passwords
either fail, warn, or fall back to weak local storage. This document proposes Moire's own
implementation of the Secret Service API, with a security bar set above gnome-keyring and
KWallet.

Decisions this document asks for:

- **Build our own.** The D-Bus API is the compatibility layer. The file format, access control,
  prompts and unlock path are Moire's.
- **Two processes.** A hardened system service under its own uid (`moire-secrets`, the broker)
  holds the store and the keys. A small per-session front as the user owns the bus name and
  identifies clients from the kernel.
- **Per-app access control is a requirement**, not an option: items belong to the app that
  created them, and any other app needs consent given in the compositor's protected layer.
- **Unlock comes from moire-dm at login** as a derived value, never the password. The keyring
  locks with the screen and on suspend by default.

The protected prompt layer is shared with [polkit-agent.md](polkit-agent.md).

## Why

- **Third-party apps expect it.** None is in the image, but these are what people install:

  | Client                                                           | How it uses the API                       | Without a service                                                          |
  | ---------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
  | Chromium, Chrome, Brave, Electron apps (VS Code, Slack, Element) | libsecret; one "Safe Storage" key per app | Falls back to a fixed built-in key: cookies and passwords barely protected |
  | Firefox                                                          | libsecret for its OS key store only       | Logins use its own file either way                                         |
  | `git-credential-libsecret`                                       | libsecret                                 | Tokens in plain `~/.git-credentials`, or a prompt every push               |
  | `gh`, Docker's `secretservice` helper, other Go tools            | go-keyring; opens a `plain` session       | Tokens in plain config files                                               |
  | Python `keyring` / `secretstorage`                               | Direct D-Bus, DH session                  | A plaintext backend or an error                                            |
  | GNOME apps (Evolution, Online Accounts), `nm-applet`             | libsecret                                 | Not usable                                                                 |

- **Moire's own network secrets sit in plaintext.** "Moire runs no secret agent"
  (`network-manager.ts`, `network-vpn.ts`), so a user's Wi‑Fi copy, a WireGuard private key and
  an OpenVPN password are saved with flags 0: NetworkManager writes them unencrypted under
  `/etc/NetworkManager/system-connections`.
- **Moire owns PAM now.** moire-dm sees the login succeed, so it can unlock the keyring without
  a PAM module and without the password leaving it.

## Compared with gnome-keyring and KWallet

Read from upstream on 2026-10-11 (gnome-keyring `main`, KWallet `master`). Each row names the
file it comes from. "Unverified" means it is commonly reported but was not confirmed in source
for this document.

### gnome-keyring

| Weakness                                                                                                                                                | Source                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No per-app access control. `GetSecrets` and `SearchItems` go straight to the store. The only caller data kept is the bus name                           | `daemon/dbus/gkd-secret-service.c`                                              |
| Upstream's position: app isolation within a user "isn't architected"; "Application signing (for ACLs)" is listed as future work                         | GNOME wiki, GnomeKeyring/SecurityPhilosophy                                     |
| Cipher is AES‑128‑CBC. The key comes from iterated SHA‑256 over the password and an 8‑byte salt, which is not memory-hard                               | `pkcs11/secret-store/gkm-secret-binary.c` (`egg_symkey_generate_simple`)        |
| Integrity is an MD5 digest of the plaintext, encrypted with it. There is no MAC and no AEAD                                                             | Same file (`GCRY_MD_MD5`, `verify_decrypted_buffer`)                            |
| Metadata is in clear: keyring name, timestamps, item ids and types, attribute names, and a hash of every attribute value                                | `docs/file-format.txt`                                                          |
| `plain` sessions are open to every caller. The alternative is unauthenticated 1024‑bit DH with AES‑128‑CBC                                              | `daemon/dbus/gkd-secret-session.c`                                              |
| The PAM module copies the password into PAM data between authentication and session start, then writes it down a pipe to the daemon                     | `pam/gkr-pam-module.c` (`gkr_system_authtok`). It does wipe the copy afterwards |
| The login keyring stays unlocked for the whole session, through screen lock and suspend                                                                 | Unverified in source                                                            |
| The daemon runs as the user, with the store in the user's home, so the user's processes can copy the file and (where ptrace is allowed) read the daemon | Unverified whether it marks itself non-dumpable                                 |
| Outside GNOME Shell, the unlock prompt is an ordinary client window                                                                                     | Unverified in source                                                            |

### KWallet

| Weakness                                                                                                                                                        | Source                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The allow-list is keyed by an `appId` string the caller passes to `open()`. Nothing checks it against the calling process                                       | `src/runtime/kwalletd/kwalletd.cpp`                  |
| A KDE developer's own summary: "The application name can trivially be faked, and the 'allow/deny always' decision is simply stored in a plain text config file" | Volker Krause, kde-pim list, July 2012               |
| Its Secret Service side has no per-caller check in `GetSecrets` or `SearchItems`                                                                                | `src/runtime/ksecretd/kwalletfreedesktopservice.cpp` |
| Cipher is Blowfish‑CBC (a 64‑bit block). The key is PBKDF2‑SHA512 at 50,000 rounds, not memory-hard; older wallets use 2,000 rounds of SHA‑1                    | `src/runtime/kwalletbackend/kwalletbackend.cc`, `.h` |
| MD5 hashes of folder and entry names are kept alongside the data                                                                                                | `kwalletbackend.cc`                                  |
| "Close when the screen saver starts" exists but is off by default                                                                                               | Unverified                                           |

### How Moire beats each

| Area              | gnome-keyring                    | KWallet                               | Moire (required)                                                                  |
| ----------------- | -------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Who may read      | Any process on the session bus   | Any process that names an allowed app | Only the owning app, or one the user approved in the compositor's protected layer |
| Client identity   | None                             | Self-reported string                  | Kernel credentials, `/proc` executable, the compositor's launch record            |
| Same-user malware | Can copy the store               | Can copy the store                    | Store and keys belong to another uid; user-side helpers are non-dumpable          |
| KDF               | Iterated SHA‑256                 | PBKDF2‑SHA512, 50k                    | scrypt (128 MiB) now; Argon2id when the image's Node has it                       |
| Cipher            | AES‑128‑CBC + MD5                | Blowfish‑CBC                          | AES‑256‑GCM per item                                                              |
| Metadata at rest  | Names and attribute hashes clear | Name hashes clear                     | Everything but the header encrypted                                               |
| Store integrity   | Per-file MD5                     | Per-file hash                         | Authenticated manifest binding every item and a generation                        |
| Prompts           | A client window, outside GNOME   | A client window                       | Compositor's protected layer only                                                 |
| Login unlock      | Password passed to the daemon    | Through `pam_kwallet` (unverified)    | A derived value; the password never leaves moire-dm                               |
| Lock with screen  | No                               | Optional, off                         | On by default, keys wiped                                                         |
| `plain` transport | Anyone                           | Anyone                                | Identified clients only, on a bus with monitoring closed                          |
| Audit             | None                             | None                                  | Every read, by app and item, viewable in Settings                                 |

## API surface

The Secret Service specification 0.2, on the session bus as `org.freedesktop.secrets`. All of it
is needed, because libsecret uses all of it:

| Object                                                  | Methods                                                                                                   | Properties and signals                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Service, `/org/freedesktop/secrets`                     | `OpenSession`, `CreateCollection`, `SearchItems`, `Unlock`, `Lock`, `GetSecrets`, `ReadAlias`, `SetAlias` | `Collections`; `CollectionCreated`, `CollectionDeleted`, `CollectionChanged`                   |
| Collection, `…/collection/<id>` and `…/aliases/default` | `Delete`, `SearchItems`, `CreateItem`                                                                     | `Items`, `Label`, `Locked`, `Created`, `Modified`; `ItemCreated`, `ItemDeleted`, `ItemChanged` |
| Item, `…/collection/<id>/<n>`                           | `Delete`, `GetSecret`, `SetSecret`                                                                        | `Locked`, `Attributes`, `Label`, `Created`, `Modified`                                         |
| Session, `…/session/<n>`                                | `Close`                                                                                                   | —                                                                                              |
| Prompt, `…/prompt/<n>`                                  | `Prompt(window-id)`, `Dismiss`                                                                            | `Completed(dismissed, result)`                                                                 |

- **Collections:** one persistent collection, `login`, with the `default` alias, and the
  in-memory `session` collection. `CreateCollection` for another name returns the default one:
  one store, one password.
- **`@moire/dbus` gaps:** `org.freedesktop.DBus.Properties` (`Get`, `Set`, `GetAll`,
  `PropertiesChanged`) for exported objects, and `GetConnectionCredentials`. No descriptor
  passing is needed.
- **Later:** `org.freedesktop.impl.portal.Secret` for Flatpak apps, which hands each app one
  app-scoped key. It belongs to the portal work and is not touched here.
- **Not in scope:** SSH and GPG agents, and PKCS#11.

## Architecture

```
moire-dm worker (root)                         moire-secrets (uid moire-secrets, system service)
  login ok → P' = HMAC(password)                 /var/lib/moire-secrets/<uid>/store
  connect /run/moire-secrets/login.sock ───────▶ root peer: "uid, session, P'"  → unlock
  the connected socket is inherited ▼            then the same connection is that session's channel
                                                 keys, items, ACL, consent state, audit log
session supervisor (user, non-dumpable)                         ▲ binary protocol, typed, bounded
  starts the session bus                                        │
  fd ──▶ moire-secrets-front (user, non-dumpable) ──────────────┘
          owns org.freedesktop.secrets
          client → GetConnectionCredentials → pid → /proc exe, launch record → identity
          DH is end to end between client and broker; the front relays ciphertext
  socketpair ──▶ compositor: secure prompt (unlock, consent), lock and unlock events
```

- **Broker** (`apps/system/secrets`, new; uid `moire-secrets`): the only process that reads the
  store or holds a key. It decides every access. It speaks a binary protocol like moire-dm's
  (fixed layout, secrets as bytes) on Unix sockets, and has no D-Bus. One service serves every
  user, with separate keys per user.
- **Front** (`moire-secrets-front`, the session user): owns the bus name, implements the object
  tree, works out who each client is, and forwards typed requests with that identity. It keeps
  no store and no key. On DH sessions it never sees a secret.
- **Session supervisor** (new; replaces the `bash` script and `dbus-run-session` in
  `moire-native-desktop-session`): starts the session bus with Moire's configuration, then the
  front, then the compositor. It exists so the broker channel reaches exactly one process.
  Passed through today's chain it would be inherited by the shell, the bus daemon and every app.
- **Compositor:** draws unlock and consent prompts in the protected layer, and tells the broker
  about lock, unlock and suspend. It talks to the front over a socket pair the supervisor
  creates, not over the bus, so nothing else can pose as either end.

### Why a separate uid (requirement 2)

| Option                                                           | Store file                                   | Daemon memory                                | Cost                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A. One daemon as the user, non-dumpable, Yama on                 | Readable and replaceable by any user process | Safe only while both settings hold           | Smallest. No supervisor change                                                           |
| **B. Broker under its own uid, front as the user (recommended)** | Not readable or writable by the user         | Another uid: no ptrace, no `/proc/<pid>/mem` | Two processes, a login handoff, a session supervisor, a store outside the home directory |

**Recommendation: B**, with A's hardening applied to the user-side processes as well.

- **The file matters as much as the memory.** With A, malware copies the store and guesses the
  login password offline at its leisure, or swaps in last month's store. With B it can do
  neither.
- **B makes the login handoff simple:** root talks to a system service directly.
- **What B doesn't buy:** the front is still the user's process and is trusted to report client
  identity honestly. It is small, holds no secrets on DH sessions, and can't be attached to.
- **Hardening that applies either way:**
  - `PR_SET_DUMPABLE=0` in the front, the supervisor and the compositor, set through
    `@moire/sys/libc`. That refuses same-user ptrace, `/proc/<pid>/mem` and core dumps.
  - The image asserts `kernel.yama.ptrace_scope ≥ 1`, so one app can't attach to another and
    borrow its grants.
  - The broker's unit is hardened like `moire-dm-settings`: `NoNewPrivileges`,
    `ProtectSystem=strict` with only its state directory writable, `ProtectHome`, private
    devices, network and IPC, `AF_UNIX` only, no capabilities, `MemoryDenyWriteExecute`
    (`--jitless`), `LimitCORE=0`, and the same V8 flags.

### Client identity (requirement 1)

Identity never comes from anything a client says: not a bus name, an `appid` argument, a window
title, `_NET_WM_PID` or the environment.

1. **Kernel credentials.** The front asks the bus daemon for the caller's
   `GetConnectionCredentials`. The uid must be the session user's. The pid is used with the
   process start time, read before and after, so a reused pid is caught. (A pidfd from
   `ProcessFD` is better and waits on descriptor passing in `@moire/dbus`.)
2. **Executable.** `readlink /proc/<pid>/exe`. A process can't change this for itself.
3. **Launch record.** The compositor records which desktop entry it started as which process,
   and its children inherit that. This is what tells Moire's own apps apart, since they all run
   on `node`. systemd scopes per app would be stronger, but the session has no user manager
   today (open question 6).
4. **X11.** Whether the process is a client of Moire's Xwayland, from the X server's own client
   list (X-Resource client pids, which the server takes from the socket).

The identity is `{ app id if launched by the compositor, executable path, x11 }`. Rules:

- **Stable across updates only for system software.** An executable reached through
  `/run/current-system/sw` is identified by its name there. Anything else (a user profile, a
  build output, the home directory) is identified by its exact path, and a changed path asks
  again. A package named "chromium" that a user built doesn't inherit Chromium's grants.
- **Generic hosts can't hold remembered grants:** shells, interpreters, `secret-tool`, `busctl`.
  They own what they create, and every access to anyone else's item asks, every time.
- **No identity, no access.** A client whose process can't be resolved gets no item, no `plain`
  session and no consent prompt.

### Access control and consent (requirement 1)

- **Ownership:** the app that creates an item owns it. The owner reads, changes and deletes it
  without a prompt.
- **Everyone else sees the item as locked.** `Item.Locked` is true for that client and
  `SearchItems` lists it under "locked". The client calls `Unlock`, gets a `Prompt`, and Moire
  shows consent. This is the specification's own flow, so libsecret clients handle it unchanged.
- **The consent prompt** is drawn by the compositor in the protected layer, as the lock screen
  and polkit prompts are. It says which app is asking (name, and "runs under X11" where true),
  which item (its label), and which app owns it. The choices are Deny, Allow once and Always
  allow. It has the polkit prompt's arming delay, timeout and flood limits.
- **No prompt needs a password** unless the store is locked. Consent is a click that no client
  can inject.
- **Grants are stored in the item**, encrypted with it, as `{ identity, since }`. Settings lists
  and revokes them.
- **`CreateItem` with `replace`** only ever replaces the caller's own item. An app can't
  overwrite another app's secret by matching its attributes.
- **Writes and deletes by a non-owner** need "Always allow" plus a second confirmation.

### Lifetime (requirement 4)

| Event                          | Keyring                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Password login                 | Unlocked by moire-dm's handoff before the session starts                                                  |
| Automatic login                | Stays locked. The first access shows the unlock prompt (the login password, in the protected layer)       |
| Screen lock                    | Locked; master key, item keys and any decrypted item wiped. Setting: "Lock passwords with the screen", on |
| Screen unlock by password      | Unlocked again. The compositor derives P′ from the bytes it just checked and sends it to the broker       |
| Screen unlock by logind        | Stays locked until the unlock prompt                                                                      |
| Suspend                        | Locked and wiped before the sleep inhibitor is released. Setting, on                                      |
| Idle                           | Optional "Lock passwords after N minutes idle", off: the screen lock already covers it                    |
| "Lock now" in Settings, logout | Locked and wiped; on logout the session's channel closes                                                  |

- **While unlocked, items stay encrypted in memory.** The broker holds the master key and
  decrypts one item per request, then wipes it.
- **A locked store never answers "no match".** A wrong "not found" makes an app create a new
  key over its old one. `SearchItems` and `GetSecrets` on a locked store hold the reply for up
  to 20 s (libsecret's call timeout is 25 s) while the unlock prompt is up, then fail with
  `org.freedesktop.Secret.Error.IsLocked`. While the screen is locked there is no prompt and
  they fail after the hold.

### Login unlock without the password

- **What moire-dm hands over:** P′ = HMAC‑SHA256("moire-secrets login v1", password bytes),
  computed in the session worker. The password itself goes nowhere new.
- **Where the worker gets it:** from its own conversation. Linux-PAM doesn't let an application
  read `PAM_AUTHTOK`, and clears it when `pam_authenticate` returns. So the trampoline computes
  P′ for each secret answer as it passes, and the worker keeps the one that authenticated, wiping
  the rest. With `pam_unix` alone that is unambiguous. (Both PAM facts are from the Linux-PAM
  source and are pinned in Phase 1.)
- **Handoff:** after `pam_open_session`, the worker connects to
  `/run/moire-secrets/login.sock` (root only), sends `{ uid, session id, P′ }`, and wipes its
  copy. That connection then becomes the session's channel: the exec helper passes it to the
  supervisor as a numbered descriptor, and the supervisor gives it to the front alone.
- **Broker:** KEK = KDF(P′, the store's salt). It unwraps the master key and wipes P′ and the
  KEK. Nothing derived from the password is kept.
- **First login:** no store yet, so the broker creates one keyed to P′.
- **Compared with gnome-keyring:** its PAM module passes the password itself to a daemon running
  as the user. Here the password stays in moire-dm, the value that leaves is useless for
  signing in, and the receiver isn't the user.

### Password changes

| How the password changed                  | What happens                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settings › Change your password           | After `passwd` succeeds, the management service sends old and new P′ through the front. The broker checks the old one, then re-wraps the master key under a new salt                   |
| Expired password at the greeter           | moire-dm hands over both P′ values; the same re-wrap                                                                                                                                   |
| `passwd` in a terminal, or an admin reset | The next login's P′ doesn't fit. The broker keeps the candidate KEK (not P′) for that session and stays locked                                                                         |
| …then, on first use                       | The prompt asks for the previous password. If it fits, the master key is re-wrapped under the candidate KEK. Otherwise: "Start a new keyring"; the old store is set aside, not deleted |

Re-keying rewrites only the header. Items aren't re-encrypted.

## Storage format and encryption (requirement 3)

`/var/lib/moire-secrets/<uid>/store`, mode 0600, owner `moire-secrets`, in a 0700 directory.
It is not in the home directory: the user must not be able to read or replace it.

```
header (clear, authenticated):  magic, format version, store id, KDF id and parameters, salt,
                                master key wrapped with AES-256-GCM under the KEK
manifest (AES-256-GCM, key = HKDF(master, "manifest"), AAD = header):
                                generation, collection labels and aliases,
                                for each item: id, version, SHA-256 of its ciphertext
items (each AES-256-GCM, key = HKDF(master, "item" ‖ id),
       AAD = store id ‖ item id ‖ item version ‖ format version):
                                label, attributes, content type, secret, timestamps,
                                owner identity, grants
audit log (separate file, AES-256-GCM records, key = HKDF(master, "audit"))
```

- **KDF:** scrypt from `node:crypto`, N = 2^17, r = 8, p = 1 (128 MiB, about half a second).
  The image pins `nodejs_22`, which has no `crypto.argon2`; it arrived in Node 24 (the host's
  24.21 has it). The header carries a KDF id, so Argon2id (64 MiB, 3 passes, 4 lanes) replaces
  scrypt at the next login after the image moves, with no format change. Argon2 through koffi
  would add a native boundary to save a few months and is not proposed.
- **Everything but the header is encrypted:** labels, attribute names and values, owners,
  grants, timestamps and collection names. What an offline reader learns is the number of items
  and their sizes.
- **AEAD per item**, with a fresh random 96‑bit nonce on every write. The associated data pins
  an item to its store, id and version, so a ciphertext can't be moved to another slot or
  swapped for an older version of itself.
- **Whole-store integrity:** the manifest lists every item's ciphertext hash under one
  authenticated generation. A removed, added, reordered or older item fails the check, and a
  store that fails stays locked with a fixed error. Nothing is repaired silently.
- **Rollback:** the user can't write the directory, so can't put an old store back. Someone
  with offline write access to the disk can restore an older whole store; detecting that needs
  a hardware counter and is out of scope.
- **Writes:** `O_EXCL` temporary file, `fsync`, rename, `fsync` of the directory, as moire-dm's
  automatic-login writer does.
- **All crypto is `node:crypto`** (OpenSSL). No FFI, and it works under `--jitless`.

## Transport (requirement 5)

- **`dh-ietf1024-sha256-aes128-cbc-pkcs7`** (what libsecret asks for first): supported, with the
  key agreement done by the broker, so the front relays ciphertext.
- **`plain`:** only for a client with a resolved identity. go-keyring tools need it.
- **Does DH add anything on a local bus? A little, and only against one thing.** A process of
  the same user can ask the session bus to become a monitor and read every message. DH stops
  that passive reader. It does nothing against a process that can read the client's memory, and
  it is unauthenticated 1024‑bit DH with AES‑128‑CBC, so it is no defence against an active
  attacker either. On a bus where nobody can monitor, it adds nothing.
- **So close the monitor instead.** The supervisor starts the session bus with Moire's
  configuration, which denies `org.freedesktop.DBus.Monitoring` and eavesdropping. Then `plain`
  is no more readable than DH. (That dbus-daemon honours this for same-user connections is
  pinned in Phase 1; if it doesn't, `plain` is limited to clients the user approved for it.)

## Where compatibility forces a weakness

| Forced by the API                                                               | Containment                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Any process may talk to the service                                             | Kernel identity, ownership, consent                                                   |
| `plain` sessions exist and some clients use nothing else                        | Identified clients only; monitoring closed on the bus                                 |
| The only encrypted session is weak, unauthenticated DH                          | Not relied on. The bus configuration is the protection                                |
| `GetSecret` can't return a prompt                                               | Items look locked to non-owners, which routes clients through `Unlock` and its prompt |
| `SearchItems` must answer at once                                               | Held up to 20 s, then `IsLocked`; never "no match" from a locked store                |
| An app's secret is only as safe as the app (debug ports, plugins, `LD_PRELOAD`) | Stated in the consent wording and the threat model; Yama stops attaching              |
| Apps keep what they read                                                        | Out of reach. The audit log shows who read what                                       |

## Audit log (requirement 6)

- **Records:** time, operation (read, write, delete, unlock, consent given or refused, access
  refused), item id, app identity, result. Never a secret, a label or an attribute.
- **Where:** beside the store, encrypted. Records made while locked wait in memory (at most
  1,000) and are written at the next unlock.
- **Retention:** 90 days or 10,000 records.
- **Settings:** Passwords & Keys shows it per item and per app, with labels resolved while
  unlocked.

## NetworkManager secrets

**Yes, for profiles the user owns. No, for shared ones.**

- **Today:** temporary Wi‑Fi connections carry the password unsaved (`psk-flags` 2). The user's
  saved copies and imported VPNs store secrets with flags 0, in plaintext under `/etc`.
- **Proposal:** the management service registers an
  `org.freedesktop.NetworkManager.SecretAgent`, as it already registers a BlueZ agent
  (`bluez-pairing.ts`). Profiles whose `connection.permissions` name only the user are saved with
  agent-owned secrets (flags 1), and the agent keeps them in the keyring as items owned by the
  management service.
- **Why it costs nothing:** NetworkManager only brings up a user-restricted profile while that
  user has a session, which is exactly when the agent is there. One gap: with automatic login the
  keyring is locked, so Wi‑Fi waits for the first unlock (open question 4).
- **Shared profiles** (no permissions, such as the wired connection) stay system-owned. They
  must work at the greeter and for every user.
- **Migration:** on first run, the user's existing flags-0 profiles are rewritten as
  agent-owned and their secrets moved.
- **New-password requests from NetworkManager** (a changed Wi‑Fi password) open Settings'
  existing Wi‑Fi sheet.

## Settings

A "Passwords & Keys" page built from `@moire/ui` widgets, through a client in
`@moire/system-management` like the others:

- Items by app: label, owner, last read. Delete. Never the secret itself in version 1.
- Per item, the apps allowed to read it, with Revoke.
- The audit log.
- "Lock now", "Lock passwords with the screen", "Lock on suspend".
- The state after a password mismatch, with "Enter previous password" and "Start a new keyring".

## Threat model

**Assets:** the stored secrets; the login password, from which the store's key derives; the
record of who may read what.

**Protected against:**

- **Another app of the same user reading a secret.** It is identified from the kernel, sees
  other apps' items as locked, and needs consent it can't give itself.
- **Malware copying or replacing the store.** The file belongs to another uid.
- **Malware reading the daemon's memory.** The broker is another uid. The front, supervisor and
  compositor are non-dumpable, and Yama stops attaching to other apps.
- **A fake prompt, or input into a real one.** Prompts are compositor-drawn. No Wayland or X
  client can draw over them, read them or send input to them.
- **A stolen disk or image.** Everything but the header is encrypted under a memory-hard KDF of
  the login password. The header gives no check faster than that KDF.
- **Tampering with the store.** AEAD per item, the manifest, and the generation.
- **A machine left unlocked, then locked or suspended.** Keys are wiped at lock and before
  sleep.
- **Bus eavesdropping.** Monitoring is denied on Moire's session bus; DH covers libsecret
  clients regardless.
- **Other users.** Separate stores and keys per uid, and a per-user session bus.
- **A compromised front.** It can lie about who is asking, so it can request any item of an
  unlocked store. It can't read the store, learn the master key, unlock a locked store, or
  touch another user's.
- **A flood of prompts.** The polkit agent's limits: one visible, three queued, a cool-down
  after Deny.

**Xwayland:** Moire runs one shared, rootless Xwayland (`packages/core/src/xwayland.ts`, its
window manager in `xwm.ts`) with no X security options. Any X client can log keys typed into
other X windows, inject input with XTEST, read other X windows' pixels and read X selections.

- **All X apps are one trust zone.** A secret given to one X app is within reach of every other
  X app: they can read it off its window or drive it to reveal it.
- **Identity is not taken from X.** It comes from the bus daemon's kernel credentials, so an X
  client can't pose as another app to the keyring. `_NET_WM_PID` is self-reported and unused.
- **The consent prompt names an X app by its kernel identity and flags "runs under X11":
  anything this app shows or you type into it can be seen by other X11 apps."**
- **Grants to X apps are remembered only until logout** (open question 5), because a remembered
  grant to one X app is a standing grant to the zone.
- **No secret entry ever goes through an X window.** Unlock and consent are in the protected
  layer, where Xwayland gets no keys and can't see or overlay anything.
- **X clients can't see Wayland apps' input or pixels**, so a Wayland app's secrets are not in
  the zone.

**Not protected against:**

- **Root, the kernel, and offline write access to the disk** (rollback of a whole store).
- **An app the user approved.** It has the secret, and may keep or send it.
- **Code that controls an approved app** through its own features (a debugging port, an
  extension, an injected library). To the keyring it is that app.
- **Secrets after delivery:** in the client's memory, in swap, in the clipboard.
- **Paging and hibernation images** of the broker's memory. Node can't `mlock` its heap; the
  image's swap policy is the control.
- **Whoever knows the login password.** It opens the store.
- **Availability.** A user process can kill the front or take the bus name after a crash. The
  result is no keyring until the supervisor restarts the front, never disclosure; the compositor
  shows a warning when the name's owner isn't the front.

## Compatibility or build our own

| Option                                | For                                       | Against                                                                                                                                      |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| gnome-keyring + `pam_gnome_keyring`   | Mature; every client is tested against it | Every weakness in the table above. Its PAM module starts a user daemon from inside moire-dm's worker. Its prompt is a client window on Moire |
| KWallet (`ksecretd`)                  | Maintained                                | The same lack of access control; Blowfish; pulls in KDE Frameworks                                                                           |
| oo7 daemon (GNOME's Rust replacement) | Modern code                               | Same access model and prompt path; young                                                                                                     |
| KeePassXC as the provider             | Strong store                              | An app the user must run and unlock; not a system service                                                                                    |
| **Moire's own (recommended)**         | Meets all six requirements; fits moire-dm | New code holding everyone's secrets. Contained by the uid split, the small broker protocol, the unit hardening and the tests below           |

This is the "upstream boundary" case: access control, the prompt path, the login handoff and
the store format are exactly what must differ. An importer for existing gnome-keyring files can
come later.

## Phases

| Phase | Work                                                                                                                                                                         | State          |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1     | This design. Pin in a container: Linux-PAM's handling of `PAM_AUTHTOK`, the bus's monitoring policy, how libsecret, Chromium and go-keyring take a held reply and `IsLocked` | Needs approval |
| 2     | The secure prompt in core (shared with the polkit agent's Phase 2)                                                                                                           | Not started    |
| 3     | Broker: format, crypto, protocol, ownership and grants, audit log, unit and account                                                                                          | Not started    |
| 4     | Front: the Secret Service objects, client identity, DH and `plain`, `Properties` in `@moire/dbus`                                                                            | Not started    |
| 5     | Session supervisor, moire-dm handoff, lock, suspend and unlock wiring, re-keying                                                                                             | Not started    |
| 6     | Settings › Passwords & Keys                                                                                                                                                  | Not started    |
| 7     | NetworkManager secret agent and migration                                                                                                                                    | Not started    |
| 8     | VM run (below)                                                                                                                                                               | Josh's         |
| Later | Flatpak's Secret portal; gnome-keyring import; Argon2id; per-app scopes; pidfd identity                                                                                      | —              |

### Follow-ups (planned, not part of this work)

- **Xwayland hardening:** untrusted-client or SECURITY-extension mode, and XTEST and RECORD off
  where nothing needs them.
- **Clipboard policy:** the Wayland clipboard reaches X only while an X window has focus.
- **Per-app Xwayland instances:** the long-term isolation that ends the shared zone.

## Verification (planned)

- **Broker format smoke:** round trips; every single-bit flip in header, manifest and items
  refused; an item moved, duplicated, dropped or replaced by its older version refused; a wrong
  key; scrypt against published vectors; nothing but the header readable; no temporary file left.
- **Broker protocol smoke:** malformed frames, a non-root peer on the login socket, a second
  header on a session channel, wipes at lock, no secret in any log.
- **Access smoke:** owner reads; a stranger sees locked; consent once, always and denied;
  revoke; `replace` never crossing owners; generic hosts never remembered; an unresolved client
  refused.
- **Front smoke** (private `dbus-daemon`): the whole API against a scripted client; DH against
  the specification's vectors; `plain` refused without identity; a reused pid caught; the
  20 s hold, then `IsLocked`.
- **Real clients in a container:** `secret-tool` and a libsecret test program, `secretstorage`,
  a go-keyring program; Chromium with `--password-store=gnome-libsecret`.
- **moire-dm:** `conversation.smoke.ts` gains the P′ capture (the right answer kept, others
  wiped, nothing kept on denial) and the handoff with a fake broker.
- **Lock wiring:** `lock-session.smoke.ts` gains lock → wipe and password unlock → unlock.
- **Settings and shell:** the page, and the unlock and consent prompts in each state. Visreg
  scenes `keyring-unlock`, `keyring-consent`, `keyring-consent-x11`.

## VM test plan

1. Log in with a password. `secret-tool store --label=t a b` then `secret-tool lookup a b`
   returns it with no prompt. `ls -l /var/lib/moire-secrets` as the user is refused.
2. From a second program (a Python `secretstorage` script), look up the same attributes: the
   consent prompt appears in the protected layer, naming the script's interpreter and the item's
   owner. Deny: the script gets nothing. Allow once: it reads once and is asked again next time.
3. Chromium: start it, save a password, restart it: no prompt and the password is there. Its
   "Safe Storage" item is owned by Chromium in Settings.
4. Lock the screen. From an ssh session as the user, `secret-tool lookup a b` waits, then fails
   with a locked error; it never prints nothing-found. Unlock with the password: the same command
   works at once.
5. Suspend and resume: the keyring is locked until the lock screen's password is entered.
6. Automatic login (`fresh-boot`): the first lookup raises the unlock prompt. The right password
   unlocks; Escape leaves it locked.
7. Change the password in Settings, log out and in: unlocked, no prompt.
8. Change it with `passwd` in a terminal, log out and in: locked. First use asks for the
   previous password, then never again.
9. As the user: `gdb -p` on the front and on the compositor is refused; `busctl --user monitor`
   is refused.
10. X11: an X app (`xterm` running `secret-tool`) asks for another app's item: the prompt says
    "runs under X11". With `xev` focused, type at the prompt: `xev` records nothing. `xdotool`
    can't click Allow.
11. Wi‑Fi: join a network and save it. Its file under `/etc/NetworkManager/system-connections`
    has no `psk`. Reboot and log in: it reconnects.
12. Settings › Passwords & Keys: the items, Chromium's grant, the reads from steps 1–3 in the
    log. Revoke a grant and repeat step 2: asked again.
13. Copy the store as root to another machine and try a wrong password: refused. Flip one byte:
    refused as damaged, and the keyring stays locked.
14. `journalctl -b | grep` for the test secret and the password: nothing.

## Open questions for Josh

1. **Broker placement.** A system service under its own uid (B), or a hardened daemon as the
   user (A)?
   _Recommended: B. It is the only one that keeps the store away from the user's own processes._
2. **Where the store lives.** `/var/lib/moire-secrets` isn't in the home directory, so it doesn't
   travel with a home backup, and the live image keeps `/var` in RAM.
   _Recommended: keep it there, persist that directory alongside the home volume in the image,
   and add an encrypted export and import to Settings in Phase 6._
3. **Consent strength.** Is a click in the protected layer enough to let another app read an
   item, or should "Always allow" need the password?
   _Recommended: a click. Nothing but the person at the machine can make it, and password
   prompts that appear often train people to type passwords._
4. **Automatic login.** The keyring starts locked, so saved Wi‑Fi waits for an unlock.
   _Recommended: accept it and show the unlock prompt once at session start for automatic-login
   users. A keyring with no password would undo the design._
5. **X11 apps and "Always allow".** Remember their grants only until logout?
   _Recommended: yes. One X app's standing grant is every X app's._
6. **Per-app systemd scopes.** They would make app identity a kernel fact for every process, but
   need a user manager the session doesn't run.
   _Recommended: not now. The compositor's launch record and the executable path cover version
   1; revisit with the session supervisor._
7. **One broker or one per user.**
   _Recommended: one. Moire runs one user session per seat, so only one store is unlocked at a
   time. Revisit if fast user switching arrives._
8. **Capturing P′ in the conversation, or a small PAM module** that reads the token directly.
   _Recommended: the conversation. No C, and exact for `pam_unix`. A reviewed shim becomes
   justified only if a multi-factor stack makes "which answer was the password" ambiguous._
9. **Viewing a secret in Settings.**
   _Recommended: not in version 1. Settings is an ordinary client; showing secrets wants the
   compositor's secure field (polkit-agent.md, open question 6)._
10. **Locked-store behaviour toward apps** (hold 20 s, then `IsLocked`).
    _Recommended: as written, confirmed against Chromium and libsecret in Phase 1 before
    anything is built on it._
11. **Lock with the screen by default.**
    _Recommended: on. Background apps lose access while locked; that is the point._
