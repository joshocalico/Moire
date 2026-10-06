import { isDeepStrictEqual } from "node:util";
import { DbusRemoteError, type DbusMethodContext, type SessionBus } from "@moire/dbus";
import {
  STORAGE_INTERFACE,
  STORAGE_PATH,
  StorageControlError,
  parseStorageState,
  parseStorageVolumeId,
  type StorageAdapter,
  type StorageSnapshot,
  type StorageState,
} from "@moire/system-management/storage-status";

export type StorageControlOptions = {
  adapter: StorageAdapter;
  onError?: (error: unknown) => void;
};

function argumentsFor(context: DbusMethodContext, signature: string, length: number): unknown[] {
  if ((context.message.signature ?? "") !== signature || context.body.length !== length)
    throw new Error("Invalid storage method arguments");
  return context.body;
}

/** Adds Storage1 to the already-owned session service; never acquires another name. */
export function attachStorageControls(bus: SessionBus, options: StorageControlOptions) {
  const adapter = options.adapter;
  let revision = 1;
  let published: StorageState = parseStorageState(adapter.state);
  let disposed = false;
  let dispatching = false;
  let disposePromise: Promise<void> | null = null;
  const snapshot = (): StorageSnapshot => ({ revision, ...structuredClone(published) });
  const publish = () => {
    if (disposed) return;
    try {
      const next = parseStorageState(adapter.state);
      if (isDeepStrictEqual(published, next)) return;
      if (revision === 0xffff_ffff) throw new Error("Storage revision exhausted");
      published = next;
      revision++;
      bus.emitSignal({
        path: STORAGE_PATH,
        interface: STORAGE_INTERFACE,
        member: "Changed",
        signature: "s",
        body: [JSON.stringify(snapshot())],
      });
    } catch (error) {
      void dispose().catch((error) => options.onError?.(error));
      options.onError?.(error);
    }
  };
  const operate = async (run: () => Promise<void>, mutation: boolean) => {
    live();
    if (dispatching || (mutation && published.operation.kind === "pending"))
      throw new DbusRemoteError(
        `${STORAGE_INTERFACE}.Error.busy`,
        "Storage operation already pending",
      );
    dispatching = true;
    try {
      await run();
    } catch (error) {
      if (error instanceof StorageControlError)
        throw new DbusRemoteError(error.errorName, error.message);
      throw error;
    } finally {
      dispatching = false;
      publish();
    }
    return {};
  };
  const live = () => {
    if (disposed)
      throw new DbusRemoteError(`${STORAGE_INTERFACE}.Error.gone`, "Storage controls disposed");
  };
  const action = async (
    context: DbusMethodContext,
    run: (id: ReturnType<typeof parseStorageVolumeId>) => Promise<void>,
  ) => {
    live();
    const [rawId, expected] = argumentsFor(context, "su", 2);
    const id = parseStorageVolumeId(rawId);
    if (
      typeof expected !== "number" ||
      !Number.isInteger(expected) ||
      expected < 0 ||
      expected > 0xffff_ffff
    )
      throw new Error("Invalid storage revision");
    if (expected !== revision)
      throw new DbusRemoteError(
        `${STORAGE_INTERFACE}.Error.gone`,
        "Storage status changed; refresh before retrying",
      );
    return operate(() => run(id), true);
  };
  const refresh = () => operate(() => adapter.refresh(), false);
  const unexport = bus.exportObject(STORAGE_PATH, {
    name: STORAGE_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: (context) => {
          live();
          argumentsFor(context, "", 0);
          return { body: [JSON.stringify(snapshot())] };
        },
      },
      Refresh: {
        inSignature: "",
        outSignature: "",
        handler: async (context) => {
          live();
          argumentsFor(context, "", 0);
          return refresh();
        },
      },
      Mount: {
        inSignature: "su",
        outSignature: "",
        handler: (context) => action(context, (id) => adapter.mount(id)),
      },
      Unmount: {
        inSignature: "su",
        outSignature: "",
        handler: (context) => action(context, (id) => adapter.unmount(id)),
      },
      Eject: {
        inSignature: "su",
        outSignature: "",
        handler: (context) => action(context, (id) => adapter.eject(id)),
      },
    },
  });
  let unsubscribe = () => {};
  let removeDisconnect = () => {};
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    const failures: unknown[] = [];
    for (const retire of [unsubscribe, unexport, removeDisconnect]) {
      try {
        retire();
      } catch (error) {
        failures.push(error);
      }
    }
    disposePromise = Promise.resolve().then(async () => {
      await adapter.dispose();
      if (failures.length) throw failures[0];
    });
    return disposePromise;
  };
  try {
    unsubscribe = adapter.subscribe(publish);
  } catch (error) {
    void dispose().catch((error) => options.onError?.(error));
    throw error;
  }
  removeDisconnect = bus.onDisconnect(() => {
    void dispose().catch((error) => options.onError?.(error));
  });
  return { snapshot, refresh, dispose };
}
