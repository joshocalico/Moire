# Native greetd frontend source

This frontend speaks stock greetd's IPC protocol. greetd owns authentication,
PAM sessions and session launch. The frontend owns its Window, drafts and one
conversation. It is separate from the sealed C55/C56 fixture authorities and the
existing authenticated welcome screen.

The source tests use private Unix sockets, synthetic credentials, CPU Windows
and owned subprocesses. They do not authenticate a real account or qualify a
native graphical seat. No Cage, NixOS, device permission or VM activation is part
of this source slice.

## Ownership and launch

The configured application supplies a connected client and one build-time trusted
fixed executable. The broker permits only a safe absolute Nix store executable
path and sends that single command with an empty environment list. Path syntax
validation does not prove filesystem immutability. The future package entry must
supply the immutable path from its trusted build configuration. There is no
session command from the UI, command line, desktop catalog or environment.

The greeter handles account entry, visible/secret prompts and informational
acknowledgements. Attempt and prompt identities prevent old UI handlers from
answering new prompts. Denial and pre-launch cancellation return to account entry
only after acknowledged cancellation. Drafts are local to the presentation,
cleared before sending, masked for secret prompts, and removed on retirement.

A successful authentication reply permits a launch request. A successful
`start_session` reply acknowledges scheduled launch. The frontend then clears its
presentation, closes its Window and exits. It does not await a running desktop,
retire an authenticated session, log out users or create a replacement greeter.
Those actions belong to greetd and the separately qualified session owner.

Cancellation applies before launch. Once the launch request is in flight, its
outcome must resolve before local disposal. A committed launch cannot be cancelled
by this frontend. Unknown launch outcomes end the frontend with a generic failure;
they never reset to an apparently safe account-entry state or retry the launch.
Errors and snapshots contain no authentication response or untrusted broker text.

The [greetd 0.10.3 IPC manual](https://raw.githubusercontent.com/kennylevinsen/greetd/0.10.3/man/greetd-ipc-7.scd)
documents native-endian framing, the request sequence, and launch after greeter
termination. The source does not replace greetd with a privileged broker.

## Source verification

From the repository root:

```sh
./scripts/test-native-greeter.sh
```

This runs protocol framing, controller, public Window and subprocess workflows.
The source checkpoint records the final cases, command results and stable source
hashes. Real-PAM C58 qualification remains separate.

## Next native prerequisites

Cage remains the preferred host subject to an actual compatibility test. The
Wayland client currently discards `wl_keyboard.keymap`, ignores compositor
modifier state and derives text from a physical-key table. This specific contract
gap must be addressed before general keyboard-layout acceptance. No keyboard code
is changed here.

The narrow next proposal is to consume the supplied XKB keymap and modifier
masks in the Wayland client, translate keys through libxkbcommon, preserve existing
focus/stale-window rules, and reset state on replacement or disconnect. Test actual
keymap/modifier event decoding for Shift, Caps Lock, alternate layout symbols,
focus changes and missing/invalid keymaps. Keep this separate from evdev grab,
QEMU typing, renderer or tearing diagnosis. Activation and native typing tests
need their own approved scope and Recovery-coordinated VM window.

Authenticated Moire also needs supported libseat/logind device ownership,
revocation, complete teardown and logout before a login-to-desktop-to-login
workflow can be qualified. Secure lock remains later work. The moving wave is
last within that functional login/session/logout task, after verification.
