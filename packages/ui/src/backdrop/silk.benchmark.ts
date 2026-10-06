/** Run separately from application startup; no framebuffer or native graphics access. */
import { createHash } from "node:crypto";
import { createSilkBackdrop, type SilkVariant } from "./silk";

for (const variant of ["fold-e", "greeter"] satisfies SilkVariant[]) {
  for (const resolution of ["standard", "high"] satisfies Array<"standard" | "high">) {
    const started = performance.now();
    const source = createSilkBackdrop({ variant, resolution });
    const generationMs = performance.now() - started;
    let paintedPixels = 0;
    for (let offset = 3; offset < source.image.rgba.length; offset += 4) {
      if (source.image.rgba[offset]! > 0) paintedPixels++;
    }
    console.log(
      JSON.stringify({
        variant,
        resolution,
        generationMs,
        width: source.image.width,
        height: source.image.height,
        ...source.metrics,
        geometryPoints: source.metrics.filaments + source.metrics.segments,
        temporaryMaskBytes:
          variant === "greeter" ? source.image.width * Float32Array.BYTES_PER_ELEMENT : 0,
        paintedPixels,
        sha256: createHash("sha256").update(source.image.rgba).digest("hex"),
      }),
    );
  }
}
