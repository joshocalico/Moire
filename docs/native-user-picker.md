# Native greeter user picker

Status: the isolated C63 R6 image passed two real PAM login/logout cycles on
2026-10-05. AccountsService activation was explicitly approved by Josh.
The preserved C63 R3 ISO still uses the username entry and remains unchanged.

The flow discovers public local-account metadata, displays account
choices, then shows the selected identity and a focused password field. Change
user clears the private field immediately and waits for greetd's cancellation
acknowledgement before showing fresh choices. Additional PAM secret, visible,
information and error prompts remain supported. PAM/greetd still decides
authentication, account authorization and session launch.

The presentation retains C63 R3's Silk backdrop, software-wave Window policy
and application-local Reduce motion control. The wave remains mounted through
picker/password transitions. It makes no new hardware or tear-free claim.

## Public account metadata boundary

`apps/system/compositor/src/local-users.ts` implements read-only AccountsService
discovery using the existing D-Bus client. It requests `ListCachedUsers` and
individual `SystemAccount`, `Locked`, `LocalAccount`, `Uid`, `UserName`,
`RealName` and `Shell` properties. It excludes locked, system, non-local, root
and nologin/false-shell accounts. Missing or malformed metadata fails closed;
there is no guessed `/etc/passwd` fallback. No password, password hint, icon,
home-directory or user preference is read. Names are bounded and reject control
and formatting characters.

The adapter pins property reads to the unique service owner and checks that
owner again before publishing. Catalog size, RPC timeout and total request
duration are bounded. Selection re-reads eligibility immediately before PAM;
late or replaced results cannot begin authentication. This public metadata
snapshot is display eligibility, never authentication authority. Account changes
after the check remain subject to PAM's account authorization.

The interface was checked against the XML in the official
[AccountsService 23.13.9 source release](https://www.freedesktop.org/software/accountsservice/accountsservice-23.13.9.tar.xz).
`ListCachedUsers` is the service's public catalog, not a guarantee that every
possible NSS account is discoverable. The native candidate ran AccountsService
23.13.9 and discovered the disposable `moire-pam-test` account.

## Approved isolated guest activation

The isolated desktop guest enables **`services.accounts-daemon.enable = true`**
and connects its read-only provider to the trusted pre-login
entry. This installs a root account metadata daemon and its standard package
service/policy files. It adds no custom ACL/Polkit grant, host service, network
port, account mutation or root renderer. See the upstream
[NixOS AccountsService module](https://raw.githubusercontent.com/NixOS/nixpkgs/master/nixos/modules/services/desktops/accountsservice.nix).
Josh authorized: “Enable AccountsService in the isolated test image for the
user picker and run the agreed PAM tests.” The desktop candidate enables this
service and passes a build-time opt-in to the trusted pre-login entry. The
earlier session probe omits that opt-in and retains its username flow.

## Verification

From the repository root:

```sh
bash scripts/check-native-user-picker.sh
```

The focused source checks use actual public Window/widget dispatch, CPU pixels,
the native controller with synthetic PAM transport, and a real private
`dbus-daemon` with fixture account metadata. They test selection, masked input,
cancel acknowledgement, stale catalog/answer callbacks, changed eligibility,
provider failure/retry, additional prompts and service owner revocation. The
software-wave fixture exercises moving picker and password pixels, Reduce
motion stop/resume and a return to the picker. These are source checks, not
native login or account discovery proof.

Native evidence is in `vm/verification/native-desktop-20261005T081531Z/`.
`candidate-acceptance.json` records the accepted scope separately from the
unchanged build receipt. Recheck its ISO, pixels, session retirement, sources
and fallback preservation:

```sh
python3 vm/verification/native-desktop-20261005T081531Z/verify-acceptance.py
```

Real wrong and blank passwords each produced PAM `AUTH_ERR`, no desktop and an
inline error in the same greeter PID 769. The R5 bounded cancellation repair is
retained: after explicit auth denial, retry a generic cancel error once and
require success acknowledgement before publishing ready. Further errors,
timeouts and unknown connection outcomes remain terminal. A masked draft
cleared on Change user. Correct passwords reached PID 3284/session 3 and
PID 5892/session 7, both active UID 1000 user sessions on seat0. Both native
desktops visibly showed Files and shell, logged out, released devices completely
and returned to fresh moving pickers. Reduce motion held the whole frame
unchanged for 14.244 seconds and resumed. All display owners retired; builder
and candidate shut down normally with QEMU exit zero.

The centred production flow uses bounded public display-name initials, a quiet
Change user action and a transparent desktop trigger. Its undimmed flyout has
one fixed Moire Wayland item; it exposes no arbitrary launch command. Native
pointer selection and keyboard Enter on the account reached the password field.
Additional PAM prompts, account eligibility changes and service replacement have
focused fixture proof, not live custom-PAM or account-mutation proof. Hardware
graphics, physical tearing, account avatar files and alternative sessions remain
outside this acceptance. See [Authenticated native desktop](native-desktop-vm.md)
for build/run commands and the immutable checksum.

## Accepted centred visual references

Josh accepted exactly these two local captures through Loop/Bridge:
`vm/verification/greeter-design-centered-20261005T080100Z/picker-avatar.png` and
`password-desktop-flyout.png` in the same directory. `accepted-design.json`
pins their hashes and Library IDs. They use synthetic identities and a Silk
still; the disabled alternative session is illustrative only. R6 adopts the
centred layout with public initials and the sole trusted installed session.
Earlier five-image proposals and failed intermediate captures are superseded.

Reproduce local design-only captures to a fresh absolute directory:

```sh
pnpm --filter @moire/greeter exec tsx src/native/design-mocks.tsx /absolute/fresh/mock-directory
```
