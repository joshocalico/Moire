export type BackdropMotion =
  | { kind: "static" }
  | {
      kind: "ambient";
      active: boolean;
      /** A consumer must establish hardware rendering; EGL availability alone is insufficient. */
      rendering: "hardware-retained" | "software" | "unknown";
    };

export function resolveBackdropMotion(
  motion: BackdropMotion | undefined,
  reducedMotion = false,
): boolean {
  return (
    motion?.kind === "ambient" &&
    motion.active &&
    motion.rendering === "hardware-retained" &&
    !reducedMotion
  );
}

/** Normalized artwork maintains the quiet region at every aspect ratio, without resize allocations. */
export function backdropPlacement(
  width: number,
  height: number,
  motionStyle: "ambient" | "wave" = "ambient",
): {
  x: number;
  y: number;
  width: number;
  height: number;
  driftX: number;
  driftY: number;
} {
  width = Math.max(0, width);
  height = Math.max(0, height);
  const driftX =
    motionStyle === "wave" ? Math.min(42, width * 0.035) : Math.min(12, width * 0.0075);
  const driftY =
    motionStyle === "wave" ? Math.min(26, height * 0.035) : Math.min(8, height * 0.0075);
  return {
    x: -driftX - 1,
    y: -driftY - 1,
    width: width + 2 * (driftX + 1),
    height: height + 2 * (driftY + 1),
    driftX,
    driftY,
  };
}
