/** A soft dusk wallpaper for previews, so glass surfaces read as they would on a desktop. */
import React, { type ReactNode } from "react";
import { Image, Rect } from "@moire/react-host";
import { themePalette } from "@moire/theme";

function wallpaper(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      const glow = Math.exp(-((u - 0.68) ** 2 * 6 + (v - 0.42) ** 2 * 9));
      const o = (y * width + x) * 4;
      pixels[o] = Math.round(22 + 70 * glow + 18 * v); // R
      pixels[o + 1] = Math.round(20 + 38 * glow + 8 * u); // G
      pixels[o + 2] = Math.round(38 + 96 * glow + 30 * (1 - v)); // B
      pixels[o + 3] = 255;
    }
  return pixels;
}

const wallpapers = new Map<string, Uint8Array>();
let flat = false;
/** Baselines use a flat ground: smaller files, and the same surfaces under test. */
export function setFlatGround(value: boolean): void {
  flat = value;
}

export function Wallpaper(props: { width: number; height: number }): ReactNode {
  if (flat) return <Rect width={props.width} height={props.height} fill={themePalette().bg} />;
  const key = `${props.width}x${props.height}`;
  if (!wallpapers.has(key)) wallpapers.set(key, wallpaper(props.width, props.height));
  return (
    <Image
      width={props.width}
      height={props.height}
      imagePixels={wallpapers.get(key)!}
      imageWidth={props.width}
      imageHeight={props.height}
    />
  );
}
