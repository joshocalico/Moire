# Moire audio

Moire talks to PipeWire itself. The control plane (devices, volumes, defaults, app streams) is a
TypeScript client for PipeWire's native protocol; sample streams (alert sounds, the input level
meter, Sound Recorder's takes) go through libpipewire over koffi with a small reviewed C shim on the realtime path. No
`wpctl`, `pactl` or `pw-record` is spawned by Settings, Quick Settings, the management service or
Sound Recorder; `pw-record` is no longer used anywhere in Moire.

The image already runs PipeWire and WirePlumber per user (`nix/moire-sound-services.nix`). Moire
does not replace WirePlumber: it remains the session manager that links streams, restores
volumes and picks the effective default device. Moire is a client of both, exactly like `wpctl`.
ALSA is out of scope.

## Layout

| Where                                   | What                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/audio/src/pod.ts`             | SPA POD encoder/decoder (pure TS)                                                                         |
| `packages/audio/src/spa.ts`             | SPA constants: types, param ids, prop/route/profile/format keys, audio formats, channels                  |
| `packages/audio/src/protocol.ts`        | Native protocol v3 framing and marshalling for Core, Client, Registry, Node, Device, Port, Link, Metadata |
| `packages/audio/src/connection.ts`      | One connection: proxies, hello, sync/done, ping/pong, registry, bind, errors                              |
| `packages/audio/src/transport.ts`       | Socket path resolution and the byte+fd transport                                                          |
| `packages/audio/src/control.ts`         | `AudioControl`: snapshot of sinks/sources/streams/devices/defaults; volume, mute, default, profile        |
| `packages/audio/src/audio-status.ts`    | Default-output adapter (moved from `@moire/prefs`, same API)                                              |
| `packages/audio/src/audio-devices.ts`   | Devices/streams adapter (moved from `@moire/prefs`, same API)                                             |
| `packages/audio/src/input-meter.ts`     | Input meter adapter (moved from `@moire/prefs`, same API, no child process)                               |
| `packages/audio/src/sound.ts`           | `playSound`, `recordLevels`, `recordStream`, the notification alert player                                |
| `packages/audio/src/wav.ts`, `alert.ts` | WAV PCM decode/encode, streaming WAV header; the procedural Moire alert (`assets/alert.wav`)              |
| `packages/audio/src/testing.ts`         | Fake PipeWire server used by the smokes; re-exports the fake libpipewire build                            |
| `packages/sys/native/moire-pwring.c`    | The C shim: lock-free ring + native `process` callbacks                                                   |
| `packages/sys/src/pipewire-stream.ts`   | koffi binding: `pw_thread_loop`, `pw_stream`, the shim                                                    |
| `packages/sys/src/fake-pipewire.ts`     | Test only: compiles the shim against `native/fake-pipewire/` with the host `cc`; the fake's hooks         |

`@moire/audio` depends on `@moire/sys` for every native call; only `packages/sys` imports koffi
(the oxlint rule). The management service is the only owner of the adapters; Settings and Quick
Settings keep reading the desktop status snapshot over D-Bus, unchanged.

## Control plane: native protocol client

Transport: a Unix stream socket at `$PIPEWIRE_REMOTE` (absolute) or
`$PIPEWIRE_RUNTIME_DIR|$XDG_RUNTIME_DIR/pipewire-0`. On Linux the transport is the same
`recvmsg`/`sendmsg` + `SCM_RIGHTS` connection the Wayland code uses (`WaylandClientConn` in
`packages/sys/src/unix.ts`), so file descriptors that arrive with a message are taken by that
message and closed when unused (the control plane never needs to keep one; `add_mem` is the only
event that carries one). Tests and non-Linux hosts use a plain `net.Socket` transport; the
kernel drops any fds sent to it.

Framing (protocol v3): a 16-byte header `{ id, opcode << 24 | size, seq, n_fds }` followed by
`size` bytes: one POD Struct with the arguments, optionally followed by footer PODs, which are
ignored. Fd arguments are indexes into the message's fds. Messages over 1 MiB are refused.

Handshake, as `pw_context_connect` does it: Core (proxy 0) `hello(4)` (`PW_VERSION_CORE`), Client (proxy 1)
`update_properties({application.name, …})`, Core `get_registry(3, 2)`, then a `sync` roundtrip so
every existing global has arrived.

Coverage:

| Interface | Methods sent                             | Events handled                                                                 |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Core      | hello, sync, pong, get_registry, destroy | info, done, ping, error, remove_id, bound_id, add_mem, remove_mem, bound_props |
| Client    | update_properties                        | info (ignored), permissions (ignored)                                          |
| Registry  | bind, destroy                            | global, global_remove                                                          |
| Node      | subscribe_params, enum_params, set_param | info, param                                                                    |
| Device    | subscribe_params, enum_params, set_param | info, param                                                                    |
| Port      | enum_params                              | info, param                                                                    |
| Link      | —                                        | info                                                                           |
| Metadata  | set_property, clear                      | property                                                                       |

Model (`AudioControl.read()`): registry globals are kept live from events; a read binds what it
needs (audio nodes, audio devices, the `default` Metadata), then enumerates `Props` on each audio
node and `Route`/`EnumRoute`/`Profile`/`EnumProfile` on each audio device in one batch followed by
one `sync`. Every request carries its own seq, so replies are matched exactly.

- **Sinks / sources:** nodes with `media.class` `Audio/Sink` / `Audio/Source` (and
  `Audio/Source/Virtual`). Names are `node.description`, else `node.nick`, else `node.name`.
- **App streams:** `Stream/Output/Audio` nodes; `application.name` and `media.name`. Capture
  streams (`Stream/Input/Audio`, e.g. the meter) are listed but are not app volumes.
- **Volume:** `Props.channelVolumes` is linear; the 0..1 slider is cubic like `wpctl`/`pactl`
  (`slider = cbrt(linear)`), rounded to 4 places because the wire is float32. Reads report the
  loudest channel; writes set every channel.
- **Device-backed nodes:** when a sink/source has `device.id` and `card.profile.device`, its
  volume and mute are written as the device's active `Route` (`index`, `device`, `props`,
  `save: true`), the way WirePlumber's mixer API does, so the choice is remembered per port.
  Other nodes (streams, virtual sinks) get `Props` directly.
- **Defaults:** the `default` Metadata. The effective default is `default.audio.sink|source`
  (WirePlumber writes it); choosing one writes `default.configured.audio.sink|source` with type
  `Spa:String:JSON` and value `{"name":"<node.name>"}`, then waits for WirePlumber to follow.
- **Profiles:** `EnumProfile`/`Profile` per device are read; `setProfile(device, index)` writes
  `Profile { index, save: true }`. Not yet surfaced in Settings.

After a write, the client re-reads until the readback matches or 500 ms pass; a stream's
`set_param` travels to the owning app and back, so one `sync` is not enough. The adapters then
publish whatever was actually read. Failures are values: no socket is `unavailable` ("PipeWire
isn't running"), a lost connection or a protocol error is `error`, and every request has a
1.5 s deadline and honours its `AbortSignal`. A closed connection is reopened on the next read.

### POD codec

`encodePod`/`decodePod` cover None, Bool, Id, Int, Long, Float, Double, String, Bytes,
Rectangle, Fraction, Bitmap, Array, Struct, Object (typed properties with flags), Choice (None,
Range, Step, Enum, Flags), Pointer and Fd; unknown types decode to an opaque value with their
bytes. Every POD is 8-byte aligned; array and choice children are packed. The decoder bounds
nesting depth and sizes and never reads past its buffer. Helpers build the common objects
(`Props`, `Route`, `Profile`, audio `EnumFormat`).

## Streams: libpipewire over koffi

### Threading model and the shim decision

PipeWire calls a stream's `process` callback on its realtime data thread. koffi can register a JS
function as a C callback, but a call from a foreign thread is queued to the JS main thread and the
native thread blocks until JS runs it (koffi docs, "Asynchronous callbacks"). On the realtime
thread that is an xrun every time the event loop is busy, and it can deadlock: the thread-loop
thread holds the loop lock while it calls `state_changed`, and JS takes that lock to call
`pw_stream_*`. Integrating `pw_loop` into Node's loop instead (no `RT_PROCESS`) would make every
audio period depend on JS event loop latency.

So **no JS function is ever registered with libpipewire**. A tiny C shim, `libmoire-pwring.so`,
owns the `process` callbacks and a lock-free single-producer/single-consumer ring in native
memory:

- Playback: JS writes interleaved F32 frames into the ring (`moire_pwring_write`); `process`
  dequeues a buffer, copies up to `requested` frames out of the ring, zero-fills any shortfall
  (counted as an underrun once the stream has started), sets the chunk and queues it.
- Capture: `process` copies the chunk into the ring if it has room (else counts an overrun) and
  folds peak and sum-of-squares into atomics; JS takes them with `moire_pwring_take_levels`.
- State: JS reads `pw_stream_get_state` under `pw_thread_loop_lock`; no event callbacks.

The JS side holds the thread-loop lock only for short `pw_stream_*` calls, and the loop thread
never waits for JS, so there is no lock ordering to get wrong. The ring uses C11
acquire/release atomics on monotonically increasing 32-bit indices (power-of-two capacity), so
neither side ever blocks. Peak is kept as float bits in an atomic `uint32` (non-negative IEEE
floats order like their bit patterns, so a CAS max is exact); the sum of squares is fixed-point in
an atomic `uint64`. Taking levels exchanges three values separately: a `process` call landing in
between can shift one buffer between two meter ticks, which a 10 Hz meter cannot show.

Review notes for the shim (`packages/sys/native/moire-pwring.c`, about 260 lines with comments: the ring, two `process` callbacks, level folding):

- No allocation, locking, logging or syscalls in `process`; only `memcpy`, arithmetic and atomics.
- Every size is clamped to `maxsize` and to the chunk's `offset + size`; frames are whole.
- The stream pointer is attached before `pw_stream_connect` and the ring freed only after
  `pw_stream_destroy` (with the loop lock held), so `process` never sees a dangling ring.
- Built in Nix with `-std=c11 -O2 -Wall -Wextra -Werror -fPIC` against the image's PipeWire
  headers, and the ring smoke runs against the built library during the image build.

Libraries: `libpipewire-0.3.so.0` (from the image's `pipewire`, on the session's
`LD_LIBRARY_PATH`) and the shim at `$MOIRE_PWRING_LIBRARY`, which the Nix wrapper sets.
`MOIRE_PIPEWIRE_LIBRARY` overrides the libpipewire path (tests use a fake).

### API

```ts
playSound(source: { path: string } | { pcm: Pcm }, options?: { volume?: number; role?: "notification" | "event" })
  -> Promise<{ kind: "played" } | { kind: "unavailable"; message } | { kind: "error"; message }>
