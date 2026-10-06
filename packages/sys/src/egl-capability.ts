import type { EglCompositionScene, EglOutputInfo } from "./egl-output";

/** Execution of the initialized context, separate from EGL availability and transport. */
export type EglExecution = "software" | "virtual" | "unknown";

/**
 * Negative classifications are useful even when positive device/context binding is
 * unavailable. There is deliberately no hardware rule: GBM, ANGLE, vendor names
 * and a working context do not establish physical execution. A virtual renderer
 * is a transport/backend classification, not a claim that the host GPU is idle.
 * Future hardware admission needs the actual EGL context/display bound to a
 * reviewed native device, plus accepted retained output and measured transfers;
 * no environment override or vendor substring is an admission path.
 */
export function classifyEglExecution(info: EglOutputInfo): EglExecution {
  const renderer = info.glRenderer.toLowerCase();
  if (/llvmpipe|softpipe|swrast|software rasterizer|swiftshader/.test(renderer)) return "software";
  if (/virgl|virtio|svga3d|virtualbox/.test(renderer)) return "virtual";
  return "unknown";
}

/**
 * The implemented scene pass clears then uses premultiplied source-over. An
 * opaque clear remains opaque under those draws. The toolkit's one-pixel solid
 * full-viewport background is an equivalent certificate, from actual draw data.
 * No GPU pixels are read and no caller-provided opacity promise is accepted.
 */
export function hasOpaqueEglScene(scene: EglCompositionScene): boolean {
  if (
    !Number.isSafeInteger(scene.width) ||
    !Number.isSafeInteger(scene.height) ||
    scene.width <= 0 ||
    scene.height <= 0 ||
    scene.layers.length > 4096
  )
    return false;
  if (
    scene.layers.some(
      (layer) =>
        ![
          layer.destination.x,
          layer.destination.y,
          layer.destination.width,
          layer.destination.height,
        ].every(Number.isFinite) ||
        (layer.clip !== undefined &&
          ![layer.clip.x, layer.clip.y, layer.clip.width, layer.clip.height].every(
            Number.isFinite,
          )) ||
        !Number.isFinite(layer.opacity ?? 1) ||
        (layer.opacity ?? 1) < 0 ||
        (layer.opacity ?? 1) > 1 ||
        layer.colorMatrix !== undefined ||
        layer.backdropBlur !== undefined,
    )
  )
    return false;
  if (scene.clearColor >>> 24 === 255) return true;
  return scene.layers.some((layer) => {
    const d = layer.destination;
    const clip = layer.clip;
    return (
      layer.pixels instanceof Uint8Array &&
      layer.sourceWidth === 1 &&
      layer.sourceHeight === 1 &&
      layer.sourceStride === 4 &&
      layer.pixels.byteLength >= 4 &&
      layer.pixels[3] === 255 &&
      (layer.opacity ?? 1) === 1 &&
      !layer.transform &&
      !layer.surfaceGeometry &&
      !layer.contentShape &&
      !layer.sourceRect &&
      !layer.dropShadow &&
      (!layer.cornerRadius ||
        (Array.isArray(layer.cornerRadius) && layer.cornerRadius.every((r) => r === 0))) &&
      d.x <= 0 &&
      d.y <= 0 &&
      d.x + d.width >= scene.width &&
      d.y + d.height >= scene.height &&
      (!clip ||
        (clip.x <= 0 &&
          clip.y <= 0 &&
          clip.x + clip.width >= scene.width &&
          clip.y + clip.height >= scene.height))
    );
  });
}
