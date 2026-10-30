/** The preview of one item, loaded off the render path and replaced when the item changes. */
import { useEffect, useState } from "react";
import { cachedPreview, previewKey, requestPreview } from "./cache";
import type { Preview, PreviewSubject } from "./model";

/** Null while loading; folders report their size as it is counted. */
export function usePreview(subject: PreviewSubject | null, refresh = 0): Preview | null {
  const key = subject ? previewKey(subject) : null;
  const [state, setState] = useState<{ key: string | null; preview: Preview | null }>(() => ({
    key,
    preview: subject ? cachedPreview(subject) : null,
  }));
  useEffect(() => {
    if (!subject || !key) return;
    const controller = new AbortController();
    const show = (preview: Preview) => !controller.signal.aborted && setState({ key, preview });
    const hit = cachedPreview(subject);
    if (hit) show(hit);
    else
      void requestPreview(subject, controller.signal, show).then(show, () => {
        // Aborted: a newer item took its place.
      });
    return () => controller.abort();
    // The subject is identified by its key; a new object for the same version is the same item.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  return state.key === key ? state.preview : subject ? cachedPreview(subject) : null;
}