recordLevels({ onLevels({ peak, rms }), onEnd?(result), intervalMs? })
  -> { kind: "recording"; stop() } | { kind: "unavailable"; message }
recordStream({ onChunk(samples: Float32Array), onLevels?({ peak, rms }), onEnd?(message),
               rate? = 48000, channels? = 2, target?: nodeName, name?, intervalMs? = 100 })
  -> { kind: "recording"; recording: { stop(): { frames, overruns } } }
   | { kind: "unavailable"; message } | { kind: "error"; message }
createAlertPlayer() -> { play(): void }   // one alert at a time, at most one per 250 ms
```

`playSound` decodes WAV PCM (8/16/24/32-bit integer, 32-bit float; 1–8 channels; any rate) to
F32, scales by the cubic `volume`, and plays it at its own rate (PipeWire converts). Stream
properties carry `media.type=Audio`, `media.category=Playback`, `media.role=Notification`, so
WirePlumber routes and ducks it like any notification. `recordLevels` captures the default
source as mono F32 at 16 kHz and reports peak and RMS per interval; only levels leave the
module, never audio.

`recordStream` is the same capture stream with a ring that keeps the audio: two seconds of
interleaved F32 (so the JS event loop may stall that long before PipeWire's buffers are dropped
and counted as overruns). Each tick drains the ring completely into `onChunk` (a view into a
reused buffer, valid only during the call) and reports the stretch's levels. `stop()` drains what
is still buffered, then closes the stream and returns the frame and overrun counters. `onEnd`
fires after a final drain when PipeWire puts the stream into error, or when no audio has arrived
within two seconds. `target` sets `target.object` (a node name) for a specific input; without it
WirePlumber links the default source. Nothing in the shim changed for this: capture already
copied into the ring when it had capacity.

### Sound Recorder

`apps/bundled/sound-recorder/src/backend.ts` records with `recordStream` at 48 kHz stereo (the
format `pw-record` used to write) and writes 16-bit PCM WAV from TS: a 44-byte header with zero
sizes, each chunk appended at its offset in order, and the real RIFF/`data` sizes written at stop.
The take's length comes from the data size, so `ffprobe` is no longer needed. The input meter
beside "Recording" is the stream's peak. A missing libpipewire or shim is an error state ("PipeWire
isn't available…"); no CLI is spawned. If PipeWire stops the stream mid-take, what was captured
is kept as a take with a note; dropouts (overruns) are noted too. A take stops at the WAV 4 GiB
limit (about 6 hours). The input check still reads the default source with `AudioControl`. The app
has no device picker; `recordStream`'s `target` is there for one. Apps reach the libraries through
the session's `MOIRE_PWRING_LIBRARY` and `LD_LIBRARY_PATH` (set on `moire-session` in
`nix/moire.nix`).

### Notification sounds

The notification service calls its `sound` hook for a new notification (not a replacement) when
the app's rule has Sound on, Do not disturb (manual or scheduled) is off, and the sender didn't
pass the `suppress-sound` hint. The management service plays `packages/audio/assets/alert.wav`,
a 180 ms two-note chime generated by `alert.ts` (`src/generate-alert-sound.ts` rewrites
it; a smoke checks the file still matches the generator). Missing PipeWire is silent and logged
once.

## Migration off the CLIs

| Before                                          | After                                            |
| ----------------------------------------------- | ------------------------------------------------ |
| `wpctl inspect/get-volume/set-volume/set-mute`  | `AudioControl` Props/Route reads and writes      |
| `wpctl status`, `pactl list` JSON               | registry + `Props` enumeration                   |
| `wpctl set-default`, `pactl set-default-*`      | `default` Metadata `default.configured.audio.*`  |
| `pw-record` for the Settings input meter        | `recordLevels` capture stream                    |
| `pw-record` + `ffprobe` in Sound Recorder       | `recordStream` + a TS WAV writer                 |
| `prefs.applyVolume`/`readSystemVolume` (unused) | removed; the management service owns live volume |
| Sound Recorder's `wpctl inspect` input probe    | `AudioControl.read()` default source             |

The `pactl` fallback is dropped: the image always runs PipeWire, and pipewire-pulse is itself a
PipeWire client. `pw-record` is gone: Sound Recorder, the last user, now records through
`recordStream`.

## Tests

- `packages/audio/src/pod.smoke.ts`: round trip of every type, golden bytes for scalars,
  strings, arrays, structs, objects and choices, and a `hello` message; malformed input is
  rejected without reading past the buffer.
- `packages/audio/src/control.smoke.ts`: the client against `testing.ts` over a real
  Unix socket: registry, info and params, cubic volume, Props vs device Route writes, mute,
  default via metadata, per-app streams, profiles, global removal, ping/pong, server errors,
  remove_id reuse, aborts, deadlines, a vanished server and reconnection.
- `packages/audio/src/audio-devices.smoke.ts`, `audio-status.smoke.ts`: the adapters' old
  behavioural cases ported to the fake server.
- `packages/audio/src/sound.smoke.ts`: WAV decode/encode and the streaming header, the alert
  asset, `recordStream` draining (order, stop hands over the rest, PipeWire errors, `target`),
  the alert player's rate limit, and the input meter adapter with a fake level source.
- `apps/bundled/sound-recorder/src/smoke.ts`: the recorder with no PipeWire library and with an
  input that never delivers, then real capture through koffi against the fake libpipewire (built
  by `buildFakePipeWire`): the WAV's sizes and every sample, levels, save/no-overwrite/discard,
  PipeWire failing mid-take, and closing mid-take leaving nothing behind.
  `MOIRE_TEST_AUDIO_INPUT=1` records from a real session input instead.
- `packages/sys/src/pipewire-stream.smoke.ts`: compiles the shim against a fake libpipewire
  (`packages/sys/native/fake-pipewire/`) with the host `cc`, then drives the ring (wraparound,
  partial reads, full/empty) and real playback/capture streams through koffi: bytes reach the
  fake sink in order, underruns are zero-filled, capture levels match the injected signal, and
  stop/destroy ordering is clean. Skips (prints SKIP) without a C compiler.
- `packages/sys/src/pipewire-ring.native.smoke.ts`: in the Nix build, the real shim built
  against real PipeWire headers loads and passes the ring cases (no daemon needed).
- `packages/audio/src/test-devices.smoke.ts`: the VM's null test devices (above).
- Management service: desktop-controls, shutdown and notification smokes use the fake server;
  a notification smoke checks the sound hook against rules, DND and replacements.

## VM checks

The UTM VM runs QEMU with `-audio none`, so there are no sound cards. The native desktop image
(the VM image) sets `moire.sound.testDevices = true` (`nix/moire-sound-services.nix`, default
false), which adds two PipeWire null devices from `nix/moire-sound-test-devices.json` as
`/etc/pipewire/pipewire.conf.d/90-moire-test-devices.conf`: "Moire Test Output"
(`moire_test_output`, `Audio/Sink`) and "Moire Test Input" (`moire_test_input`, `Audio/Source`),
both `support.null-audio-sink` adapters. With no other devices WirePlumber makes them the
defaults, so the alert plays into the test output. An image for real hardware leaves the option
unset (or sets it false). `packages/audio/src/test-devices.smoke.ts` checks the config, that only
the VM image enables it, and that nodes with those properties are listed and driven.

```sh
# In the guest, as the session user: both nodes, and the defaults pointing at them.
wpctl status
pw-cli ls Node | grep -A3 moire_test
# Hear nothing, but see the chime arrive: record the output's monitor, then notify.
pw-record --target moire_test_output --properties stream.capture.sink=true /tmp/chime.wav &
notify-send hi; sleep 1; kill %1   # /tmp/chime.wav is non-silent
```

1. Settings › Sound lists "Moire Test Output" and "Moire Test Input" as the defaults; the Quick
   Settings slider moves the volume (`wpctl get-volume @DEFAULT_AUDIO_SINK@` agrees) and mute
   toggles. To test switching outputs, add a second null sink with `pw-cli create-node adapter
