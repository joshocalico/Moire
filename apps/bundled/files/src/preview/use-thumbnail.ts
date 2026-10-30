/**
 * An item's picture fitted to a box, from the thumbnail workers. Null until it is ready, or when
 * the item has none; the caller draws the kind icon meanwhile.
 */
import { useEffect, useState } from "react";
import {
  cachedThumbnail,
  requestThumbnail,
  type ImageData,
  type ThumbnailRequest,
} from "@moire/ui";
import { hasPicture, type PreviewSubject } from "./model";

export type ThumbnailBox = {
  width: number;
  height: number;
  fit: "contain" | "cover";
  /** A PDF's page, from 1; the first page otherwise. */
  page?: number;
};

export function useThumbnail(subject: PreviewSubject | null, box: ThumbnailBox): ImageData | null {
  const request: ThumbnailRequest | null =
    subject && hasPicture(subject) && box.width > 0 && box.height > 0
      ? {
          file: subject.path,
          mtimeMs: subject.modified,
          size: subject.size,
          width: Math.round(box.width),
          height: Math.round(box.height),
          fit: box.fit,
          ...(box.page && box.page > 1 ? { page: box.page } : {}),
        }
      : null;
  const key = request
    ? `${request.file}\n${request.mtimeMs}\n${request.size}\n${request.width}x${request.height}\n${request.fit}\n${request.page ?? 1}`
    : null;
  const ready = (value: ReturnType<typeof cachedThumbnail>) =>
    value?.kind === "image" ? value.image : null;
  const [state, setState] = useState<{ key: string | null; image: ImageData | null }>(() => ({
    key,
    image: request ? ready(cachedThumbnail(request)) : null,
  }));
  useEffect(() => {
    if (!request || !key) return;
    const hit = cachedThumbnail(request);
    if (hit) {
      setState({ key, image: ready(hit) });
      return;
    }
    const controller = new AbortController();
    void requestThumbnail(request, controller.signal).then(
      (result) => !controller.signal.aborted && setState({ key, image: ready(result) }),
      () => {
        // Cancelled: scrolled away or replaced.
      },
    );
    return () => controller.abort();
    // The request is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key === key) return state.image;
  return request ? ready(cachedThumbnail(request)) : null;
}
