/**
 * ImageWidget — renders a bitmap image via react-host's "image" primitive.
 * Async loads PNGs from disk; uses getCachedImage for synchronous paint.
 * Pass src for file path or bitmap for a pre-loaded RGBA buffer.
 */
import { createElement, useEffect, useRef, type ReactNode } from "react";
import { Image } from "@moire/react-host";
import { loadImage, getCachedImage, type ImageData } from "../image/load.js";

export type ImageFit = "fill" | "contain" | "cover";

export type ImageWidgetProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Path to a PNG file (loaded async; shows blank until cached). */
  src?: string;
  /** Pre-loaded RGBA bitmap (bypasses async loading). */
  bitmap?: ImageData;
  fit?: ImageFit;
  opacity?: number;
};

export function ImageWidget(props: ImageWidgetProps): ReactNode {
  const forceRef = useRef<(() => void) | null>(null);

  // Kick off async load if src is set and not yet cached
  useEffect(() => {
    if (!props.src) return;
    if (getCachedImage(props.src)) return;
    let alive = true;
    loadImage(props.src).then(() => {
      if (alive) forceRef.current?.();
    }).catch(() => {});
    return () => {
      alive = false;
    };
  }, [props.src]);

  const img: ImageData | null =
    props.bitmap ?? (props.src ? getCachedImage(props.src) : null);

  if (!img) {
    // Not yet loaded — render nothing (transparent slot)
    return createElement("group" as unknown as string, {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    });
  }

  return createElement(Image, {
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: props.width,
    height: props.height,
    imagePixels: img.rgba,
    imageWidth: img.width,
    imageHeight: img.height,
    opacity: props.opacity ?? 1,
  });
}