'{ factory.name=support.null-audio-sink node.name=extra media.class=Audio/Sink
object.linger=true audio.position=[FL FR] }'` and choose it; `wpctl status`'s `*` follows.
2. `pw-play --volume 0.5 /some.wav &` appears as an app with a working slider and mute.
3. Open Settings › Sound: `pw-top` shows a `moire-input-meter` capture stream while the page is
   open and none after it closes. The null source is silent, so the meter stays at zero.
4. Sound Recorder: record a few seconds. `pw-top` shows a `moire-sound-recorder` capture stream
   only while recording, and no `pw-record` process exists. The saved take is 48 kHz stereo
   16-bit and silent (the null source); its length matches the time recorded.
5. `notify-send hi` plays the alert: `pw-top` shows `moire-alert` briefly; with Do not
   disturb or the app's Sound off, it does not appear.
6. In a terminal in the session:
   `MOIRE_TEST_LIVE_AUDIO=1 MOIRE_PWRING_LIBRARY=… tsx packages/audio/src/live-audio.smoke.ts`
   lists the nodes and defaults, rewrites the default output's volume unchanged, plays the alert
   and meters the input for a second.
7. `systemctl --user restart pipewire wireplumber`: Settings shows "unavailable" briefly, then
   recovers without restarting the session.
