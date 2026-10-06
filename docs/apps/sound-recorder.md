# Sound Recorder

Record captures the default PipeWire input into a private WAV take. Stop finalizes and probes the actual audio. Enter a new .wav path and Save. Save or explicitly discard an unsaved take before recording again. Saved files are never replaced.

Closing is blocked while recording, starting, saving, stopping or discarding, and while a captured take remains unsaved. The window displays guidance to wait for the current operation, then Stop and Save or Discard take. After a successful save or discard, close is permitted and private files are removed. A failed save keeps the take and continues to block closing. Idle and backend-error states can close normally.

Missing PipeWire/recorder and an exited or empty capture produce explicit errors. There is no device picker, recording editor or waveform. Valid silent samples are audio; the app does not infer microphone activity from file size.

Package: `apps/bundled/sound-recorder`. Launcher: `moire-sound-recorder`.
Required guest tools: pw-record from PipeWire plus ffprobe.

## Verification

```bash
pnpm --filter @moire/sound-recorder smoke
pnpm --filter @moire/sound-recorder typecheck
pnpm --filter @moire/sound-recorder exec tsx src/close-guard.smoke.tsx
```

Real missing-process launch and invalid stop/save states. Set MOIRE_TEST_AUDIO_INPUT=1 only with a disposable PipeWire input to exercise actual capture/stop/probe/save/no-overwrite/discard. Actual host microphone capture was not run.

The close-guard smoke injects a controllable recorder boundary and drives actual Window controls and native HeadlessWindow close requests. It covers active and busy states, unsaved takes, failed saves, successful saves and explicit discards using disposable files. It does not start a capture process or access an audio device.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.
