export type OutputGeometry = {
  id: string;
  width: number;
  height: number;
  x: number;
  y: number;
};

export function horizontalLayout<T extends Omit<OutputGeometry, "x" | "y">>(
  outputs: readonly T[],
): Array<T & Pick<OutputGeometry, "x" | "y">> {
  let x = 0;
  return outputs.map((output) => {
    const placed = { ...output, x, y: 0 };
    x += output.width;
    return placed;
  });
}

export function desktopBounds(
  outputs: readonly OutputGeometry[],
): { width: number; height: number } {
  if (outputs.length === 0) return { width: 1, height: 1 };
  return {
    width: Math.max(1, ...outputs.map((output) => output.x + output.width)),
    height: Math.max(1, ...outputs.map((output) => output.y + output.height)),
  };
}

export function outputContainingPoint<T extends OutputGeometry>(
  outputs: readonly T[],
  x: number,
  y: number,
): T | null {
  return (
    outputs.find(
      (output) =>
        x >= output.x &&
        y >= output.y &&
        x < output.x + output.width &&
        y < output.y + output.height,
    ) ?? null
  );
}

export function outputsIntersectingRect<T extends OutputGeometry>(
  outputs: readonly T[],
  rect: { x: number; y: number; width: number; height: number },
): T[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  return outputs.filter(
    (output) =>
      rect.x < output.x + output.width &&
      rect.x + rect.width > output.x &&
      rect.y < output.y + output.height &&
      rect.y + rect.height > output.y,
  );
}

export function replacementOwner<T>(
  outputs: readonly T[],
  removedIndex: number,
): T | null {
  for (let index = 0; index < outputs.length; index++) {
    if (index !== removedIndex) return outputs[index]!;
  }
  return null;
}

export function outputMembershipDelta<T>(
  current: ReadonlySet<T>,
  desiredValues: Iterable<T>,
): { entered: T[]; left: T[]; next: Set<T> } {
  const next = new Set(desiredValues);
  return {
    entered: [...next].filter((value) => !current.has(value)),
    left: [...current].filter((value) => !next.has(value)),
    next,
  };
}

/**
 * Crop one output rectangle from the shared logical XRGB8888 scene. Target
 * pitch may contain padding, as real dumb buffers commonly do.
 */
export function copySceneToOutput(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  output: OutputGeometry,
  target: Uint8Array,
  targetPitch: number,
): void {
  const rowBytes = output.width * 4;
  if (
    output.x < 0 ||
    output.y < 0 ||
    output.x + output.width > sourceWidth ||
    output.y + output.height > sourceHeight
  ) {
    throw new RangeError(`Output ${output.id} lies outside the logical scene`);
  }
  if (targetPitch < rowBytes || target.length < targetPitch * output.height) {
    throw new RangeError(`Target for ${output.id} is smaller than its geometry`);
  }
  for (let row = 0; row < output.height; row++) {
    const sourceStart = ((output.y + row) * sourceWidth + output.x) * 4;
    const targetStart = row * targetPitch;
    target.set(
      source.subarray(sourceStart, sourceStart + rowBytes),
      targetStart,
    );
  }
}
