/** Free and total space of the volume holding a folder, for Home's and a drive's title. */
import fs from "node:fs/promises";
import { useEffect, useState } from "react";

export type VolumeSpace = { free: number; total: number };

export function useVolumeSpace(directory: string, enabled: boolean, revision: number) {
  const [space, setSpace] = useState<VolumeSpace | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fs.statfs(directory).then(
      (volume) =>
        alive &&
        setSpace({ free: volume.bavail * volume.bsize, total: volume.blocks * volume.bsize }),
      // An unknown capacity just leaves the bar out.
      () => alive && setSpace(null),
    );
    return () => {
      alive = false;
    };
  }, [directory, enabled, revision]);
  return enabled ? space : null;
}
