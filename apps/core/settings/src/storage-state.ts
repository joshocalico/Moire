/** Drives from the storage service, and how full Home is. */
import os from "node:os";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@moire/app-tools";
import type {
  StorageAction,
  StorageClient,
  StorageClientState,
  StorageVolume,
} from "@moire/system-management/storage-status";
import { readDiskSpace, type DiskSpace } from "./system-info";

/** Re-read free space this often while Settings is open. */
const SPACE_POLL_MS = 30_000;

export function useStorage(storage: StorageClient | null, home: string = os.homedir()) {
  const [state, setState] = useState<StorageClientState | null>(storage?.state ?? null);
  const [space, setSpace] = useState<DiskSpace | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => (storage ? storage.subscribe(setState) : undefined), [storage]);
  useEffect(() => {
    const read = () =>
      void readDiskSpace(home).then((next) => {
        if (mounted.current) setSpace(next);
      });
    read();
    const timer = setInterval(read, SPACE_POLL_MS);
    return () => clearInterval(timer);
  }, [home]);
  const ready = state?.kind === "ready" ? state : null;
  const volumes: readonly StorageVolume[] =
    ready?.snapshot.status.kind === "ready" ? ready.snapshot.status.volumes : [];
  return {
    state,
    volumes,
    space,
    interactive:
      ready?.snapshot.status.kind === "ready" && ready.snapshot.status.policy === "interactive",
    pending: ready?.snapshot.operation.kind === "pending" ? ready.snapshot.operation : null,
    /** Mount, unmount or eject; a failure comes back as a message. */
    async act(action: StorageAction, volume: StorageVolume): Promise<string | null> {
      if (!storage || !ready) return "The drive service isn't running";
      try {
        await storage[action]({
          owner: ready.owner,
          id: volume.id,
          revision: ready.snapshot.revision,
        });
        return null;
      } catch (error) {
        return `Couldn't ${action} ${volume.label || "the drive"}: ${errorText(error)}`;
      }
    },
  };
}

export type Storage = ReturnType<typeof useStorage>;
