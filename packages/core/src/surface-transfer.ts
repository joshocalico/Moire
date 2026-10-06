/** Observed transfer work. Missing instrumentation stays unknown, never inferred. */
export type SurfaceTransferOperation = "import" | "map" | "copy" | "upload" | "readback";

export type SurfaceTransferIdentity = {
  clientId: number;
  surfaceId: number;
};

export type SurfaceTransferCommit = SurfaceTransferIdentity & {
  renderer: string;
  bufferKind: "shm" | "dmabuf";
  storage: "cpu" | "gpu";
  width: number;
  height: number;
  /** Actual returned snapshot stride, not the producer's requested stride. */
  stride: number;
  updated: boolean;
  /** Union of updated source pixels, supplied by the caller. */
  updatedAreaPixels: number;
};

export type SurfaceTransferMeasurement = SurfaceTransferIdentity & {
  operation: SurfaceTransferOperation;
  bytes: number;
  /** CPU time from process.cpuUsage, in milliseconds. GPU wait wall time is not CPU time. */
  cpuMs: number | null;
};

export type SurfaceTransferTotal = {
  count: number;
  bytes: number;
  cpuMs: number | null;
  /** No GPU timer query exists at this boundary. */
  gpuMs: null;
};

export type SurfaceTransferSnapshot = SurfaceTransferIdentity & {
  renderer: string;
  bufferKind: SurfaceTransferCommit["bufferKind"];
  storage: SurfaceTransferCommit["storage"];
  width: number;
  height: number;
  stride: number;
  bufferAreaPixels: number;
  snapshotBytes: number;
  commits: number;
  updatedCommits: number;
  idleCommits: number;
  updatedAreaPixels: number;
  operations: Record<SurfaceTransferOperation, SurfaceTransferTotal | null>;
};

function emptyOperations(): SurfaceTransferSnapshot["operations"] {
  return { import: null, map: null, copy: null, upload: null, readback: null };
}

function copyTotal(total: SurfaceTransferTotal | null): SurfaceTransferTotal | null {
  return total ? { ...total } : null;
}

/** Opt-in collector. Call commit before recording work for that surface generation. */
export class SurfaceTransferCollector {
  private readonly clients = new Map<number, Map<number, SurfaceTransferSnapshot>>();

  constructor(readonly enabled = false) {}

  commit(input: SurfaceTransferCommit): void {
    if (!this.enabled) return;
    let surfaces = this.clients.get(input.clientId);
    if (!surfaces) {
      surfaces = new Map();
      this.clients.set(input.clientId, surfaces);
    }
    const candidate = surfaces.get(input.surfaceId);
    const previous =
      candidate?.renderer === input.renderer &&
      candidate.storage === input.storage &&
      candidate.bufferKind === input.bufferKind
        ? candidate
        : undefined;
    surfaces.set(input.surfaceId, {
      clientId: input.clientId,
      surfaceId: input.surfaceId,
      renderer: input.renderer,
      bufferKind: input.bufferKind,
      storage: input.storage,
      width: input.width,
      height: input.height,
      stride: input.stride,
      bufferAreaPixels: input.width * input.height,
      snapshotBytes: input.stride * input.height,
      commits: (previous?.commits ?? 0) + 1,
      updatedCommits: (previous?.updatedCommits ?? 0) + Number(input.updated),
      idleCommits: (previous?.idleCommits ?? 0) + Number(!input.updated),
      updatedAreaPixels:
        (previous?.updatedAreaPixels ?? 0) + (input.updated ? input.updatedAreaPixels : 0),
      operations: previous?.operations ?? emptyOperations(),
    });
  }

  record(input: SurfaceTransferMeasurement): void {
    if (!this.enabled) return;
    const surface = this.clients.get(input.clientId)?.get(input.surfaceId);
    if (!surface) throw new Error("Transfer measurement requires a committed surface");
    const previous = surface.operations[input.operation];
    surface.operations[input.operation] = {
      count: (previous?.count ?? 0) + 1,
      bytes: (previous?.bytes ?? 0) + input.bytes,
      cpuMs:
        input.cpuMs === null || previous?.cpuMs === null
          ? null
          : (previous?.cpuMs ?? 0) + input.cpuMs,
      gpuMs: null,
    };
  }

  idleCommit(clientId: number, surfaceId: number): void {
    if (!this.enabled) return;
    const surface = this.clients.get(clientId)?.get(surfaceId);
    if (!surface) return;
    surface.commits++;
    surface.idleCommits++;
  }

  snapshot(): SurfaceTransferSnapshot[] {
    const result: SurfaceTransferSnapshot[] = [];
    for (const surfaces of this.clients.values()) {
      for (const surface of surfaces.values()) {
        result.push({
          ...surface,
          operations: {
            import: copyTotal(surface.operations.import),
            map: copyTotal(surface.operations.map),
            copy: copyTotal(surface.operations.copy),
            upload: copyTotal(surface.operations.upload),
            readback: copyTotal(surface.operations.readback),
          },
        });
      }
    }
    return result;
  }

  removeSurface(clientId: number, surfaceId: number): void {
    const surfaces = this.clients.get(clientId);
    surfaces?.delete(surfaceId);
    if (surfaces?.size === 0) this.clients.delete(clientId);
  }

  removeClient(clientId: number): void {
    this.clients.delete(clientId);
  }

  clear(): void {
    this.clients.clear();
  }
}
