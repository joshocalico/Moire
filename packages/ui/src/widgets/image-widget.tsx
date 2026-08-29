/**
 * Renderer-neutral bitmap widget with asynchronous PNG loading and themed
 * placeholder/error states.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Image, Rect } from "@moire/react-host";
import { getCachedImage, loadImage, type ImageData } from "#ui/image/load";
import { resolveStatefulStyle, useWidgetTheme, type WidgetState } from "#ui/widget-theme";

export type ImageFit = "fill" | "contain" | "cover";

export type ImageWidgetProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Path to a PNG file. The widget repaints when the asynchronous load ends. */
  src?: string;
  /** Pre-loaded RGBA bitmap. Takes precedence over src. */
  bitmap?: ImageData;
  fit?: ImageFit;
  /** Overrides the recipe's image opacity. */
  opacity?: number;
  /** Paint the themed frame behind unloaded and contained images. */
  placeholder?: boolean;
  onLoad?: (image: ImageData) => void;
  onError?: (error: unknown) => void;
};

type LoadStatus = "idle" | "loading" | "ready" | "error";

function fittedImageRect(
  fit: ImageFit,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (fit === "fill" || width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width, height };
  }

  const scale =
    fit === "contain"
      ? Math.min(width / imageWidth, height / imageHeight)
      : Math.max(width / imageWidth, height / imageHeight);
  const fittedWidth = Math.max(1, Math.round(imageWidth * scale));
  const fittedHeight = Math.max(1, Math.round(imageHeight * scale));
  return {
    x: Math.round((width - fittedWidth) / 2),
    y: Math.round((height - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}

export function ImageWidget(props: ImageWidgetProps): ReactNode {
  const theme = useWidgetTheme();
  const [request, setRequest] = useState<{
    src?: string;
    status: LoadStatus;
  }>({ status: "idle" });
  const onLoadRef = useRef(props.onLoad);
  const onErrorRef = useRef(props.onError);
  onLoadRef.current = props.onLoad;
  onErrorRef.current = props.onError;

  const cached = props.src ? getCachedImage(props.src) : null;
  const image = props.bitmap ?? cached;

  useEffect(() => {
    if (props.bitmap || !props.src) return;
    const src = props.src;
    const cacheHit = getCachedImage(src);
    if (cacheHit) {
      setRequest({ src, status: "ready" });
      onLoadRef.current?.(cacheHit);
      return;
    }
    let alive = true;
    setRequest({ src, status: "loading" });
    void loadImage(src).then(
      (loaded) => {
        if (!alive) return;
        setRequest({ src, status: "ready" });
        onLoadRef.current?.(loaded);
      },
      (error: unknown) => {
        if (!alive) return;
        setRequest({ src, status: "error" });
        onErrorRef.current?.(error);
      },
    );
    return () => {
      alive = false;
    };
  }, [props.bitmap, props.src]);

  const status: LoadStatus = image
    ? "ready"
    : request.src === props.src
      ? request.status
      : props.src
        ? "loading"
        : "idle";
  const placeholderState: WidgetState =
    status === "error" ? "invalid" : status === "loading" ? "loading" : "rest";
  const placeholderStyle = resolveStatefulStyle(
    theme.recipes.imageWidget.placeholder,
    placeholderState,
  );
  const width = Math.max(0, props.width);
  const height = Math.max(0, props.height);
  const fit = props.fit ?? "fill";
  const fitted = image ? fittedImageRect(fit, width, height, image.width, image.height) : null;

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height} clip={fit === "cover"}>
      {props.placeholder !== false ? (
        <Rect width={width} height={height} {...placeholderStyle} />
      ) : null}
      {image && fitted ? (
        <Image
          x={fitted.x}
          y={fitted.y}
          width={fitted.width}
          height={fitted.height}
          imagePixels={image.rgba}
          imageWidth={image.width}
          imageHeight={image.height}
          opacity={props.opacity ?? theme.recipes.imageWidget.image.opacity}
        />
      ) : null}
    </Group>
  );
}
