/** Scanout ownership, independent of DRM bindings so failures can be exercised locally. */
export type KmsPresentationFeedback = {
  sequence: number;
  seconds: number;
  nanoseconds: number;
  vsync: boolean;
  hardwareClock: boolean;
  hardwareCompletion: boolean;
};

/**
 * DRM page-flip events also cover fake/software vblank completion. Their
 * arrival establishes buffer retirement, not display retrace or hardware
 * timestamps. Preserve the kernel payload without claiming unproven timing.
 * See drm_crtc_send_vblank_event() and wp_presentation's kind flag definitions.
 */
export function pageFlipFeedback(
  sequence: number,
  seconds: number,
  microseconds: number,
): KmsPresentationFeedback {
  return {
    sequence,
    seconds,
    nanoseconds: microseconds * 1_000,
    vsync: false,
    hardwareClock: false,
    hardwareCompletion: false,
  };
}

export type PageFlipQueueResult =
  | { kind: "queued" }
  | { kind: "unsupported" }
  | { kind: "failed"; error: Error };

export type ScanoutBackend = {
  queue: (framebuffer: number, token: number) => PageFlipQueueResult;
  setFramebuffer: (framebuffer: number) => void;
};

type PendingFrame = {
  framebuffer: number;
  token: number;
  resolve: (feedback: KmsPresentationFeedback) => void;
  reject: (error: Error) => void;
  cancelTimeout: () => void;
};

type ScanoutState =
  | { kind: "ready"; activeFramebuffer: number }
  | { kind: "queued"; activeFramebuffer: number; pending: PendingFrame }
  | {
      kind: "quarantined";
      activeFramebuffer: number;
      pending: PendingFrame | null;
      reason: Error;
    }
  | { kind: "closed" };

function fallbackFeedback(): KmsPresentationFeedback {
  const now = process.hrtime.bigint();
  return {
    sequence: 0,
    seconds: Number(now / 1_000_000_000n),
    nanoseconds: Number(now % 1_000_000_000n),
    vsync: false,
    hardwareClock: false,
    hardwareCompletion: false,
  };
}

export class ScanoutPresenter {
  private state: ScanoutState;
  private readonly framebuffers: Set<number>;
  private nextToken = 1;
  private pageFlipsSupported = true;
  private onAvailable: (() => void) | undefined;

  constructor(
    activeFramebuffer: number,
    private readonly backend: ScanoutBackend,
    private readonly options: {
      timeoutMs?: number;
      schedule?: (callback: () => void, milliseconds: number) => () => void;
    } = {},
  ) {
    this.state = { kind: "ready", activeFramebuffer };
    this.framebuffers = new Set([activeFramebuffer]);
  }

  get status(): ScanoutState["kind"] {
    return this.state.kind;
  }

  get usesPageFlips(): boolean {
    return this.pageFlipsSupported;
  }

  setAvailableCallback(callback: (() => void) | undefined): void {
    this.onAvailable = callback;
  }

  canWrite(framebuffer: number): boolean {
    return this.state.kind === "ready" && this.state.activeFramebuffer !== framebuffer;
  }

  ownsFramebuffer(framebuffer: number): boolean {
    return this.framebuffers.has(framebuffer);
  }

  get activeFramebuffer(): number | null {
    return this.state.kind === "ready" ? this.state.activeFramebuffer : null;
  }

  canRetire(framebuffer: number): boolean {
    switch (this.state.kind) {
      case "ready":
        return this.state.activeFramebuffer !== framebuffer;
      case "queued":
        return (
          this.state.activeFramebuffer !== framebuffer &&
          this.state.pending.framebuffer !== framebuffer
        );
      case "quarantined":
        // A failed syscall/event dispatch cannot establish which target is live.
        return false;
      case "closed":
        return true;
    }
  }

