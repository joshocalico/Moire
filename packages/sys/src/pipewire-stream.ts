/**
 * PipeWire sample streams through libpipewire, with the realtime `process` callback in the
 * `libmoire-pwring` shim (packages/sys/native/moire-pwring.c). No JS function is registered with
 * libpipewire: JS fills or drains the shim's lock-free ring and polls stream state under the
 * thread-loop lock, which the loop thread never waits on JS to release. See docs/audio.md.
 *
 * Samples are interleaved F32. The caller supplies the EnumFormat POD (built by @moire/audio), so
 * this file knows nothing of SPA beyond the stream calls.
 */
import koffi from "koffi";
import { bindNativeFunction, type NativeFunction } from "./ffi";

export type PipeWireStreamOptions = {
  readonly direction: "playback" | "capture";
  readonly name: string;
  readonly properties: Readonly<Record<string, string>>;
  /** An encoded `EnumFormat` POD for interleaved F32 at `channels`. */
  readonly format: Uint8Array;
  readonly channels: number;
  /** Ring capacity in bytes (rounded up to a power of two); 0 meters a capture without keeping audio. */
  readonly ringBytes: number;
};

export type PipeWireStreamState = "error" | "unconnected" | "connecting" | "paused" | "streaming";

export type OpenPipeWireStream =
  | { readonly kind: "ok"; readonly stream: PipeWireStream }
  | { readonly kind: "unavailable"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

type Pointer = unknown;

type Bindings = {
  threadLoopLock: NativeFunction<[loop: Pointer], void>;
  threadLoopUnlock: NativeFunction<[loop: Pointer], void>;
  propertiesNew: NativeFunction<[key: null], Pointer>;
  propertiesSet: NativeFunction<[props: Pointer, key: string, value: string], number>;
  streamNewSimple: NativeFunction<
    [loop: Pointer, name: string, props: Pointer, events: Pointer, data: Pointer],
    Pointer
  >;
  streamConnect: NativeFunction<
    [
      stream: Pointer,
      direction: number,
      target: number,
      flags: number,
      params: Pointer,
      count: number,
    ],
    number
  >;
  streamGetState: NativeFunction<[stream: Pointer, error: [string | null]], number>;
  streamDisconnect: NativeFunction<[stream: Pointer], number>;
  streamDestroy: NativeFunction<[stream: Pointer], void>;
  ringNew: NativeFunction<[capacity: number, stride: number], Pointer>;
  ringFree: NativeFunction<[ring: Pointer], void>;
  ringAttach: NativeFunction<[ring: Pointer, stream: Pointer], void>;
  ringFinish: NativeFunction<[ring: Pointer], void>;
  ringReadable: NativeFunction<[ring: Pointer], number>;
  ringWritable: NativeFunction<[ring: Pointer], number>;
  ringWrite: NativeFunction<[ring: Pointer, source: Uint8Array, bytes: number], number>;
  ringRead: NativeFunction<[ring: Pointer, destination: Uint8Array, bytes: number], number>;
  ringCounters: NativeFunction<[ring: Pointer, out: BigUint64Array], void>;
  ringTakeLevels: NativeFunction<[ring: Pointer, out: Float32Array], number | bigint>;
  playbackEvents: Pointer;
  captureEvents: Pointer;
  loop: Pointer;
  threadLoop: Pointer;
};

/** `SPA_DIRECTION_*`, `PW_ID_ANY` and `PW_STREAM_FLAG_AUTOCONNECT | MAP_BUFFERS | RT_PROCESS`. */
const DIRECTION = { capture: 0, playback: 1 } as const;
const PW_ID_ANY = 0xffffffff;
const STREAM_FLAGS = (1 << 0) | (1 << 2) | (1 << 4);
const STATES: Record<number, PipeWireStreamState> = {
  [-1]: "error",
  0: "unconnected",
  1: "connecting",
  2: "paused",
  3: "streaming",
};
const SAMPLE_BYTES = 4;

let bindings: Bindings | null = null;
let loadError: string | null = null;

/** The libraries: `MOIRE_PIPEWIRE_LIBRARY` / `MOIRE_PWRING_LIBRARY` override the system names. */
function load(): Bindings {
  if (bindings) return bindings;
  if (loadError) throw new Error(loadError);
  try {
    const pw = koffi.load(process.env.MOIRE_PIPEWIRE_LIBRARY || "libpipewire-0.3.so.0");
    const shim = koffi.load(process.env.MOIRE_PWRING_LIBRARY || "libmoire-pwring.so");
    const fn = <F extends (...args: never[]) => unknown>(lib: typeof pw, declaration: string) =>
      bindNativeFunction<F>(lib, declaration);
    const init = fn<(argc: null, argv: null) => void>(pw, "void pw_init(int *argc, void *argv)");
    const threadLoopNew = fn<(name: string, props: null) => Pointer>(
      pw,
      "void *pw_thread_loop_new(const char *name, const void *props)",
    );
    const threadLoopStart = fn<(loop: Pointer) => number>(
      pw,
      "int pw_thread_loop_start(void *loop)",
    );
    const threadLoopGetLoop = fn<(loop: Pointer) => Pointer>(
      pw,
      "void *pw_thread_loop_get_loop(void *loop)",
    );
    init(null, null);
    const threadLoop = threadLoopNew("moire-audio", null);
    if (!threadLoop) throw new Error("pw_thread_loop_new failed");
    if (threadLoopStart(threadLoop) < 0) throw new Error("pw_thread_loop_start failed");
    const events = (name: string) => fn<() => Pointer>(shim, `const void *${name}(void)`)();
    bindings = {
      threadLoopLock: fn(pw, "void pw_thread_loop_lock(void *loop)"),
      threadLoopUnlock: fn(pw, "void pw_thread_loop_unlock(void *loop)"),
      propertiesNew: fn(pw, "void *pw_properties_new(const char *key, ...)"),
      propertiesSet: fn(
        pw,
        "int pw_properties_set(void *props, const char *key, const char *value)",
      ),
      streamNewSimple: fn(
        pw,
        "void *pw_stream_new_simple(void *loop, const char *name, void *props, const void *events, void *data)",
      ),
      streamConnect: fn(
        pw,
        "int pw_stream_connect(void *stream, int direction, uint32_t target, int flags, void *params, uint32_t count)",
      ),
      streamGetState: fn(pw, "int pw_stream_get_state(void *stream, _Out_ const char **error)"),
      streamDisconnect: fn(pw, "int pw_stream_disconnect(void *stream)"),
      streamDestroy: fn(pw, "void pw_stream_destroy(void *stream)"),
      ringNew: fn(shim, "void *moire_pwring_new(uint32_t capacity, uint32_t stride)"),
      ringFree: fn(shim, "void moire_pwring_free(void *ring)"),
      ringAttach: fn(shim, "void moire_pwring_attach(void *ring, void *stream)"),
      ringFinish: fn(shim, "void moire_pwring_finish(void *ring)"),
      ringReadable: fn(shim, "uint32_t moire_pwring_readable(void *ring)"),
      ringWritable: fn(shim, "uint32_t moire_pwring_writable(void *ring)"),
      ringWrite: fn(
        shim,
        "uint32_t moire_pwring_write(void *ring, const void *source, uint32_t bytes)",
      ),
      ringRead: fn(
        shim,
        "uint32_t moire_pwring_read(void *ring, void *destination, uint32_t bytes)",
      ),
      ringCounters: fn(shim, "void moire_pwring_counters(void *ring, uint64_t *out)"),
      ringTakeLevels: fn(shim, "uint64_t moire_pwring_take_levels(void *ring, float *out)"),
      playbackEvents: events("moire_pwring_playback_events"),
      captureEvents: events("moire_pwring_capture_events"),
      loop: threadLoopGetLoop(threadLoop),
      threadLoop,
    };
    return bindings;
  } catch (error) {
    loadError =
      `PipeWire's library isn't available: ${error instanceof Error ? error.message : String(error)}`.slice(
        0,
        512,
      );
    throw new Error(loadError);
  }
}

function locked<T>(b: Bindings, work: () => T): T {
  b.threadLoopLock(b.threadLoop);
  try {
    return work();
  } finally {
    b.threadLoopUnlock(b.threadLoop);
  }
}

export function openPipeWireStream(options: PipeWireStreamOptions): OpenPipeWireStream {
  let b: Bindings;
  try {
    b = load();
  } catch (error) {
    return { kind: "unavailable", message: (error as Error).message };
  }
  if (!Number.isInteger(options.channels) || options.channels < 1 || options.channels > 8)
    return { kind: "error", message: "A stream has 1 to 8 channels." };
  const stride = options.channels * SAMPLE_BYTES;
  const ring = b.ringNew(options.ringBytes, stride);
  if (!ring) return { kind: "error", message: "Couldn't allocate the audio ring." };
  const pod = koffi.alloc("uint8_t", Math.max(1, options.format.length));
  const params = koffi.alloc("void *", 1);
  try {
    new Uint8Array(koffi.view(pod, options.format.length) as ArrayBuffer).set(options.format);
    koffi.encode(params, "void *", pod);
    const stream = locked(b, () => {
      const props = b.propertiesNew(null);
      for (const [key, value] of Object.entries(options.properties))
        b.propertiesSet(props, key, value);
      // Takes ownership of props, even on failure.
      const created = b.streamNewSimple(
        b.loop,
        options.name,
        props,
        options.direction === "playback" ? b.playbackEvents : b.captureEvents,
        ring,
      );
      if (!created) return null;
      b.ringAttach(ring, created);
      const result = b.streamConnect(
        created,
        DIRECTION[options.direction],
        PW_ID_ANY,
        STREAM_FLAGS,
        params,
        1,
      );
      if (result < 0) {
        b.streamDestroy(created);
        return null;
      }
      return created;
    });
    if (!stream) {
      b.ringFree(ring);
      return { kind: "error", message: "PipeWire refused the stream." };
    }
    return { kind: "ok", stream: new PipeWireStream(b, stream, ring, options.channels) };
  } catch (error) {
    b.ringFree(ring);
    return {
      kind: "error",
      message: `Couldn't open a PipeWire stream: ${(error as Error).message}`.slice(0, 512),
    };
  } finally {
    koffi.free(pod);
    koffi.free(params);
  }
}

export class PipeWireStream {
  private closed = false;
  private readonly counterBuffer = new BigUint64Array(3);
  private readonly levelBuffer = new Float32Array(2);

  constructor(
    private readonly b: Bindings,
    private readonly stream: Pointer,
    private readonly ring: Pointer,
    readonly channels: number,
  ) {}

  /** Queue interleaved samples for playback; returns the frames the ring took. */
  write(samples: Float32Array): number {
    if (this.closed) return 0;
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    return this.b.ringWrite(this.ring, bytes, bytes.length) / SAMPLE_BYTES / this.channels;
  }

  /** Take captured interleaved samples; returns the frames copied. */
  read(into: Float32Array): number {
    if (this.closed) return 0;
    const bytes = new Uint8Array(into.buffer, into.byteOffset, into.byteLength);
    return this.b.ringRead(this.ring, bytes, bytes.length) / SAMPLE_BYTES / this.channels;
  }

  /** Frames waiting in the ring (to be played, or to be read). */
  get bufferedFrames(): number {
    return this.closed ? 0 : this.b.ringReadable(this.ring) / SAMPLE_BYTES / this.channels;
  }

  get writableFrames(): number {
    return this.closed ? 0 : this.b.ringWritable(this.ring) / SAMPLE_BYTES / this.channels;
  }

  /** Peak and RMS of captured audio since the last call. */
  takeLevels(): { peak: number; rms: number; samples: number } {
    if (this.closed) return { peak: 0, rms: 0, samples: 0 };
    const samples = Number(this.b.ringTakeLevels(this.ring, this.levelBuffer));
    return { peak: this.levelBuffer[0]!, rms: this.levelBuffer[1]!, samples };
  }

  counters(): { frames: number; underruns: number; overruns: number } {
    if (!this.closed) this.b.ringCounters(this.ring, this.counterBuffer);
    const [frames = 0n, underruns = 0n, overruns = 0n] = this.counterBuffer;
    return { frames: Number(frames), underruns: Number(underruns), overruns: Number(overruns) };
  }

  state(): { state: PipeWireStreamState; error: string | null } {
    if (this.closed) return { state: "unconnected", error: null };
    const error: [string | null] = [null];
    const state = locked(this.b, () => this.b.streamGetState(this.stream, error));
    return { state: STATES[state] ?? "error", error: error[0] ? error[0].slice(0, 256) : null };
  }

  /** No more audio is coming: silence after this isn't an underrun. */
  finish(): void {
    if (!this.closed) this.b.ringFinish(this.ring);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    locked(this.b, () => {
      this.b.streamDisconnect(this.stream);
      this.b.streamDestroy(this.stream);
    });
    // process can no longer run: the stream is gone.
    this.b.ringFree(this.ring);
  }
}
