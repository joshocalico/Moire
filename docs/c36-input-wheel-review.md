# C36 tablet movement and native history scrolling

The preserved C36 Software image now has a successful native notification-history wheel workflow. This is additional verification of the existing image; no runtime source or image changed.

Use the existing checkpoint:

```sh
./scripts/run-vm.sh vm/nixos/moire-aarch64-quality-36.iso
```

For a new build, choose an unused output name to preserve the checkpoint:

```sh
./scripts/build-vm-in-parallels.sh moire-aarch64-next.iso
```

See [the VM guide](nixos-vm.md) for the Linux build command, HVF launcher, and UTM configuration. This verification used the existing **Moire Quality 36 Software** UTM machine, its immutable ISO, and a temporary RAM-only `MOIRE_SCROLL_TRACE=1` service override. It does not verify direct QEMU wheel input separately.

## Image identity

- ISO: `vm/nixos/moire-aarch64-quality-36.iso`
- ISO SHA-256: `3adeb23d65f962cb21d52ad43146c3e8f3f5bdbe589c89b16a91254bde2d1158`
- Installed package: `/nix/store/qw2kn2xsm219xwn39jp1kzd3426c08pv-moire-0.0.0`
- Image mode: `0400`

The sealed C36 keyboard/Clear All results remain unchanged. These two fresh evidence cohorts add movement and wheel observations without rewriting that seal.

## Movement boundary

Evidence: `vm/verification/2026-10-04-c36-input-boundary`.

In boot `b3f992cd-ea2b-4e13-bbb1-5d544b49c262`, compositor PID 6487 observed wheel input on the QEMU mouse while UTM capture was enabled. The supported native drag attempts produced no relative X/Y events in that interval. After capture was released, tablet input delivered absolute X/Y values `26879,16875`. A later wheel used the corresponding guest position `1049,411` at 1280×800. This confirms absolute decoding and the core coordinate update for that sample.

An independent device observer ran only after stopping the session and verifying that packaged Moire processes and both input-descriptor owners were absent. It acquired both devices with `EVIOCGRAB`, then observed them for the full 120-second deadline. Both grabs succeeded; the observer exited 0 with no partial frames or close errors and released both descriptors.

The independent observer saw absolute tablet movement and wheel events with capture released. It saw mouse wheel events but no relative X/Y events during the captured drag attempts. The tablet reported the expected range 0–32767 on both axes. These are separate ownership cohorts, not simultaneous readers of grabbed devices.

The captured-motion cause remains unassigned among the supported automation route, UTM, and upstream input delivery. No general relative-input or drag acceptance follows from these observations. The first cohort did not establish notification-body scrolling: its post-motion wheel ran with the popup closed and after its producer had finalized.

## Native history workflow

Evidence: `vm/verification/2026-10-04-c36-native-wheel`.

The fresh boot was `386b33c3-5a09-4167-9b22-4db0953fd153`; compositor PID 6339 used the same installed package. The original notification producer `:1.36`, PID 6479, UID 1000 remained owned and alive through every wheel readback and its final independent readback.

The workflow was:

1. Open notifications with captured `Meta_L+n` and activate the focused Clear All control with Return.
2. Enter history with Return. Release capture with `ctrl+alt+Escape`, confirming Capture Input = 0.
3. Position the tablet over the future body before reopening the tray. A drag beginning outside an open popup dismisses it; positioning first avoids using that dismissal as a scroll test.
4. Reopen notifications, enter history, release capture, and wheel over the body.

The trace preserved the earlier tablet coordinates, then recorded native tablet `REL_WHEEL` and high-resolution wheel events followed by SYN, an axis at `1049,411`, a hit inside the history viewport, consumed routing, and ordinary CPU painting.

| Wheel sample | Offset before → after | Native body result |
| --- | --- | --- |
| First | 0 → 704 | MID marker and lines 36–69 |
| Second | 704 → 1041 | END marker, lines 55–72, and final notices |
| Return | 1041 → 0 | BEGIN marker and lines 01–29 restored |

The content height was 1645, viewport height 604, and maximum scroll 1041. All three samples occurred within the trace's 120-second limit; the last paint was at about 42.8 seconds. Body checksums changed and the footer checksum stayed `889975211`.

Native JPEG captures independently show text movement away from the scrollbar, with the header and Back/footer interiors fixed. JPEG differences at the body/footer boundary prevent claiming whole-footer pixel equality. The restored image also contains a changed age label and cursor/glow, so it is not an unmasked whole-body equality check. CPU checksums describe rendered buffers, not physical scanout or tearing.

The method monitor matched compositor `:1.33` → service `:1.32`, request serial 9, with response serial 34 carrying `reply_serial=9`. The request contained the original three ID/revision pairs. The same live producer subsequently observed no active notices and closure signals. No ActionInvoked signal appears in that producer's event log; this is not a claim of global bus absence. The method monitor observes DismissMany/DND calls and replies, not ActionInvoked signals.

All 33 guest exports passed strict Base64, length, and SHA-256 verification. The producer, monitoring helper, finalizer, and serial bridge exited 0. Finalization stopped the helper's owned `dbus-monitor` child with SIGTERM; that child is not recorded as an exit-0 process. The service was active/running with zero restarts before normal poweroff. Fresh native UI confirmed the stopped VM and released input afterward.

## Retained failures and limits

The native-wheel helper first rejected post-clear verification because the expected baseline filename was missing. The earlier, actual `seeded-live.json` observation was copied as a baseline alias without changing its contents or timestamp. The first alias copy had the wrong test-file owner; correcting ownership to the existing helper user preserved mode `0600`, and the readback then passed. These failed attempts remain in the serial evidence. The alias is not a newly observed pre-clear snapshot.

The first export check ran before the serial transfer completed and rejected the incomplete export. The completed transfer passed with all 33 artifacts; the failure was not an artifact hash mismatch.

Both cohorts shut down normally. Before recording the follow-up, full preservation checks found all 918 frozen source/current-result files unchanged, all 40 host images plus four UTM image copies unchanged with mode `0400`, and the sealed C36 review unchanged. The subsequent result documentation adds this review and updates the daily-use plan; runtime source and image bytes remain unchanged. No new system permissions, security configuration, services, credentials, or paid dependencies were introduced.

This closes the tested **UTM capture-released tablet → notification-history wheel → fixed-footer paint** workflow. Captured relative movement, active-notification wheel scrolling, general click/drag behavior, physical tearing, accelerated scanout, and the remaining native app workflows still need their own evidence.
