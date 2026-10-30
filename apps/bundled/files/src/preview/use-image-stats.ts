/** A picture's luminance histogram and dominant colours, from the thumbnail workers. */
import { useEffect, useState } from "react";
import { cachedImageStats, requestImageStats, type ImageStats } from "@moire/ui";
import type { PreviewSubject } from "./model";

export function useImageStats(subject: PreviewSubject | null): ImageStats | null {
  const request = subject
    ? { file: subject.path, mtimeMs: subject.modified, size: subject.size }
    : null;
  const key = request ? `${request.file}\n${request.mtimeMs}\n${request.size}` : null;
  const [state, setState] = useState<{ key: string | null; stats: ImageStats | null }>(() => ({
    key,
    stats: request ? cachedImageStats(request) : null,
  }));
  useEffect(() => {
    if (!request || !key) return;
    const hit = cachedImageStats(request);
    if (hit) {
      setState({ key, stats: hit });
      return;
    }
    const controller = new AbortController();
    void requestImageStats(request, controller.signal).then(
      (stats) => !controller.signal.aborted && setState({ key, stats }),
      () => {
        // Cancelled: another item took its place.
      },
    );
    return () => controller.abort();
    // The request is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key === key) return state.stats;
  return request ? cachedImageStats(request) : null;
}
