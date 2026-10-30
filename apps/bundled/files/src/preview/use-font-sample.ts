/** Sample lines drawn in a font file by the thumbnail workers, in the theme's text colour. */
import { useEffect, useState } from "react";
import { requestFontSample, type FontSampleLine, type ImageData } from "@moire/ui";

export function useFontSample(
  file: string | null,
  lines: readonly FontSampleLine[],
  ink: number,
  width: number,
): ImageData | null {
  const key =
    file && width > 0
      ? [file, ink, Math.round(width), ...lines.map((line) => `${line.size}:${line.text}`)].join(
          "\n",
        )
      : null;
  const [state, setState] = useState<{ key: string | null; image: ImageData | null }>({
    key: null,
    image: null,
  });
  useEffect(() => {
    if (!file || !key) return;
    const controller = new AbortController();
    void requestFontSample(file, lines, ink, width, controller.signal).then(
      (result) =>
        !controller.signal.aborted &&
        setState({ key, image: result.kind === "image" ? result.image : null }),
      () => {
        // Cancelled: another item is previewed.
      },
    );
    return () => controller.abort();
    // The sample is identified by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.image : null;
}