  async present(framebuffer: number): Promise<KmsPresentationFeedback> {
    if (!this.canWrite(framebuffer)) {
      throw new Error(`Framebuffer ${framebuffer} is not idle (${this.state.kind})`);
    }
    const current = this.state;
    if (current.kind !== "ready") throw new Error("Scanout is not ready");
    this.framebuffers.add(framebuffer);
    if (!this.pageFlipsSupported) return this.presentWithoutVsync(framebuffer);

    return new Promise<KmsPresentationFeedback>((resolve, reject) => {
      const pending: PendingFrame = {
        framebuffer,
        token: this.nextToken++,
        resolve,
        reject,
        cancelTimeout: () => {},
      };
      this.state = { kind: "queued", activeFramebuffer: current.activeFramebuffer, pending };
      let queued: PageFlipQueueResult;
      try {
        queued = this.backend.queue(framebuffer, pending.token);
      } catch (error) {
        this.quarantine(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      switch (queued.kind) {
        case "queued": {
          const schedule =
            this.options.schedule ??
            ((callback: () => void, milliseconds: number) => {
              const timer = setTimeout(callback, milliseconds);
              return () => clearTimeout(timer);
            });
          pending.cancelTimeout = schedule(() => {
            if (this.state.kind !== "queued" || this.state.pending.token !== pending.token) return;
            this.quarantine(new Error(`DRM page flip timed out for framebuffer ${framebuffer}`));
          }, this.options.timeoutMs ?? 1_000);
          break;
        }
        case "unsupported":
          this.pageFlipsSupported = false;
          this.state = current;
          try {
            resolve(this.presentWithoutVsync(framebuffer));
          } catch (error) {
            reject(error);
          }
          break;
        case "failed":
          this.quarantine(queued.error);
          break;
      }
    });
  }

  private presentWithoutVsync(framebuffer: number): KmsPresentationFeedback {
    // Blocking SetCrtc establishes ownership but provides no vblank timestamp
    // or tear-free timing guarantee. Report all hardware/vsync flags as false.
    try {
      this.backend.setFramebuffer(framebuffer);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.quarantine(failure);
      throw failure;
    }
    this.state = { kind: "ready", activeFramebuffer: framebuffer };
    this.framebuffers.add(framebuffer);
    return fallbackFeedback();
  }

  quarantine(reason: Error): void {
    const current = this.state;
    if (current.kind === "closed" || current.kind === "quarantined") return;
    const pending = current.kind === "queued" ? current.pending : null;
    this.state = {
      kind: "quarantined",
      activeFramebuffer: current.activeFramebuffer,
      pending,
      reason,
    };
    pending?.cancelTimeout();
    pending?.reject(reason);
    // Retain the token and both possible owners until a matching event or modeset.
  }

  complete(token: number, feedback: KmsPresentationFeedback): boolean {
    const current = this.state;
    if (current.kind !== "queued" && current.kind !== "quarantined") return false;
    const pending = current.pending;
    if (!pending || pending.token !== token) return false;
    pending.cancelTimeout();
    this.state = { kind: "ready", activeFramebuffer: pending.framebuffer };
    pending.resolve(feedback);
    if (current.kind === "quarantined") this.onAvailable?.();
    return true;
  }

  /** Call only after a successful kernel modeset has replaced any queued scanout. */
  confirmHandoff(framebuffer: number): void {
    if (this.state.kind === "closed") throw new Error("Scanout is closed");
    const wasQuarantined = this.state.kind === "quarantined";
    this.rejectPending(new Error("DRM page flip replaced by confirmed modeset"));
    this.framebuffers.add(framebuffer);
    this.state = { kind: "ready", activeFramebuffer: framebuffer };
    if (wasQuarantined) this.onAvailable?.();
  }

  /** Call only after scanout is disabled or the owning DRM fd has closed. */
  close(): void {
    if (this.state.kind === "closed") return;
    this.rejectPending(new Error("DRM output closed"));
    this.state = { kind: "closed" };
    this.onAvailable = undefined;
  }

  private rejectPending(reason: Error): void {
    if (this.state.kind !== "queued" && this.state.kind !== "quarantined") return;
    this.state.pending?.cancelTimeout();
    this.state.pending?.reject(reason);
  }
}

/** Two CPU scanout allocations; the initial framebuffer is owned by the output. */
export class ReadbackScanoutPool<Frame extends { fbId: number }> {
  private second: Frame | null = null;

  constructor(
    private initial: Frame,
    private readonly ownership: ScanoutPresenter,
    private readonly backend: {
      allocate: () => Frame;
      copy: (frame: Frame, pixels: Uint8Array) => void;
      destroy: (frame: Frame) => void;
    },
  ) {}

  write(pixels: Uint8Array): number {
    if (this.ownership.status !== "ready") {
      throw new Error(`Readback scanout is ${this.ownership.status}`);
    }
    this.second ??= this.backend.allocate();
    const frame = this.ownership.canWrite(this.second.fbId)
      ? this.second
      : this.ownership.canWrite(this.initial.fbId)
        ? this.initial
        : null;
    if (!frame) throw new Error("No idle readback framebuffer");
    this.backend.copy(frame, pixels);
    return frame.fbId;
  }

  /** Only confirmed handoff or disabled scanout permits retiring the second allocation. */
  reset(initial: Frame): void {
    this.destroy();
    this.initial = initial;
  }

  destroy(): void {
    if (!this.second) return;
    if (!this.ownership.canRetire(this.second.fbId)) {
      throw new Error(`Cannot retire owned readback framebuffer ${this.second.fbId}`);
    }
    this.backend.destroy(this.second);
    this.second = null;
  }
}

/** Preserve row padding when drivers allocate different pitches for the two buffers. */
export function packScanoutPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  sourcePitch: number,
  targetPitch: number,
  targetSize: number,
): Uint8Array {
  const rowBytes = width * 4;
  if (
    width < 1 ||
    height < 1 ||
    sourcePitch < rowBytes ||
    targetPitch < rowBytes ||
    pixels.byteLength < sourcePitch * (height - 1) + rowBytes ||
    targetSize < targetPitch * height
  ) {
    throw new Error("Invalid readback scanout dimensions or pixel buffer");
  }
  if (sourcePitch === targetPitch && pixels.byteLength >= targetSize) {
    return pixels.subarray(0, targetSize);
  }
  const packed = new Uint8Array(targetSize);
  for (let y = 0; y < height; y++) {
    packed.set(pixels.subarray(y * sourcePitch, y * sourcePitch + rowBytes), y * targetPitch);
  }
  return packed;
}
