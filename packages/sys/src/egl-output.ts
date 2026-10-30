/**
 * Surfaceless EGL/GLES output scaler.
 *
 * This is intentionally independent from KMS presentation: it uploads one
 * logical BGRA/XRGB scene, crops/scales it for each output on the GPU, and
 * reads the result into the caller's proven scanout buffer, or paints into a
 * renderer-owned pair of GBM scanout targets for direct presentation.
 */
import koffi from "koffi";
import { bindNativeFunction } from "./ffi";
import { classifyEglExecution, hasOpaqueEglScene, type EglExecution } from "./egl-capability";
import { closeFd } from "./libc";
import { assertLinux } from "./platform";
import { canRetireKmsFramebuffer, isKmsFramebufferWritable } from "./kms";
import { createGles3, type Gles3 } from "./gles3";

const EGL_PLATFORM_GBM_KHR = 0x31d7;
const EGL_OPENGL_ES_API = 0x30a0;
const EGL_RENDERABLE_TYPE = 0x3040;
const EGL_OPENGL_ES2_BIT = 0x0004;
const EGL_OPENGL_ES3_BIT = 0x0040;
const EGL_RED_SIZE = 0x3024;
const EGL_GREEN_SIZE = 0x3023;
const EGL_BLUE_SIZE = 0x3022;
const EGL_ALPHA_SIZE = 0x3021;
const EGL_CONTEXT_CLIENT_VERSION = 0x3098;
const EGL_NONE = 0x3038;
const EGL_VENDOR = 0x3053;
const EGL_VERSION = 0x3054;
const EGL_EXTENSIONS = 0x3055;
const EGL_WIDTH = 0x3057;
const EGL_HEIGHT = 0x3056;
const EGL_LINUX_DMA_BUF_EXT = 0x3270;
const EGL_LINUX_DRM_FOURCC_EXT = 0x3271;
const EGL_DMA_BUF_PLANE0_FD_EXT = 0x3272;
const EGL_DMA_BUF_PLANE0_OFFSET_EXT = 0x3273;
const EGL_DMA_BUF_PLANE0_PITCH_EXT = 0x3274;
const EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT = 0x3443;
const EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT = 0x3444;
const GL_FRAMEBUFFER_BINDING = 0x8ca6;
const GL_CURRENT_PROGRAM = 0x8b8d;
const GL_VIEWPORT = 0x0ba2;
const GL_ACTIVE_TEXTURE = 0x84e0;
const GL_TEXTURE_BINDING_2D = 0x8069;
const GL_SCISSOR_BOX = 0x0c10;

const GL_VERTEX_SHADER = 0x8b31;
const GL_FRAGMENT_SHADER = 0x8b30;
const GL_COMPILE_STATUS = 0x8b81;
const GL_LINK_STATUS = 0x8b82;
const GL_TEXTURE_2D = 0x0de1;
const GL_TEXTURE0 = 0x84c0;
const GL_RGBA = 0x1908;
const GL_UNSIGNED_BYTE = 0x1401;
const GL_FLOAT = 0x1406;
const GL_TRIANGLE_STRIP = 0x0005;
const GL_TEXTURE_MIN_FILTER = 0x2801;
const GL_TEXTURE_MAG_FILTER = 0x2800;
const GL_TEXTURE_WRAP_S = 0x2802;
const GL_TEXTURE_WRAP_T = 0x2803;
const GL_LINEAR = 0x2601;
const GL_NEAREST = 0x2600;
const GL_CLAMP_TO_EDGE = 0x812f;
const GL_COLOR_ATTACHMENT0 = 0x8ce0;
const GL_FRAMEBUFFER = 0x8d40;
const GL_FRAMEBUFFER_COMPLETE = 0x8cd5;
const GL_COLOR_BUFFER_BIT = 0x00004000;
const GL_UNPACK_ALIGNMENT = 0x0cf5;
const GL_PACK_ALIGNMENT = 0x0d05;
const GL_BLEND = 0x0be2;
const GL_SCISSOR_TEST = 0x0c11;
const GL_ONE = 1;
const GL_ONE_MINUS_SRC_ALPHA = 0x0303;

const FULL_QUAD_POSITIONS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const UNIT_QUAD_TEX_COORDS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const DRM_FORMAT_XRGB8888 = 0x34325258;
const DRM_FORMAT_ARGB8888 = 0x34325241;
const GBM_BO_USE_SCANOUT = 1 << 0;
const GBM_BO_USE_RENDERING = 1 << 2;
const GBM_BO_USE_LINEAR = 1 << 4;

type NativeFunction = (...args: unknown[]) => unknown;

function loadFirst(names: readonly string[]): ReturnType<typeof koffi.load> {
  for (const name of names) {
    try {
      return koffi.load(name);
    } catch {
      // try the next soname
    }
  }
  throw new Error(`Unable to load ${names.join(" or ")}`);
}

function pointerAddress(value: unknown): bigint {
  if (value == null) return 0n;
  try {
    return BigInt(koffi.address(value));
  } catch {
    return 0n;
  }
}

function nativeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return String(koffi.decode(value, "char *") ?? "");
  } catch {
    return "";
  }
}

function uintOut(call: (out: unknown) => void): number {
  // Match GLES' exact GLuint pointee type; Koffi intentionally rejects an
  // otherwise ABI-equivalent uint32_t allocation for `unsigned int *`.
  const out = koffi.alloc("unsigned int", 1);
  try {
    call(out);
    return koffi.decode(out, "unsigned int") as number;
  } finally {
    koffi.free(out);
  }
}

/** The EGL context current on this (single JS) thread, shared by every scaler. */
let currentEglContext: unknown = null;

// koffi type names are process-global: declare the extension prototypes once, so several
// scalers (a compositor and its in-process greeter client) can coexist.
let imageProtos: {
  create: ReturnType<typeof koffi.proto>;
  destroy: ReturnType<typeof koffi.proto>;
  imageTargetTexture: ReturnType<typeof koffi.proto>;
} | null = null;
function eglImageProtos() {
  return (imageProtos ??= {
    create: koffi.proto(
      "void *MoireEglCreateImage(void *display, void *context, unsigned int target, void *buffer, const int *attributes)",
    ),
    destroy: koffi.proto("unsigned int MoireEglDestroyImage(void *display, void *image)"),
    imageTargetTexture: koffi.proto(
      "void MoireGlEglImageTargetTexture(unsigned int target, void *image)",
    ),
  });
}

export type EglTransferCounter = { count: number; bytes: number };
export type EglTransferOperation =
  | "textureUpload"
  | "gpuReadback"
  | "dmabufImport"
  | "gpuCopy"
  | "cpuCopy";
export type EglOutputOptions = {
  measureTransfers?: boolean;
  /**
   * Request a GLES 3 context so GPU scene producers can render into the composition (see
   * `producerGl`). Falls back to GLES 2 when the driver offers no ES3 config.
   */
  gles3?: boolean;
};

/** Scaler-owned render target a producer draws into; composes as an `EglResidentImage` layer. */
export type EglProducerTarget = {
  image: EglResidentImage;
  framebuffer: number;
};

export type EglOutputInfo = {
  eglVendor: string;
  eglVersion: string;
  eglExtensions: string;
  glVendor: string;
  glRenderer: string;
  glVersion: string;
};

export type EglScaleOutput = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  targetPitch: number;
  target: Uint8Array;
  /**
   * Red, green and blue multipliers applied as the output is drawn (night light). Omitted for
   * captures, so screenshots keep the composed colours.
   */
  colorScale?: OutputColorScale;
};

/** Per-channel multipliers (0–1) for an output's final pass. */
export type OutputColorScale = readonly [red: number, green: number, blue: number];

export type EglDirectOutput = Omit<EglScaleOutput, "targetPitch" | "target">;

/** The final pass's colour matrix for a scale; null when it changes nothing. */
export function outputColorMatrix(scale: OutputColorScale | undefined): number[] | null {
  if (!scale || scale.every((channel) => channel === 1)) return null;
  const [red, green, blue] = scale.map((channel) => Math.min(1, Math.max(0, channel)));
  // Rows map straight-alpha RGBA; the fifth column is the offset.
  return [red!, 0, 0, 0, 0, 0, green!, 0, 0, 0, 0, 0, blue!, 0, 0, 0, 0, 0, 1, 0];
}

export type EglDirectPresent = {
  framebufferId: number;
  stride: number;
  width: number;
  height: number;
};

/** A renderer-owned dma-buf suitable for a Wayland wl_buffer. */
export type EglDamageRect = { x: number; y: number; width: number; height: number };

export type EglClientPresent = {
  /** Stable for the lifetime of the underlying GBM BO. */
  id: string;
  fd: number;
  width: number;
  height: number;
  stride: number;
  format: number;
  modifier: bigint;
  /** Buffer-space damage produced while composing this target. */
  damage: readonly EglDamageRect[];
};

export type EglDmabufSnapshotInput = {
  width: number;
  height: number;
  format: number;
  plane: { fd: number; offset: number; stride: number; modifier: bigint };
};

/** Immutable GPU snapshot independent of its producer's buffer and fd lifetime. */
export class EglResidentImage {
  private destroyed = false;
  constructor(
    readonly owner: object,
    readonly width: number,
    readonly height: number,
    private readonly read: () => Uint8Array,
    private readonly release: () => void,
  ) {}
  get isDestroyed(): boolean {
    return this.destroyed;
  }
  /** Tight BGRA, allocated/read only when diagnostic or CPU fallback requests it. */
  readbackPixels(): Uint8Array {
    if (this.destroyed) throw new Error("EGL resident image is destroyed");
    return this.read();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.release();
  }
}

type ResidentResource = { texture: number; framebuffer: number };
type SnapshotProgram = {
  program: number;
  position: number;
  texCoord: number;
  sampler: number;
  opaque: number;
};

export type EglCompositionLayer = {
  id: string;
  pixels: Uint8Array | EglResidentImage;
  sourceWidth: number;
  sourceHeight: number;
  sourceStride: number;
  revision?: number;
  sourceRect?: { x: number; y: number; width: number; height: number };
  /** Source-space damage supplied by the producer of this layer. */
  damage?: readonly EglDamageRect[];
  destination: { x: number; y: number; width: number; height: number };
  /** Axis-aligned scene-space clip inherited from retained layout groups. */
  clip?: { x: number; y: number; width: number; height: number };
  opacity?: number;
  /** Column-major 4×4 transform around the optional local-space origin. */
  transform?: readonly number[];
  transformOrigin?: readonly [number, number, number?];
  sampling?: "nearest" | "linear";
  surfaceGeometry?: { x: number; y: number; width: number; height: number };
  /** Actual frame, independent of the buffer's CSD shadow padding. */
  contentShape?: {
    bounds: { x: number; y: number; width: number; height: number };
    radii: readonly [number, number, number, number];
    outside: "discard" | "translucent-shadow";
  };
  cornerRadius?: number | readonly [number, number, number, number];
  dropShadow?: {
    offsetX: number;
    offsetY: number;
    blurRadius: number;
    spread?: number;
    color: number;
  };
  backdropBlur?: {
    radius: number;
    saturation?: number;
    tint?: number;
  };
  /** Row-major 4×5 matrix over unpremultiplied semantic RGBA. */
  colorMatrix?: readonly number[];
};

export type EglCompositionScene = {
  width: number;
  height: number;
  clearColor: number;
  layers: readonly EglCompositionLayer[];
  /** Producer-computed precise scene-space damage. */
  damage?: readonly EglDamageRect[];
};

type CachedTexture = {
  texture: number;
  width: number;
  height: number;
  revision: number | undefined;
  pixels: Uint8Array;
  sampling: "nearest" | "linear";
  lastSeenFrame: number;
};

type CachedLayerGeometry = {
  signature: string;
  sceneWidth: number;
  sceneHeight: number;
  positions: Float32Array;
  texCoords: Float32Array;
  shadowPositions: Float32Array;
  lastSeenFrame: number;
};

type BackdropCache = {
  texture: number;
  width: number;
  height: number;
  dependencyKey: string;
  lastSeenFrame: number;
};

type DamageRect = { x: number; y: number; width: number; height: number };

type LayerSnapshot = {
  pixels: Uint8Array | EglResidentImage;
  revision: number | undefined;
  signature: string;
  bounds: DamageRect;
};

function rectUnion(a: DamageRect | null, b: DamageRect): DamageRect {
  if (!a) return { ...b };
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function rectsIntersect(a: DamageRect, b: DamageRect): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function clampRect(rect: DamageRect, width: number, height: number): DamageRect {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function layerBounds(
  layer: EglCompositionLayer,
  sceneWidth: number,
  sceneHeight: number,
): DamageRect {
  if (layer.transform) return { x: 0, y: 0, width: sceneWidth, height: sceneHeight };
  let bounds: DamageRect = { ...layer.destination };
  const shadow = layer.dropShadow;
  if (shadow) {
    const padding = Math.max(1, shadow.blurRadius + Math.max(0, shadow.spread ?? 0));
    bounds = rectUnion(bounds, {
      x: layer.destination.x + shadow.offsetX - padding,
      y: layer.destination.y + shadow.offsetY - padding,
      width: layer.destination.width + padding * 2,
      height: layer.destination.height + padding * 2,
    });
  }
  if (layer.clip) {
    const left = Math.max(bounds.x, layer.clip.x);
    const top = Math.max(bounds.y, layer.clip.y);
    const right = Math.min(bounds.x + bounds.width, layer.clip.x + layer.clip.width);
    const bottom = Math.min(bounds.y + bounds.height, layer.clip.y + layer.clip.height);
    bounds = {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }
  return clampRect(bounds, sceneWidth, sceneHeight);
}

function layerSignature(layer: EglCompositionLayer): string {
  return JSON.stringify({
    sourceWidth: layer.sourceWidth,
    sourceHeight: layer.sourceHeight,
    sourceStride: layer.sourceStride,
    sourceRect: layer.sourceRect,
    destination: layer.destination,
    clip: layer.clip,
    opacity: layer.opacity,
    transform: layer.transform,
    transformOrigin: layer.transformOrigin,
    sampling: layer.sampling,
    surfaceGeometry: layer.surfaceGeometry,
    contentShape: layer.contentShape,
    cornerRadius: layer.cornerRadius,
    dropShadow: layer.dropShadow,
    backdropBlur: layer.backdropBlur,
    colorMatrix: layer.colorMatrix,
  });
}

function layerDamageBounds(
  layer: EglCompositionLayer,
  damage: EglDamageRect,
  sceneWidth: number,
  sceneHeight: number,
): DamageRect | null {
  if (layer.transform || layer.dropShadow || layer.backdropBlur || layer.colorMatrix) {
    return layerBounds(layer, sceneWidth, sceneHeight);
  }
  const source = layer.sourceRect ?? {
    x: 0,
    y: 0,
    width: layer.sourceWidth,
    height: layer.sourceHeight,
  };
  const left = Math.max(source.x, damage.x);
  const top = Math.max(source.y, damage.y);
  const right = Math.min(source.x + source.width, damage.x + damage.width);
  const bottom = Math.min(source.y + source.height, damage.y + damage.height);
  if (right <= left || bottom <= top || source.width <= 0 || source.height <= 0) {
    return null;
  }
  const mapped: DamageRect = {
    x: layer.destination.x + ((left - source.x) / source.width) * layer.destination.width,
    y: layer.destination.y + ((top - source.y) / source.height) * layer.destination.height,
    width: ((right - left) / source.width) * layer.destination.width,
    height: ((bottom - top) / source.height) * layer.destination.height,
  };
  if (layer.clip) {
    const clippedLeft = Math.max(mapped.x, layer.clip.x);
    const clippedTop = Math.max(mapped.y, layer.clip.y);
    const clippedRight = Math.min(mapped.x + mapped.width, layer.clip.x + layer.clip.width);
    const clippedBottom = Math.min(mapped.y + mapped.height, layer.clip.y + layer.clip.height);
    mapped.x = clippedLeft;
    mapped.y = clippedTop;
    mapped.width = Math.max(0, clippedRight - clippedLeft);
    mapped.height = Math.max(0, clippedBottom - clippedTop);
  }
  const clipped = clampRect(mapped, sceneWidth, sceneHeight);
  return clipped.width > 0 && clipped.height > 0 ? clipped : null;
}

type DirectOutputTarget = EglDirectPresent & {
  bo: unknown;
  image: unknown;
  texture: number;
  framebuffer: number;
};

type DirectOutputPool = {
  key: string;
  targets: readonly [DirectOutputTarget, DirectOutputTarget];
  nextIndex: number;
  lastRendered: DirectOutputTarget | null;
};

type ClientTarget = EglClientPresent & {
  bo: unknown;
  image: unknown;
  texture: number;
  framebuffer: number;
  busy: boolean;
};

type ClientTargetPool = {
  channel: string;
  key: string;
  retired: boolean;
  targets: ClientTarget[];
};

export class EglOutputScaler {
  readonly info: EglOutputInfo;
  /** GLES major version of the created context. */
  readonly clientVersion: 2 | 3;
  private producerBinding: Gles3 | null = null;

  get execution(): EglExecution {
    return classifyEglExecution(this.info);
  }

  private readonly gbm: ReturnType<typeof koffi.load>;
  private readonly drm: ReturnType<typeof koffi.load>;
  private readonly egl: ReturnType<typeof koffi.load>;
  private readonly gl: ReturnType<typeof koffi.load>;
  private readonly gbmDevice: unknown;
  private readonly display: unknown;
  private readonly context: unknown;
  private readonly gbmDestroyDevice: NativeFunction;
  private readonly eglDestroyContext: NativeFunction;
  private readonly eglTerminate: NativeFunction;
  private readonly eglMakeCurrent: NativeFunction;
  private readonly eglCreateImage: NativeFunction;
  private readonly eglDestroyImage: NativeFunction;
  private readonly glDeleteTextures: NativeFunction;
  private readonly glDeleteFramebuffers: NativeFunction;
  private readonly glDeleteProgram: NativeFunction;
  private readonly glUseProgram: NativeFunction;
  private readonly glActiveTexture: NativeFunction;
  private readonly glBindTexture: NativeFunction;
  private readonly glTexParameteri: NativeFunction;
  private readonly glTexImage2D: NativeFunction;
  private readonly glTexSubImage2D: NativeFunction;
  private readonly glCopyTexSubImage2D: NativeFunction;
  private readonly glPixelStorei: NativeFunction;
  private readonly glBindFramebuffer: NativeFunction;
  private readonly glFramebufferTexture2D: NativeFunction;
  private readonly glCheckFramebufferStatus: NativeFunction;
  private readonly glViewport: NativeFunction;
  private readonly glScissor: NativeFunction;
  private readonly glClearColor: NativeFunction;
  private readonly glClear: NativeFunction;
  private readonly glUniform1i: NativeFunction;
  private readonly glUniform1f: NativeFunction;
  private readonly glUniform4f: NativeFunction;
  private readonly glUniform2f: NativeFunction;
  private readonly glEnable: NativeFunction;
  private readonly glDisable: NativeFunction;
  private readonly glBlendFunc: NativeFunction;
  private readonly glEnableVertexAttribArray: NativeFunction;
  private readonly glVertexAttribPointer: NativeFunction;
  private readonly glDrawArrays: NativeFunction;
  private readonly glReadPixels: NativeFunction;
  private readonly glFinish: () => void;
  private readonly glGetIntegerv: NativeFunction;
  private readonly glIsEnabled: NativeFunction;
  private readonly glGetError: () => number;
  private readonly glEglImageTargetTexture: NativeFunction;
  private readonly gbmBoCreate: NativeFunction;
  private readonly gbmBoDestroy: NativeFunction;
  private readonly gbmBoGetFd: NativeFunction;
  private readonly gbmBoGetStride: NativeFunction;
  private readonly gbmBoGetFormat: NativeFunction;
  private readonly gbmBoGetModifier: NativeFunction;
  private readonly gbmBoGetPlaneCount: NativeFunction;
  private readonly drmPrimeFdToHandle: NativeFunction;
  private readonly drmModeAddFb2: NativeFunction;
  private readonly drmModeAddFb: NativeFunction;
  private readonly drmModeRmFb: NativeFunction;
  private readonly program: number;
  private readonly positionLocation: number;
  private readonly texCoordLocation: number;
  private readonly samplerLocation: number;
  private readonly opacityLocation: number;
  private readonly geometryLocation: number;
  private readonly hasGeometryLocation: number;
  private readonly uvRectLocation: number;
  private readonly layerSizeLocation: number;
  private readonly cornerRadiiLocation: number;
  private readonly contentShapeModeLocation: number;
  private readonly contentShapeBoundsLocation: number;
  private readonly contentShapeRadiiLocation: number;
  private readonly modeLocation: number;
  private readonly shadowRectLocation: number;
  private readonly shadowRadiusLocation: number;
  private readonly shadowSoftnessLocation: number;
  private readonly shadowColorLocation: number;
  private readonly blurDirectionLocation: number;
  private readonly saturationLocation: number;
  private readonly tintColorLocation: number;
  private readonly hasColorMatrixLocation: number;
  private readonly colorRow0Location: number;
  private readonly colorRow1Location: number;
  private readonly colorRow2Location: number;
  private readonly colorRow3Location: number;
  private readonly colorOffsetLocation: number;
  private readonly outputSwizzleLocation: number;
  private readonly sourceTexture: number;
  private readonly targetTexture: number;
  private readonly sceneTexture: number;
  private readonly backdropTexture: number;
  private readonly blurTextureA: number;
  private readonly blurTextureB: number;
  private readonly framebuffer: number;
  private readonly sceneFramebuffer: number;
  private readonly blurFramebufferA: number;
  private readonly blurFramebufferB: number;
  private outputSourceTexture = 0;
  private readonly layerTextures = new Map<string, CachedTexture>();
  private readonly layerGeometry = new Map<string, CachedLayerGeometry>();
  private readonly backdropCaches = new Map<string, BackdropCache>();
  private readonly pixelIds = new WeakMap<Uint8Array | EglResidentImage, number>();
  private nextPixelId = 1;
  private readonly residentImages = new Map<EglResidentImage, ResidentResource>();
  private snapshotProgram: SnapshotProgram | null = null;
  private readonly effectPositions = new Float32Array(8);
  private readonly effectTexCoords = new Float32Array(8);
  private readonly outputTexCoords = new Float32Array(8);
  private layerSnapshots = new Map<string, LayerSnapshot>();
  private layerOrder: string[] = [];
  private sceneClearColor: number | null = null;
  private activeDamage: DamageRect | null = null;
  private readonly directTargets = new Map<string, DirectOutputPool>();
  private readonly clientTargets = new Map<string, ClientTargetPool>();
  private readonly currentClientPool = new Map<string, string>();
  private nextClientTargetId = 1;
  private compositionFrame = 0;
  /** Size of the logical scene the output pass samples (flat upload or retained scene). */
  private sourceWidth = 0;
  private sourceHeight = 0;
  /**
   * Allocated size of `sourceTexture`, the flat frame's upload target. Kept apart from
   * `sourceWidth`: a retained composition sets that to its scene size without allocating this
   * texture, and a flat frame after it (the locked frame, the retained fallback) must still
   * allocate before uploading. A sub-image upload into an unallocated texture fails, and the
   * output pass then samples an incomplete texture: a black screen.
   */
  private sourceTextureWidth = 0;
  private sourceTextureHeight = 0;
  private sceneWidth = 0;
  private sceneHeight = 0;
  private backdropWidth = 0;
  private backdropHeight = 0;
  private blurWidth = 0;
  private blurHeight = 0;
  private targetWidth = 0;
  private targetHeight = 0;
  private readback: Uint8Array | null = null;
  private clientReadback: Uint8Array | null = null;
  private destroyed = false;
  private readonly transferCounters: Record<EglTransferOperation, EglTransferCounter> = {
    textureUpload: { count: 0, bytes: 0 },
    gpuReadback: { count: 0, bytes: 0 },
    dmabufImport: { count: 0, bytes: 0 },
    gpuCopy: { count: 0, bytes: 0 },
    cpuCopy: { count: 0, bytes: 0 },
  };
  private completionWaitCount = 0;
  private completionWaitCpuElapsedMs = 0;
  private readonly measureTransfers: boolean;

  constructor(
    private readonly drmFd: number,
    options: EglOutputOptions = {},
  ) {
    this.measureTransfers = options.measureTransfers ?? process.env.MOIRE_GPU_METRICS === "1";
    assertLinux("EGL compositor output");
    this.gbm = loadFirst(["libgbm.so.1", "libgbm.so"]);
    this.egl = loadFirst(["libEGL.so.1", "libEGL.so"]);
    this.gl = loadFirst(["libGLESv2.so.2", "libGLESv2.so"]);

    const gbmCreateDevice = this.gbm.func("void *gbm_create_device(int fd)") as NativeFunction;
    this.gbmDestroyDevice = this.gbm.func("void gbm_device_destroy(void *gbm)") as NativeFunction;
    this.gbmDevice = gbmCreateDevice(drmFd);
    if (pointerAddress(this.gbmDevice) === 0n) {
      throw new Error("gbm_create_device failed for EGL output");
    }

    const eglGetPlatformDisplay = this.egl.func(
      "void *eglGetPlatformDisplay(unsigned int platform, void *native_display, const int *attrib_list)",
    ) as NativeFunction;
    const eglInitialize = this.egl.func(
      "unsigned int eglInitialize(void *display, _Out_ int *major, _Out_ int *minor)",
    ) as NativeFunction;
    const eglBindApi = this.egl.func("unsigned int eglBindAPI(unsigned int api)") as NativeFunction;
    const eglChooseConfig = this.egl.func(
      "unsigned int eglChooseConfig(void *display, const int *attrib_list, _Out_ void **configs, int config_size, _Out_ int *num_config)",
    ) as NativeFunction;
    const eglCreateContext = this.egl.func(
      "void *eglCreateContext(void *display, void *config, void *share_context, const int *attrib_list)",
    ) as NativeFunction;
    this.eglMakeCurrent = this.egl.func(
      "unsigned int eglMakeCurrent(void *display, void *draw, void *read, void *context)",
    ) as NativeFunction;
    this.eglDestroyContext = this.egl.func(
      "unsigned int eglDestroyContext(void *display, void *context)",
    ) as NativeFunction;
    this.eglTerminate = this.egl.func("unsigned int eglTerminate(void *display)") as NativeFunction;
    const eglQueryString = this.egl.func(
      "const char *eglQueryString(void *display, int name)",
    ) as NativeFunction;
    const eglGetError = this.egl.func("unsigned int eglGetError(void)") as NativeFunction;
    const eglGetProcAddress = this.egl.func(
      "void *eglGetProcAddress(const char *procname)",
    ) as NativeFunction;

    this.display = eglGetPlatformDisplay(EGL_PLATFORM_GBM_KHR, this.gbmDevice, null);
    if (pointerAddress(this.display) === 0n) {
      throw new Error(`eglGetPlatformDisplay failed: 0x${Number(eglGetError()).toString(16)}`);
    }
    const major = koffi.alloc("int", 1);
    const minor = koffi.alloc("int", 1);
    try {
      if (!Number(eglInitialize(this.display, major, minor))) {
        throw new Error(`eglInitialize failed: 0x${Number(eglGetError()).toString(16)}`);
      }
    } finally {
      koffi.free(major);
      koffi.free(minor);
    }
    if (!Number(eglBindApi(EGL_OPENGL_ES_API))) {
      throw new Error(`eglBindAPI failed: 0x${Number(eglGetError()).toString(16)}`);
    }

    const chooseConfig = (renderable: number): unknown => {
      const configAttrs = new Int32Array([
        EGL_RENDERABLE_TYPE,
        renderable,
        EGL_RED_SIZE,
        8,
        EGL_GREEN_SIZE,
        8,
        EGL_BLUE_SIZE,
        8,
        EGL_ALPHA_SIZE,
        8,
        EGL_NONE,
      ]);
      const configOut = koffi.alloc("void *", 1);
      const configCount = koffi.alloc("int", 1);
      try {
        if (
          !Number(eglChooseConfig(this.display, configAttrs, configOut, 1, configCount)) ||
          (koffi.decode(configCount, "int") as number) < 1
        ) {
          return null;
        }
        return koffi.decode(configOut, "void *");
      } finally {
        koffi.free(configOut);
        koffi.free(configCount);
      }
    };
    const createContext = (version: 2 | 3): unknown => {
      const config = chooseConfig(version === 3 ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_ES2_BIT);
      if (!config) return null;
      const contextAttrs = new Int32Array([EGL_CONTEXT_CLIENT_VERSION, version, EGL_NONE]);
      const context = eglCreateContext(this.display, config, null, contextAttrs);
      return pointerAddress(context) === 0n ? null : context;
    };
    const es3 = options.gles3 ? createContext(3) : null;
    this.clientVersion = es3 ? 3 : 2;
    this.context = es3 ?? createContext(2);
    if (!this.context) {
      throw new Error(`eglCreateContext failed: 0x${Number(eglGetError()).toString(16)}`);
    }
    if (!Number(this.eglMakeCurrent(this.display, null, null, this.context))) {
      throw new Error(`surfaceless eglMakeCurrent failed: 0x${Number(eglGetError()).toString(16)}`);
    }
    currentEglContext = this.context;

    const glGetString = this.gl.func(
      "const char *glGetString(unsigned int name)",
    ) as NativeFunction;
    this.info = {
      eglVendor: nativeString(eglQueryString(this.display, EGL_VENDOR)),
      eglVersion: nativeString(eglQueryString(this.display, EGL_VERSION)),
      eglExtensions: nativeString(eglQueryString(this.display, EGL_EXTENSIONS)),
      glVendor: nativeString(glGetString(0x1f00)),
      glRenderer: nativeString(glGetString(0x1f01)),
      glVersion: nativeString(glGetString(0x1f02)),
    };

    const createImagePtr = eglGetProcAddress("eglCreateImageKHR");
    const destroyImagePtr = eglGetProcAddress("eglDestroyImageKHR");
    const imageTexturePtr = eglGetProcAddress("glEGLImageTargetTexture2DOES");
    if (
      pointerAddress(createImagePtr) === 0n ||
      pointerAddress(destroyImagePtr) === 0n ||
      pointerAddress(imageTexturePtr) === 0n
    ) {
      throw new Error("EGL dma-buf image entry points unavailable");
    }
    this.eglCreateImage = koffi.decode(createImagePtr, eglImageProtos().create) as NativeFunction;
    this.eglDestroyImage = koffi.decode(
      destroyImagePtr,
      eglImageProtos().destroy,
    ) as NativeFunction;
    this.glEglImageTargetTexture = koffi.decode(
      imageTexturePtr,
      eglImageProtos().imageTargetTexture,
    ) as NativeFunction;

    this.gbmBoCreate = this.gbm.func(
      "void *gbm_bo_create(void *gbm, uint32_t width, uint32_t height, uint32_t format, uint32_t flags)",
    ) as NativeFunction;
    this.gbmBoDestroy = this.gbm.func("void gbm_bo_destroy(void *bo)") as NativeFunction;
    this.gbmBoGetFd = this.gbm.func("int gbm_bo_get_fd(void *bo)") as NativeFunction;
    this.gbmBoGetStride = this.gbm.func("uint32_t gbm_bo_get_stride(void *bo)") as NativeFunction;
    this.gbmBoGetFormat = this.gbm.func("uint32_t gbm_bo_get_format(void *bo)") as NativeFunction;
    this.gbmBoGetModifier = this.gbm.func(
      "uint64_t gbm_bo_get_modifier(void *bo)",
    ) as NativeFunction;
    this.gbmBoGetPlaneCount = this.gbm.func(
      "int gbm_bo_get_plane_count(void *bo)",
    ) as NativeFunction;
    this.drm = loadFirst(["libdrm.so.2", "libdrm.so"]);
    this.drmPrimeFdToHandle = this.drm.func(
      "int drmPrimeFDToHandle(int fd, int prime_fd, _Out_ uint32_t *handle)",
    ) as NativeFunction;
    this.drmModeAddFb2 = this.drm.func(
      "int drmModeAddFB2(int fd, uint32_t width, uint32_t height, uint32_t pixel_format, const uint32_t *bo_handles, const uint32_t *pitches, const uint32_t *offsets, _Out_ uint32_t *buf_id, uint32_t flags)",
    ) as NativeFunction;
    this.drmModeAddFb = this.drm.func(
      "int drmModeAddFB(int fd, uint32_t width, uint32_t height, uint8_t depth, uint8_t bpp, uint32_t pitch, uint32_t bo_handle, _Out_ uint32_t *buf_id)",
    ) as NativeFunction;
    this.drmModeRmFb = this.drm.func(
      "int drmModeRmFB(int fd, uint32_t buffer_id)",
    ) as NativeFunction;

    this.glDeleteTextures = this.gl.func(
      "void glDeleteTextures(int n, const unsigned int *textures)",
    ) as NativeFunction;
    this.glDeleteFramebuffers = this.gl.func(
      "void glDeleteFramebuffers(int n, const unsigned int *framebuffers)",
    ) as NativeFunction;
    this.glDeleteProgram = this.gl.func(
      "void glDeleteProgram(unsigned int program)",
    ) as NativeFunction;
    this.glUseProgram = this.gl.func("void glUseProgram(unsigned int program)") as NativeFunction;
    this.glActiveTexture = this.gl.func(
      "void glActiveTexture(unsigned int texture)",
    ) as NativeFunction;
    this.glBindTexture = this.gl.func(
      "void glBindTexture(unsigned int target, unsigned int texture)",
    ) as NativeFunction;
    this.glTexParameteri = this.gl.func(
      "void glTexParameteri(unsigned int target, unsigned int pname, int param)",
    ) as NativeFunction;
    this.glTexImage2D = this.gl.func(
      "void glTexImage2D(unsigned int target, int level, int internalformat, int width, int height, int border, unsigned int format, unsigned int type, const void *pixels)",
    ) as NativeFunction;
    this.glTexSubImage2D = this.gl.func(
      "void glTexSubImage2D(unsigned int target, int level, int xoffset, int yoffset, int width, int height, unsigned int format, unsigned int type, const void *pixels)",
    ) as NativeFunction;
    this.glCopyTexSubImage2D = this.gl.func(
      "void glCopyTexSubImage2D(unsigned int target, int level, int xoffset, int yoffset, int x, int y, int width, int height)",
    ) as NativeFunction;
    this.glPixelStorei = this.gl.func(
      "void glPixelStorei(unsigned int pname, int param)",
    ) as NativeFunction;
    this.glBindFramebuffer = this.gl.func(
      "void glBindFramebuffer(unsigned int target, unsigned int framebuffer)",
    ) as NativeFunction;
    this.glFramebufferTexture2D = this.gl.func(
      "void glFramebufferTexture2D(unsigned int target, unsigned int attachment, unsigned int textarget, unsigned int texture, int level)",
    ) as NativeFunction;
    this.glCheckFramebufferStatus = this.gl.func(
      "unsigned int glCheckFramebufferStatus(unsigned int target)",
    ) as NativeFunction;
    this.glViewport = this.gl.func(
      "void glViewport(int x, int y, int width, int height)",
    ) as NativeFunction;
    this.glScissor = this.gl.func(
      "void glScissor(int x, int y, int width, int height)",
    ) as NativeFunction;
    this.glClearColor = this.gl.func(
      "void glClearColor(float red, float green, float blue, float alpha)",
    ) as NativeFunction;
    this.glClear = this.gl.func("void glClear(unsigned int mask)") as NativeFunction;
    this.glUniform1i = this.gl.func("void glUniform1i(int location, int v0)") as NativeFunction;
    this.glUniform1f = this.gl.func("void glUniform1f(int location, float v0)") as NativeFunction;
    this.glUniform4f = this.gl.func(
      "void glUniform4f(int location, float v0, float v1, float v2, float v3)",
    ) as NativeFunction;
    this.glUniform2f = this.gl.func(
      "void glUniform2f(int location, float v0, float v1)",
    ) as NativeFunction;
    this.glEnable = this.gl.func("void glEnable(unsigned int cap)") as NativeFunction;
    this.glDisable = this.gl.func("void glDisable(unsigned int cap)") as NativeFunction;
    this.glBlendFunc = this.gl.func(
      "void glBlendFunc(unsigned int sfactor, unsigned int dfactor)",
    ) as NativeFunction;
    this.glEnableVertexAttribArray = this.gl.func(
      "void glEnableVertexAttribArray(unsigned int index)",
    ) as NativeFunction;
    this.glVertexAttribPointer = this.gl.func(
      "void glVertexAttribPointer(unsigned int index, int size, unsigned int type, unsigned char normalized, int stride, const void *pointer)",
    ) as NativeFunction;
    this.glDrawArrays = this.gl.func(
      "void glDrawArrays(unsigned int mode, int first, int count)",
    ) as NativeFunction;
    this.glReadPixels = this.gl.func(
      "void glReadPixels(int x, int y, int width, int height, unsigned int format, unsigned int type, _Out_ void *pixels)",
    ) as NativeFunction;
    this.glFinish = bindNativeFunction<() => void>(this.gl, "void glFinish(void)");
    this.glGetIntegerv = this.gl.func(
      "void glGetIntegerv(unsigned int pname, _Out_ int *params)",
    ) as NativeFunction;
    this.glIsEnabled = this.gl.func(
      "unsigned char glIsEnabled(unsigned int cap)",
    ) as NativeFunction;
    this.glGetError = bindNativeFunction<() => number>(this.gl, "unsigned int glGetError(void)");
    this.program = this.createProgram();
    const glGetAttribLocation = this.gl.func(
      "int glGetAttribLocation(unsigned int program, const char *name)",
    ) as NativeFunction;
    const glGetUniformLocation = this.gl.func(
      "int glGetUniformLocation(unsigned int program, const char *name)",
    ) as NativeFunction;
    this.positionLocation = Number(glGetAttribLocation(this.program, "a_position"));
    this.texCoordLocation = Number(glGetAttribLocation(this.program, "a_tex_coord"));
    this.samplerLocation = Number(glGetUniformLocation(this.program, "u_texture"));
    this.opacityLocation = Number(glGetUniformLocation(this.program, "u_opacity"));
    this.geometryLocation = Number(glGetUniformLocation(this.program, "u_surface_geometry"));
    this.hasGeometryLocation = Number(glGetUniformLocation(this.program, "u_has_surface_geometry"));
    this.uvRectLocation = Number(glGetUniformLocation(this.program, "u_uv_rect"));
    this.layerSizeLocation = Number(glGetUniformLocation(this.program, "u_layer_size"));
    this.cornerRadiiLocation = Number(glGetUniformLocation(this.program, "u_corner_radii"));
    this.contentShapeModeLocation = Number(
      glGetUniformLocation(this.program, "u_content_shape_mode"),
    );
    this.contentShapeBoundsLocation = Number(
      glGetUniformLocation(this.program, "u_content_shape_bounds"),
    );
    this.contentShapeRadiiLocation = Number(
      glGetUniformLocation(this.program, "u_content_shape_radii"),
    );
    this.modeLocation = Number(glGetUniformLocation(this.program, "u_mode"));
    this.shadowRectLocation = Number(glGetUniformLocation(this.program, "u_shadow_rect"));
    this.shadowRadiusLocation = Number(glGetUniformLocation(this.program, "u_shadow_radius"));
    this.shadowSoftnessLocation = Number(glGetUniformLocation(this.program, "u_shadow_softness"));
    this.shadowColorLocation = Number(glGetUniformLocation(this.program, "u_shadow_color"));
    this.blurDirectionLocation = Number(glGetUniformLocation(this.program, "u_blur_direction"));
    this.saturationLocation = Number(glGetUniformLocation(this.program, "u_saturation"));
    this.tintColorLocation = Number(glGetUniformLocation(this.program, "u_tint_color"));
    this.hasColorMatrixLocation = Number(glGetUniformLocation(this.program, "u_has_color_matrix"));
    this.colorRow0Location = Number(glGetUniformLocation(this.program, "u_color_row_0"));
    this.colorRow1Location = Number(glGetUniformLocation(this.program, "u_color_row_1"));
    this.colorRow2Location = Number(glGetUniformLocation(this.program, "u_color_row_2"));
    this.colorRow3Location = Number(glGetUniformLocation(this.program, "u_color_row_3"));
    this.colorOffsetLocation = Number(glGetUniformLocation(this.program, "u_color_offset"));
    this.outputSwizzleLocation = Number(glGetUniformLocation(this.program, "u_output_swizzle"));
    if (this.positionLocation < 0 || this.texCoordLocation < 0) {
      throw new Error("GLES compositor shader attributes unavailable");
    }
    // Every compositor command is a quad. Keep the two client-array inputs
    // enabled for the lifetime of this context and only replace their pointers.
    this.glEnableVertexAttribArray(this.positionLocation);
    this.glEnableVertexAttribArray(this.texCoordLocation);

    const glGenTextures = this.gl.func(
      "void glGenTextures(int n, _Out_ unsigned int *textures)",
    ) as NativeFunction;
    const glGenFramebuffers = this.gl.func(
      "void glGenFramebuffers(int n, _Out_ unsigned int *framebuffers)",
    ) as NativeFunction;
    this.sourceTexture = uintOut((out) => void glGenTextures(1, out));
    this.targetTexture = uintOut((out) => void glGenTextures(1, out));
    this.sceneTexture = uintOut((out) => void glGenTextures(1, out));
    this.backdropTexture = uintOut((out) => void glGenTextures(1, out));
    this.blurTextureA = uintOut((out) => void glGenTextures(1, out));
    this.blurTextureB = uintOut((out) => void glGenTextures(1, out));
    this.framebuffer = uintOut((out) => void glGenFramebuffers(1, out));
    this.sceneFramebuffer = uintOut((out) => void glGenFramebuffers(1, out));
    this.blurFramebufferA = uintOut((out) => void glGenFramebuffers(1, out));
    this.blurFramebufferB = uintOut((out) => void glGenFramebuffers(1, out));
    this.configureTexture(this.sourceTexture);
    this.configureTexture(this.targetTexture);
    this.configureTexture(this.sceneTexture);
    this.configureTexture(this.backdropTexture);
    this.configureTexture(this.blurTextureA);
    this.configureTexture(this.blurTextureB);
    this.outputSourceTexture = this.sourceTexture;
    this.glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    this.glPixelStorei(GL_PACK_ALIGNMENT, 4);
  }

  private createShader(kind: number, source: string): number {
    const glCreateShader = this.gl.func(
      "unsigned int glCreateShader(unsigned int type)",
    ) as NativeFunction;
    const glShaderSource = this.gl.func(
      "void glShaderSource(unsigned int shader, int count, const char **string, const int *length)",
    ) as NativeFunction;
    const glCompileShader = this.gl.func(
      "void glCompileShader(unsigned int shader)",
    ) as NativeFunction;
    const glGetShaderiv = this.gl.func(
      "void glGetShaderiv(unsigned int shader, unsigned int pname, _Out_ int *params)",
    ) as NativeFunction;
    const glGetShaderInfoLog = this.gl.func(
      "void glGetShaderInfoLog(unsigned int shader, int bufSize, _Out_ int *length, _Out_ char *infoLog)",
    ) as NativeFunction;
    const shader = Number(glCreateShader(kind));
    glShaderSource(shader, 1, [source], null);
    glCompileShader(shader);
    const status = koffi.alloc("int", 1);
    try {
      glGetShaderiv(shader, GL_COMPILE_STATUS, status);
      if (!(koffi.decode(status, "int") as number)) {
        const log = Buffer.alloc(2048);
        glGetShaderInfoLog(shader, log.length, null, log);
        throw new Error(
          `GLES shader compile failed: ${log.toString("utf8").replace(/\0.*$/s, "")}`,
        );
      }
    } finally {
      koffi.free(status);
    }
    return shader;
  }

  private createProgram(snapshot = false): number {
    const vertex = this.createShader(
      GL_VERTEX_SHADER,
      "attribute vec2 a_position; attribute vec2 a_tex_coord; varying vec2 v_tex_coord; void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_tex_coord = a_tex_coord; }",
    );
    const fragment = this.createShader(
      GL_FRAGMENT_SHADER,
      snapshot
        ? `precision mediump float;
uniform sampler2D u_texture;
uniform float u_force_opaque;
varying vec2 v_tex_coord;
void main() {
  vec4 color = texture2D(u_texture, v_tex_coord);
  gl_FragColor = vec4(color.bgr, mix(color.a, 1.0, u_force_opaque));
}`
        : `precision mediump float;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform vec4 u_surface_geometry;
uniform float u_has_surface_geometry;
uniform vec4 u_uv_rect;
uniform vec2 u_layer_size;
uniform vec4 u_corner_radii;
uniform float u_content_shape_mode;
uniform vec4 u_content_shape_bounds;
uniform vec4 u_content_shape_radii;
uniform float u_mode;
uniform vec4 u_shadow_rect;
uniform float u_shadow_radius;
uniform float u_shadow_softness;
uniform vec4 u_shadow_color;
uniform vec2 u_blur_direction;
uniform float u_saturation;
uniform vec4 u_tint_color;
uniform float u_has_color_matrix;
uniform vec4 u_color_row_0;
uniform vec4 u_color_row_1;
uniform vec4 u_color_row_2;
uniform vec4 u_color_row_3;
uniform vec4 u_color_offset;
uniform float u_output_swizzle;
varying vec2 v_tex_coord;

bool outside_rounded_rect(vec2 local) {
  bool left = local.x < u_layer_size.x * 0.5;
  bool top = local.y < u_layer_size.y * 0.5;
  float radius = top
    ? (left ? u_corner_radii.x : u_corner_radii.y)
    : (left ? u_corner_radii.w : u_corner_radii.z);
  radius = min(radius, min(u_layer_size.x, u_layer_size.y) * 0.5);
  if (radius <= 0.0) return false;
  vec2 center = vec2(
    left ? radius : u_layer_size.x - radius,
    top ? radius : u_layer_size.y - radius
  );
  bool corner =
    (left ? local.x < radius : local.x > u_layer_size.x - radius) &&
    (top ? local.y < radius : local.y > u_layer_size.y - radius);
  return corner && distance(local, center) > radius;
}

float frame_coverage(vec2 local) {
  vec2 p = local - u_content_shape_bounds.xy;
  vec2 size = u_content_shape_bounds.zw;
  bool outside = p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y;
  if (outside) return u_content_shape_mode > 1.5 ? 1.0 : 0.0;
  bool left = p.x < size.x * 0.5;
  bool top = p.y < size.y * 0.5;
  float radius = top
    ? (left ? u_content_shape_radii.x : u_content_shape_radii.y)
    : (left ? u_content_shape_radii.w : u_content_shape_radii.z);
  if (radius <= 0.0) return 1.0;
  bool corner = (left ? p.x < radius : p.x > size.x - radius) &&
                (top ? p.y < radius : p.y > size.y - radius);
  if (!corner) return 1.0;
  vec2 center = vec2(left ? radius : size.x - radius, top ? radius : size.y - radius);
  return clamp(radius + 0.5 - distance(p, center), 0.0, 1.0);
}

void main() {
  if (u_mode > 1.5 && u_mode < 2.5) {
    vec4 color = texture2D(u_texture, v_tex_coord) * 0.227027;
    color += texture2D(u_texture, v_tex_coord + u_blur_direction * 1.384615) * 0.316216;
    color += texture2D(u_texture, v_tex_coord - u_blur_direction * 1.384615) * 0.316216;
    color += texture2D(u_texture, v_tex_coord + u_blur_direction * 3.230769) * 0.070270;
    color += texture2D(u_texture, v_tex_coord - u_blur_direction * 3.230769) * 0.070270;
    gl_FragColor = color;
    return;
  }

  vec2 uv_span = max(u_uv_rect.zw - u_uv_rect.xy, vec2(0.00001));
  vec2 local = ((v_tex_coord - u_uv_rect.xy) / uv_span) * u_layer_size;
  if (u_mode > 0.5 && u_mode < 1.5) {
    vec2 q = abs(local - u_shadow_rect.xy) - u_shadow_rect.zw + vec2(u_shadow_radius);
    float distance_field = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - u_shadow_radius;
    float coverage = 1.0 - smoothstep(-u_shadow_softness, u_shadow_softness, distance_field);
    gl_FragColor = vec4(u_shadow_color.rgb * u_shadow_color.a, u_shadow_color.a) * coverage;
    return;
  }
  if (outside_rounded_rect(local)) discard;

  vec4 color = texture2D(u_texture, v_tex_coord);
  float coverage = 1.0;
  if (u_content_shape_mode > 0.5) {
    coverage = frame_coverage(local);
    if (coverage <= 0.0) discard;
    vec2 p = local - u_content_shape_bounds.xy;
    bool outside = p.x < 0.0 || p.y < 0.0 ||
                   p.x >= u_content_shape_bounds.z || p.y >= u_content_shape_bounds.w;
    if (outside && color.a > 0.999) discard;
  }
  if (u_mode > 2.5) {
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luminance), color.rgb, u_saturation);
    color.rgb = color.rgb * (1.0 - u_tint_color.a) + u_tint_color.rgb * u_tint_color.a;
    gl_FragColor = color * u_opacity * coverage;
    return;
  }
  if (u_has_surface_geometry > 0.5 && u_content_shape_mode < 0.5) {
    bool outside =
      v_tex_coord.x < u_surface_geometry.x ||
      v_tex_coord.y < u_surface_geometry.y ||
      v_tex_coord.x >= u_surface_geometry.z ||
      v_tex_coord.y >= u_surface_geometry.w;
    if (outside && color.a > 0.999) discard;
  }
  if (u_has_color_matrix > 0.5) {
    float source_alpha = max(color.a, 0.00001);
    vec4 semantic = vec4(color.bgr / source_alpha, color.a);
    vec4 mapped = vec4(
      dot(u_color_row_0, semantic),
      dot(u_color_row_1, semantic),
      dot(u_color_row_2, semantic),
      dot(u_color_row_3, semantic)
    ) + u_color_offset;
    mapped = clamp(mapped, 0.0, 1.0);
    mapped.rgb *= mapped.a;
    color = vec4(mapped.b, mapped.g, mapped.r, mapped.a);
  }
  if (u_output_swizzle > 0.5) color = color.bgra;
  gl_FragColor = color * u_opacity * coverage;
}`,
    );
    const glCreateProgram = this.gl.func("unsigned int glCreateProgram(void)") as NativeFunction;
    const glAttachShader = this.gl.func(
      "void glAttachShader(unsigned int program, unsigned int shader)",
    ) as NativeFunction;
    const glLinkProgram = this.gl.func(
      "void glLinkProgram(unsigned int program)",
    ) as NativeFunction;
    const glGetProgramiv = this.gl.func(
      "void glGetProgramiv(unsigned int program, unsigned int pname, _Out_ int *params)",
    ) as NativeFunction;
    const glGetProgramInfoLog = this.gl.func(
      "void glGetProgramInfoLog(unsigned int program, int bufSize, _Out_ int *length, _Out_ char *infoLog)",
    ) as NativeFunction;
    const glDeleteShader = this.gl.func(
      "void glDeleteShader(unsigned int shader)",
    ) as NativeFunction;
    const program = Number(glCreateProgram());
    try {
      glAttachShader(program, vertex);
      glAttachShader(program, fragment);
      glLinkProgram(program);
      const status = koffi.alloc("int", 1);
      try {
        glGetProgramiv(program, GL_LINK_STATUS, status);
        if (!(koffi.decode(status, "int") as number)) {
          const log = Buffer.alloc(2048);
          glGetProgramInfoLog(program, log.length, null, log);
          throw new Error(
            `GLES program link failed: ${log.toString("utf8").replace(/\0.*$/s, "")}`,
          );
        }
      } finally {
        koffi.free(status);
      }
      return program;
    } finally {
      glDeleteShader(vertex);
      glDeleteShader(fragment);
    }
  }

  /** Cumulative actual boundary calls; bytes are payload or referenced import extent. */
  getTransferMetrics() {
    const counter = (operation: EglTransferOperation) =>
      this.measureTransfers ? { ...this.transferCounters[operation] } : null;
    return {
      enabled: this.measureTransfers,
      textureUpload: counter("textureUpload"),
      gpuReadback: counter("gpuReadback"),
      dmabufImport: counter("dmabufImport"),
      gpuCopy: counter("gpuCopy"),
      cpuCopy: counter("cpuCopy"),
      completionWait: this.measureTransfers
        ? { count: this.completionWaitCount, cpuElapsedMs: this.completionWaitCpuElapsedMs }
        : null,
      // No timer query exists here. glFinish wall duration is not GPU execution time.
      gpuExecutionMs: null,
    };
  }
  private noteTransfer(operation: EglTransferOperation, bytes: number): void {
    if (!this.measureTransfers) return;
    this.transferCounters[operation].count++;
    this.transferCounters[operation].bytes += bytes;
  }
  private finishGpuWork(): void {
    if (!this.measureTransfers) {
      this.glFinish();
      return;
    }
    const started = performance.now();
    try {
      this.glFinish();
    } finally {
      this.completionWaitCount++;
      this.completionWaitCpuElapsedMs += performance.now() - started;
    }
  }

  private configureTexture(texture: number): void {
    this.glBindTexture(GL_TEXTURE_2D, texture);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  }

  beginFrame(source: Uint8Array, width: number, height: number): void {
    this.bindContext();
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    if (source.byteLength < width * height * 4) {
      throw new RangeError("Logical EGL scene buffer is too small");
    }
    this.glActiveTexture(GL_TEXTURE0);
    this.glBindTexture(GL_TEXTURE_2D, this.sourceTexture);
    this.outputSourceTexture = this.sourceTexture;
    this.sourceWidth = width;
    this.sourceHeight = height;
    if (width !== this.sourceTextureWidth || height !== this.sourceTextureHeight) {
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        width,
        height,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        source,
      );
      this.sourceTextureWidth = width;
      this.sourceTextureHeight = height;
    } else {
      this.glTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        source,
      );
    }
    this.noteTransfer("textureUpload", width * height * 4);
  }

  private residentResource(image: EglResidentImage): ResidentResource {
    if (this.destroyed || image.isDestroyed) throw new Error("EGL resident image is destroyed");
    if (image.owner !== this) throw new Error("EGL resident image belongs to another scaler");
    const resource = this.residentImages.get(image);
    if (!resource) throw new Error("EGL resident image is not owned by this scaler");
    return resource;
  }

  /** Save only GL state changed by import/copy/readback; retained uniforms stay untouched. */
  private preserveSnapshotState(): () => void {
    const integer = (name: number, count = 1): Int32Array => {
      const value = new Int32Array(count);
      this.glGetIntegerv(name, value);
      return value;
    };
    const framebuffer = integer(GL_FRAMEBUFFER_BINDING)[0]!;
    const program = integer(GL_CURRENT_PROGRAM)[0]!;
    const viewport = integer(GL_VIEWPORT, 4);
    const scissor = integer(GL_SCISSOR_BOX, 4);
    const blendEnabled = Boolean(this.glIsEnabled(GL_BLEND));
    const scissorEnabled = Boolean(this.glIsEnabled(GL_SCISSOR_TEST));
    const activeTexture = integer(GL_ACTIVE_TEXTURE)[0]!;
    this.glActiveTexture(GL_TEXTURE0);
    const texture = integer(GL_TEXTURE_BINDING_2D)[0]!;
    return () => {
      this.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
      this.glUseProgram(program);
      this.glViewport(...viewport);
      this.glScissor(...scissor);
      (blendEnabled ? this.glEnable : this.glDisable)(GL_BLEND);
      (scissorEnabled ? this.glEnable : this.glDisable)(GL_SCISSOR_TEST);
      this.glActiveTexture(GL_TEXTURE0);
      this.glBindTexture(GL_TEXTURE_2D, texture);
      this.glActiveTexture(activeTexture);
    };
  }

  private residentSnapshotProgram(): SnapshotProgram {
    if (this.snapshotProgram) return this.snapshotProgram;
    const program = this.createProgram(true);
    const attribute = this.gl.func(
      "int glGetAttribLocation(unsigned int program, const char *name)",
    ) as NativeFunction;
    const uniform = this.gl.func(
      "int glGetUniformLocation(unsigned int program, const char *name)",
    ) as NativeFunction;
    this.snapshotProgram = {
      program,
      position: Number(attribute(program, "a_position")),
      texCoord: Number(attribute(program, "a_tex_coord")),
      sampler: Number(uniform(program, "u_texture")),
      opaque: Number(uniform(program, "u_force_opaque")),
    };
    return this.snapshotProgram;
  }

  /**
   * GPU-copy a single-plane ARGB/XRGB image before allowing producer reuse.
   * The caller keeps fd ownership on success and failure (EGL EXT import spec).
   */
  snapshotDmabuf(input: EglDmabufSnapshotInput): EglResidentImage {
    this.bindContext();
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    const { width, height, format, plane } = input;
    const eglInteger = (value: number, positive: boolean) =>
      Number.isInteger(value) && value >= (positive ? 1 : 0) && value <= 0x7fffffff;
    if (
      !eglInteger(width, true) ||
      !eglInteger(height, true) ||
      !eglInteger(plane.fd, false) ||
      !eglInteger(plane.offset, false) ||
      !eglInteger(plane.stride, true) ||
      plane.stride < width * 4
    )
      throw new RangeError("Invalid dma-buf snapshot dimensions or plane");
    if (format !== DRM_FORMAT_ARGB8888 && format !== DRM_FORMAT_XRGB8888)
      throw new Error("DMA-buf snapshot supports only single-plane ARGB8888/XRGB8888");
    const extensions = new Set(this.info.eglExtensions.split(/\s+/));
    if (!extensions.has("EGL_EXT_image_dma_buf_import"))
      throw new Error("EGL_EXT_image_dma_buf_import is unavailable");
    if (plane.modifier < 0n || plane.modifier > 0xffffffffffffffffn)
      throw new RangeError("Invalid dma-buf modifier");
    const implicitModifier = plane.modifier === 0xffffffffffffffffn;
    const modifierExtension = extensions.has("EGL_EXT_image_dma_buf_import_modifiers");
    if (!implicitModifier && plane.modifier !== 0n && !modifierExtension)
      throw new Error("Nonlinear dma-buf import requires EGL_EXT_image_dma_buf_import_modifiers");
    const attributes = [
      EGL_WIDTH,
      width,
      EGL_HEIGHT,
      height,
      EGL_LINUX_DRM_FOURCC_EXT,
      format,
      EGL_DMA_BUF_PLANE0_FD_EXT,
      plane.fd,
      EGL_DMA_BUF_PLANE0_OFFSET_EXT,
      plane.offset,
      EGL_DMA_BUF_PLANE0_PITCH_EXT,
      plane.stride,
    ];
    if (modifierExtension && !implicitModifier)
      attributes.push(
        EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT,
        Number(plane.modifier & 0xffffffffn) | 0,
        EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT,
        Number(plane.modifier >> 32n) | 0,
      );
    attributes.push(EGL_NONE);
    const restore = this.preserveSnapshotState();
    let importedImage: unknown = null,
      importedTexture = 0,
      texture = 0,
      framebuffer = 0;
    try {
      const pendingError = this.glGetError();
      if (pendingError !== 0)
        throw new Error(
          `GLES had an error before dma-buf snapshot: 0x${pendingError.toString(16)}`,
        );
      importedImage = this.eglCreateImage(
        this.display,
        null,
        EGL_LINUX_DMA_BUF_EXT,
        null,
        new Int32Array(attributes),
      );
      if (pointerAddress(importedImage) === 0n)
        throw new Error("eglCreateImageKHR dma-buf snapshot import failed");
      this.noteTransfer("dmabufImport", plane.stride * height);
      const genTextures = this.gl.func(
        "void glGenTextures(int n, _Out_ unsigned int *textures)",
      ) as NativeFunction;
      const genFramebuffers = this.gl.func(
        "void glGenFramebuffers(int n, _Out_ unsigned int *framebuffers)",
      ) as NativeFunction;
      importedTexture = uintOut((out) => void genTextures(1, out));
      this.configureTexture(importedTexture);
      this.glEglImageTargetTexture(GL_TEXTURE_2D, importedImage);
      const importError = this.glGetError();
      if (importError !== 0)
        throw new Error(`GLES dma-buf texture import failed: 0x${importError.toString(16)}`);
      texture = uintOut((out) => void genTextures(1, out));
      framebuffer = uintOut((out) => void genFramebuffers(1, out));
      this.configureTexture(texture);
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        width,
        height,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        null,
      );
      this.bindColorTarget(framebuffer, texture);
      this.glViewport(0, 0, width, height);
      this.glDisable(GL_BLEND);
      this.glDisable(GL_SCISSOR_TEST);
      const shader = this.residentSnapshotProgram();
      this.glUseProgram(shader.program);
      this.glUniform1i(shader.sampler, 0);
      this.glUniform1f(shader.opaque, format === DRM_FORMAT_XRGB8888 ? 1 : 0);
      this.glBindTexture(GL_TEXTURE_2D, importedTexture);
      this.glEnableVertexAttribArray(shader.position);
      this.glEnableVertexAttribArray(shader.texCoord);
      this.glVertexAttribPointer(shader.position, 2, GL_FLOAT, 0, 0, FULL_QUAD_POSITIONS);
      this.glVertexAttribPointer(shader.texCoord, 2, GL_FLOAT, 0, 0, UNIT_QUAD_TEX_COORDS);
      this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
      // Wait before dropping the import, so wl_buffer.release permits immediate reuse.
      this.finishGpuWork();
      const copyError = this.glGetError();
      if (copyError !== 0)
        throw new Error(`GLES dma-buf snapshot copy failed: 0x${copyError.toString(16)}`);
      this.noteTransfer("gpuCopy", width * height * 4);
      const resource = { texture, framebuffer };
      const image = new EglResidentImage(
        this,
        width,
        height,
        () => {
          this.bindContext();
          const live = this.residentResource(image);
          const restoreReadback = this.preserveSnapshotState();
          try {
            const pixels = new Uint8Array(width * height * 4);
            this.glBindFramebuffer(GL_FRAMEBUFFER, live.framebuffer);
            this.glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
            const readError = this.glGetError();
            if (readError !== 0)
              throw new Error(`GLES resident readback failed: 0x${readError.toString(16)}`);
            this.noteTransfer("gpuReadback", pixels.byteLength);
            return pixels;
          } finally {
            restoreReadback();
          }
        },
        () => {
          if (!this.residentImages.delete(image)) return;
          this.bindContext();
          this.glDeleteFramebuffers(1, new Uint32Array([resource.framebuffer]));
          this.glDeleteTextures(1, new Uint32Array([resource.texture]));
        },
      );
      this.residentImages.set(image, resource);
      texture = 0;
      framebuffer = 0;
      return image;
    } finally {
      if (framebuffer) this.glDeleteFramebuffers(1, new Uint32Array([framebuffer]));
      if (texture) this.glDeleteTextures(1, new Uint32Array([texture]));
      if (importedTexture) this.glDeleteTextures(1, new Uint32Array([importedTexture]));
      if (pointerAddress(importedImage) !== 0n) this.eglDestroyImage(this.display, importedImage);
      restore();
    }
  }

  private textureForLayer(layer: EglCompositionLayer): number {
    if (layer.pixels instanceof EglResidentImage) {
      const resource = this.residentResource(layer.pixels);
      if (layer.sourceWidth !== layer.pixels.width || layer.sourceHeight !== layer.pixels.height) {
        throw new RangeError("Resident layer dimensions differ from its image");
      }
      this.glBindTexture(GL_TEXTURE_2D, resource.texture);
      const filter = layer.sampling === "nearest" ? GL_NEAREST : GL_LINEAR;
      this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
      this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
      return resource.texture;
    }
    let cached = this.layerTextures.get(layer.id);
    if (!cached) {
      const glGenTextures = this.gl.func(
        "void glGenTextures(int n, _Out_ unsigned int *textures)",
      ) as NativeFunction;
      const texture = uintOut((out) => void glGenTextures(1, out));
      this.configureTexture(texture);
      cached = {
        texture,
        width: 0,
        height: 0,
        revision: undefined,
        pixels: layer.pixels,
        sampling: "linear",
        lastSeenFrame: this.compositionFrame,
      };
      this.layerTextures.set(layer.id, cached);
    }
    cached.lastSeenFrame = this.compositionFrame;
    this.glBindTexture(GL_TEXTURE_2D, cached.texture);
    const sampling = layer.sampling ?? "linear";
    if (cached.sampling !== sampling) {
      const filter = sampling === "nearest" ? GL_NEAREST : GL_LINEAR;
      this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
      this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
      cached.sampling = sampling;
    }

    const changed =
      cached.width !== layer.sourceWidth ||
      cached.height !== layer.sourceHeight ||
      layer.revision == null ||
      cached.revision !== layer.revision ||
      cached.pixels !== layer.pixels;
    if (!changed) return cached.texture;

    let upload = layer.pixels;
    const tightStride = layer.sourceWidth * 4;
    if (layer.sourceStride !== tightStride) {
      upload = new Uint8Array(tightStride * layer.sourceHeight);
      this.noteTransfer("cpuCopy", upload.byteLength);
      for (let row = 0; row < layer.sourceHeight; row++) {
        upload.set(
          layer.pixels.subarray(row * layer.sourceStride, row * layer.sourceStride + tightStride),
          row * tightStride,
        );
      }
    }
    if (cached.width !== layer.sourceWidth || cached.height !== layer.sourceHeight) {
      // Allocate storage only when the layer dimensions actually change.
      // Repeated glTexImage2D on an animated surface can make virtual GPU
      // drivers retain each replaced backing allocation until much later,
      // producing unbounded compositor RSS under a 60 Hz workload.
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        layer.sourceWidth,
        layer.sourceHeight,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        upload,
      );
    } else {
      this.glTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0,
        0,
        layer.sourceWidth,
        layer.sourceHeight,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        upload,
      );
    }
    this.noteTransfer("textureUpload", layer.sourceWidth * layer.sourceHeight * 4);
    cached.width = layer.sourceWidth;
    cached.height = layer.sourceHeight;
    cached.revision = layer.revision;
    cached.pixels = layer.pixels;
    return cached.texture;
  }

  private pixelIdentity(pixels: Uint8Array | EglResidentImage): number {
    let id = this.pixelIds.get(pixels);
    if (id != null) return id;
    id = this.nextPixelId++;
    this.pixelIds.set(pixels, id);
    return id;
  }

  private backdropDependencyKey(
    scene: EglCompositionScene,
    layerIndex: number,
    sampleBounds: DamageRect,
  ): string {
    const material = scene.layers[layerIndex]!;
    const dependencies = scene.layers.slice(0, layerIndex).flatMap((layer) => {
      if (!rectsIntersect(layerBounds(layer, scene.width, scene.height), sampleBounds)) {
        return [];
      }
      return [
        {
          id: layer.id,
          pixels: this.pixelIdentity(layer.pixels),
          revision: layer.revision ?? this.compositionFrame,
          signature: layerSignature(layer),
        },
      ];
    });
    return JSON.stringify({
      clearColor: scene.clearColor,
      width: scene.width,
      height: scene.height,
      destination: material.destination,
      transform: material.transform,
      transformOrigin: material.transformOrigin,
      backdropBlur: material.backdropBlur,
      dependencies,
    });
  }

  private backdropCacheForLayer(
    layer: EglCompositionLayer,
    width: number,
    height: number,
  ): BackdropCache {
    let cached = this.backdropCaches.get(layer.id);
    if (!cached) {
      const glGenTextures = this.gl.func(
        "void glGenTextures(int n, _Out_ unsigned int *textures)",
      ) as NativeFunction;
      cached = {
        texture: uintOut((out) => void glGenTextures(1, out)),
        width: 0,
        height: 0,
        dependencyKey: "",
        lastSeenFrame: this.compositionFrame,
      };
      this.configureTexture(cached.texture);
      this.backdropCaches.set(layer.id, cached);
    }
    cached.lastSeenFrame = this.compositionFrame;
    if (cached.width !== width || cached.height !== height) {
      this.glBindTexture(GL_TEXTURE_2D, cached.texture);
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        width,
        height,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        null,
      );
      cached.width = width;
      cached.height = height;
      cached.dependencyKey = "";
    }
    return cached;
  }

  private writeLayerPoint(
    layer: EglCompositionLayer,
    x: number,
    y: number,
    sceneWidth: number,
    sceneHeight: number,
    target: Float32Array,
    index: number,
  ): void {
    const matrix = layer.transform;
    let px: number;
    let py: number;
    if (!matrix) {
      px = layer.destination.x + x;
      py = layer.destination.y + y;
    } else {
      const origin = layer.transformOrigin ?? [
        layer.destination.width / 2,
        layer.destination.height / 2,
        0,
      ];
      const lx = x - origin[0];
      const ly = y - origin[1];
      const lz = -(origin[2] ?? 0);
      const tx = matrix[0]! * lx + matrix[4]! * ly + matrix[8]! * lz + matrix[12]!;
      const ty = matrix[1]! * lx + matrix[5]! * ly + matrix[9]! * lz + matrix[13]!;
      const tw = matrix[3]! * lx + matrix[7]! * ly + matrix[11]! * lz + matrix[15]!;
      const invW = tw === 0 ? 1 : 1 / tw;
      px = layer.destination.x + origin[0] + tx * invW;
      py = layer.destination.y + origin[1] + ty * invW;
    }
    target[index] = (px / sceneWidth) * 2 - 1;
    target[index + 1] = (py / sceneHeight) * 2 - 1;
  }

  private writeLayerQuad(
    layer: EglCompositionLayer,
    x: number,
    y: number,
    width: number,
    height: number,
    sceneWidth: number,
    sceneHeight: number,
    target: Float32Array,
  ): void {
    this.writeLayerPoint(layer, x, y, sceneWidth, sceneHeight, target, 0);
    this.writeLayerPoint(layer, x + width, y, sceneWidth, sceneHeight, target, 2);
    this.writeLayerPoint(layer, x, y + height, sceneWidth, sceneHeight, target, 4);
    this.writeLayerPoint(layer, x + width, y + height, sceneWidth, sceneHeight, target, 6);
  }

  private writeTexQuad(target: Float32Array, x0: number, y0: number, x1: number, y1: number): void {
    target[0] = x0;
    target[1] = y0;
    target[2] = x1;
    target[3] = y0;
    target[4] = x0;
    target[5] = y1;
    target[6] = x1;
    target[7] = y1;
  }

  private geometryForLayer(
    scene: EglCompositionScene,
    layer: EglCompositionLayer,
  ): CachedLayerGeometry {
    // compositionDamage already produced this structural signature for the
    // retained snapshot. Reuse it instead of serialising geometry a second time.
    const signature = this.layerSnapshots.get(layer.id)?.signature ?? layerSignature(layer);
    let geometry = this.layerGeometry.get(layer.id);
    if (!geometry) {
      geometry = {
        signature: "",
        sceneWidth: 0,
        sceneHeight: 0,
        positions: new Float32Array(8),
        texCoords: new Float32Array(8),
        shadowPositions: new Float32Array(8),
        lastSeenFrame: this.compositionFrame,
      };
      this.layerGeometry.set(layer.id, geometry);
    }
    geometry.lastSeenFrame = this.compositionFrame;
    if (
      geometry.signature === signature &&
      geometry.sceneWidth === scene.width &&
      geometry.sceneHeight === scene.height
    ) {
      return geometry;
    }

    this.writeLayerQuad(
      layer,
      0,
      0,
      layer.destination.width,
      layer.destination.height,
      scene.width,
      scene.height,
      geometry.positions,
    );
    const source = layer.sourceRect ?? {
      x: 0,
      y: 0,
      width: layer.sourceWidth,
      height: layer.sourceHeight,
    };
    this.writeTexQuad(
      geometry.texCoords,
      source.x / layer.sourceWidth,
      source.y / layer.sourceHeight,
      (source.x + source.width) / layer.sourceWidth,
      (source.y + source.height) / layer.sourceHeight,
    );
    const shadow = layer.dropShadow;
    if (shadow) {
      const padding = Math.max(1, shadow.blurRadius + Math.max(0, shadow.spread ?? 0));
      this.writeLayerQuad(
        layer,
        shadow.offsetX - padding,
        shadow.offsetY - padding,
        layer.destination.width + padding * 2,
        layer.destination.height + padding * 2,
        scene.width,
        scene.height,
        geometry.shadowPositions,
      );
    }
    geometry.signature = signature;
    geometry.sceneWidth = scene.width;
    geometry.sceneHeight = scene.height;
    return geometry;
  }

  private drawQuad(positions: Float32Array, texCoords: Float32Array): void {
    this.glVertexAttribPointer(this.positionLocation, 2, GL_FLOAT, 0, 0, positions);
    this.glVertexAttribPointer(this.texCoordLocation, 2, GL_FLOAT, 0, 0, texCoords);
    this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  }

  private setColorMatrix(matrix: readonly number[] | undefined): void {
    this.glUniform1f(this.hasColorMatrixLocation, matrix ? 1 : 0);
    if (!matrix) return;
    if (matrix.length !== 20) {
      throw new RangeError("GLES color matrix must contain 20 values");
    }
    this.glUniform4f(this.colorRow0Location, matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!);
    this.glUniform4f(this.colorRow1Location, matrix[5]!, matrix[6]!, matrix[7]!, matrix[8]!);
    this.glUniform4f(this.colorRow2Location, matrix[10]!, matrix[11]!, matrix[12]!, matrix[13]!);
    this.glUniform4f(this.colorRow3Location, matrix[15]!, matrix[16]!, matrix[17]!, matrix[18]!);
    this.glUniform4f(this.colorOffsetLocation, matrix[4]!, matrix[9]!, matrix[14]!, matrix[19]!);
  }

  private bindColorTarget(framebuffer: number, texture: number): void {
    this.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    this.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    const status = Number(this.glCheckFramebufferStatus(GL_FRAMEBUFFER));
    if (status !== GL_FRAMEBUFFER_COMPLETE) {
      throw new Error(`GLES effect framebuffer incomplete: 0x${status.toString(16)}`);
    }
  }

  private paintBackdropBlur(
    scene: EglCompositionScene,
    layer: EglCompositionLayer,
    layerIndex: number,
  ): void {
    const effect = layer.backdropBlur;
    if (!effect || effect.radius <= 0) return;

    // An untransformed material only needs the pixels beneath its bounds plus
    // the kernel reach. Transformed effects retain the conservative full-scene
    // path until transformed damage/bounds are represented by the graph.
    const padding = Math.ceil(effect.radius);
    const regional = !layer.transform;
    const sampleX = regional ? Math.max(0, Math.floor(layer.destination.x - padding)) : 0;
    const sampleY = regional ? Math.max(0, Math.floor(layer.destination.y - padding)) : 0;
    const sampleRight = regional
      ? Math.min(scene.width, Math.ceil(layer.destination.x + layer.destination.width + padding))
      : scene.width;
    const sampleBottom = regional
      ? Math.min(scene.height, Math.ceil(layer.destination.y + layer.destination.height + padding))
      : scene.height;
    const backdropWidth = Math.max(1, sampleRight - sampleX);
    const backdropHeight = Math.max(1, sampleBottom - sampleY);
    const downsample = 4;
    const blurWidth = Math.max(1, Math.ceil(backdropWidth / downsample));
    const blurHeight = Math.max(1, Math.ceil(backdropHeight / downsample));
    const dependencyKey = this.backdropDependencyKey(scene, layerIndex, {
      x: sampleX,
      y: sampleY,
      width: backdropWidth,
      height: backdropHeight,
    });
    const cached = this.backdropCacheForLayer(layer, blurWidth, blurHeight);

    if (cached.dependencyKey !== dependencyKey) {
      // Blur uses smaller intermediate framebuffers; scene-space scissor values
      // are invalid there. Restore the active damage clip on the scene target.
      this.glDisable(GL_SCISSOR_TEST);

      // Snapshot the already-composited stack. Sampling sceneTexture while it is
      // the active render target would be undefined feedback in GLES.
      this.glActiveTexture(GL_TEXTURE0);
      this.glBindTexture(GL_TEXTURE_2D, this.backdropTexture);
      if (backdropWidth !== this.backdropWidth || backdropHeight !== this.backdropHeight) {
        this.glTexImage2D(
          GL_TEXTURE_2D,
          0,
          GL_RGBA,
          backdropWidth,
          backdropHeight,
          0,
          GL_RGBA,
          GL_UNSIGNED_BYTE,
          null,
        );
        this.backdropWidth = backdropWidth;
        this.backdropHeight = backdropHeight;
      }
      this.glCopyTexSubImage2D(
        GL_TEXTURE_2D,
        0,
        0,
        0,
        sampleX,
        sampleY,
        backdropWidth,
        backdropHeight,
      );

      if (blurWidth !== this.blurWidth || blurHeight !== this.blurHeight) {
        for (const texture of [this.blurTextureA, this.blurTextureB]) {
          this.glBindTexture(GL_TEXTURE_2D, texture);
          this.glTexImage2D(
            GL_TEXTURE_2D,
            0,
            GL_RGBA,
            blurWidth,
            blurHeight,
            0,
            GL_RGBA,
            GL_UNSIGNED_BYTE,
            null,
          );
        }
        this.blurWidth = blurWidth;
        this.blurHeight = blurHeight;
      }

      const kernelReach = 3.230769;
      this.glDisable(GL_BLEND);
      this.glUniform1f(this.modeLocation, 2);
      this.glUniform1f(this.opacityLocation, 1);
      this.glUniform4f(this.uvRectLocation, 0, 0, 1, 1);

      this.bindColorTarget(this.blurFramebufferA, this.blurTextureA);
      this.glViewport(0, 0, blurWidth, blurHeight);
      this.glBindTexture(GL_TEXTURE_2D, this.backdropTexture);
      this.glUniform2f(
        this.blurDirectionLocation,
        Math.max(0.5, effect.radius) / kernelReach / backdropWidth,
        0,
      );
      this.drawQuad(FULL_QUAD_POSITIONS, UNIT_QUAD_TEX_COORDS);

      this.bindColorTarget(this.blurFramebufferB, this.blurTextureB);
      this.glBindTexture(GL_TEXTURE_2D, this.blurTextureA);
      this.glUniform2f(
        this.blurDirectionLocation,
        0,
        Math.max(0.5, effect.radius / downsample) / kernelReach / blurHeight,
      );
      this.drawQuad(FULL_QUAD_POSITIONS, UNIT_QUAD_TEX_COORDS);

      // Preserve the finished blur in a material-owned texture. The shared
      // intermediate pair is reused by every effect in the scene.
      this.glBindTexture(GL_TEXTURE_2D, cached.texture);
      this.glCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, blurWidth, blurHeight);
      cached.dependencyKey = dependencyKey;
    }

    this.bindColorTarget(this.sceneFramebuffer, this.sceneTexture);
    this.glViewport(0, 0, scene.width, scene.height);
    this.restoreSceneScissor();
    this.glEnable(GL_BLEND);
    this.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    this.glBindTexture(GL_TEXTURE_2D, cached.texture);
    this.glUniform1f(this.modeLocation, 3);
    this.glUniform1f(this.opacityLocation, layer.opacity ?? 1);
    this.glUniform1f(this.hasGeometryLocation, 0);
    this.glUniform1f(this.saturationLocation, effect.saturation ?? 1);
    this.setContentShape(layer);
    const tint = effect.tint ?? 0;
    this.glUniform4f(
      this.tintColorLocation,
      (tint & 0xff) / 255,
      ((tint >>> 8) & 0xff) / 255,
      ((tint >>> 16) & 0xff) / 255,
      ((tint >>> 24) & 0xff) / 255,
    );

    this.writeLayerQuad(
      layer,
      0,
      0,
      layer.destination.width,
      layer.destination.height,
      scene.width,
      scene.height,
      this.effectPositions,
    );
    const x0 = (layer.destination.x - sampleX) / backdropWidth;
    const y0 = (layer.destination.y - sampleY) / backdropHeight;
    const x1 = (layer.destination.x + layer.destination.width - sampleX) / backdropWidth;
    const y1 = (layer.destination.y + layer.destination.height - sampleY) / backdropHeight;
    this.glUniform4f(this.uvRectLocation, x0, y0, x1, y1);
    this.glUniform2f(this.layerSizeLocation, layer.destination.width, layer.destination.height);
    const radii =
      typeof layer.cornerRadius === "number"
        ? [layer.cornerRadius, layer.cornerRadius, layer.cornerRadius, layer.cornerRadius]
        : (layer.cornerRadius ?? [0, 0, 0, 0]);
    this.glUniform4f(this.cornerRadiiLocation, radii[0]!, radii[1]!, radii[2]!, radii[3]!);
    this.writeTexQuad(this.effectTexCoords, x0, y0, x1, y1);
    this.drawQuad(this.effectPositions, this.effectTexCoords);
  }

  private setContentShape(layer: EglCompositionLayer): void {
    const shape = layer.contentShape;
    this.glUniform1f(
      this.contentShapeModeLocation,
      shape ? (shape.outside === "discard" ? 1 : 2) : 0,
    );
    if (!shape) return;
    const { bounds, radii } = shape;
    this.glUniform4f(
      this.contentShapeBoundsLocation,
      bounds.x - layer.destination.x,
      bounds.y - layer.destination.y,
      bounds.width,
      bounds.height,
    );
    this.glUniform4f(this.contentShapeRadiiLocation, radii[0], radii[1], radii[2], radii[3]);
  }

  private compositionDamage(scene: EglCompositionScene): DamageRect | null {
    const full: DamageRect = { x: 0, y: 0, width: scene.width, height: scene.height };
    const nextOrder = scene.layers.map((layer) => layer.id);
    const orderChanged =
      nextOrder.length !== this.layerOrder.length ||
      nextOrder.some((id, index) => id !== this.layerOrder[index]);
    let damage: DamageRect | null =
      this.sceneWidth !== scene.width ||
      this.sceneHeight !== scene.height ||
      this.sceneClearColor !== scene.clearColor ||
      orderChanged
        ? full
        : null;
    const nextSnapshots = new Map<string, LayerSnapshot>();
    for (const layer of scene.layers) {
      const bounds = layerBounds(layer, scene.width, scene.height);
      const signature = layerSignature(layer);
      const previous = this.layerSnapshots.get(layer.id);
      nextSnapshots.set(layer.id, {
        pixels: layer.pixels,
        revision: layer.revision,
        signature,
        bounds,
      });
      if (
        !previous ||
        layer.revision == null ||
        previous.revision !== layer.revision ||
        previous.pixels !== layer.pixels ||
        previous.signature !== signature
      ) {
        const canUseSourceDamage =
          previous != null && previous.signature === signature && layer.damage != null;
        if (canUseSourceDamage) {
          for (const sourceDamage of layer.damage!) {
            const mapped = layerDamageBounds(layer, sourceDamage, scene.width, scene.height);
            if (mapped) damage = rectUnion(damage, mapped);
          }
        } else {
          if (previous) damage = rectUnion(damage, previous.bounds);
          damage = rectUnion(damage, bounds);
        }
      }
    }
    for (const [id, previous] of this.layerSnapshots) {
      if (!nextSnapshots.has(id)) damage = rectUnion(damage, previous.bounds);
    }

    // A changed backdrop sample invalidates the material drawn over it. Grow
    // damage until all dependent blur destinations are included.
    if (damage) {
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const layer of scene.layers) {
          const effect = layer.backdropBlur;
          if (!effect) continue;
          const sample = clampRect(
            {
              x: layer.destination.x - effect.radius,
              y: layer.destination.y - effect.radius,
              width: layer.destination.width + effect.radius * 2,
              height: layer.destination.height + effect.radius * 2,
            },
            scene.width,
            scene.height,
          );
          if (!rectsIntersect(damage, sample)) continue;
          // Rebuild the entire sampled stack, including kernel padding. Pixels
          // outside the old damage clip still contain last frame's final stack
          // (menus/chrome above this material), not its source backdrop.
          const grown = rectUnion(damage, sample);
          if (
            grown.x !== damage.x ||
            grown.y !== damage.y ||
            grown.width !== damage.width ||
            grown.height !== damage.height
          ) {
            damage = grown;
            expanded = true;
          }
        }
      }
    }

    this.layerSnapshots = nextSnapshots;
    this.layerOrder = nextOrder;
    this.sceneClearColor = scene.clearColor;
    if (!damage) return null;
    const clipped = clampRect(damage, scene.width, scene.height);
    return clipped.width > 0 && clipped.height > 0 ? clipped : null;
  }

  private restoreSceneScissor(clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    let bounds = this.activeDamage;
    if (bounds && clip) {
      const left = Math.max(bounds.x, clip.x);
      const top = Math.max(bounds.y, clip.y);
      const right = Math.min(bounds.x + bounds.width, clip.x + clip.width);
      const bottom = Math.min(bounds.y + bounds.height, clip.y + clip.height);
      bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
      };
    } else if (clip) {
      bounds = clip;
    }
    if (!bounds) {
      this.glDisable(GL_SCISSOR_TEST);
      return;
    }
    this.glEnable(GL_SCISSOR_TEST);
    // An empty intersection clips everything. Disabling scissoring here lets
    // retained text outside the cleared damage region accumulate each frame.
    this.glScissor(bounds.x, bounds.y, Math.max(0, bounds.width), Math.max(0, bounds.height));
  }

  /** Compose retained, revisioned layers into one logical GPU scene. */
  beginComposition(scene: EglCompositionScene): DamageRect | null {
    this.bindContext();
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    if (scene.width < 1 || scene.height < 1) {
      throw new RangeError("EGL composition scene has invalid dimensions");
    }
    for (const layer of scene.layers) {
      if (layer.pixels instanceof EglResidentImage) {
        this.residentResource(layer.pixels);
        if (layer.sourceWidth !== layer.pixels.width || layer.sourceHeight !== layer.pixels.height)
          throw new RangeError("Resident layer dimensions differ from its image");
      }
    }
    this.compositionFrame++;
    const damage = this.compositionDamage(scene);
    this.activeDamage = damage;
    this.glBindTexture(GL_TEXTURE_2D, this.sceneTexture);
    if (scene.width !== this.sceneWidth || scene.height !== this.sceneHeight) {
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        scene.width,
        scene.height,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        null,
      );
      this.sceneWidth = scene.width;
      this.sceneHeight = scene.height;
    }
    this.sourceWidth = scene.width;
    this.sourceHeight = scene.height;
    this.glBindFramebuffer(GL_FRAMEBUFFER, this.sceneFramebuffer);
    this.glFramebufferTexture2D(
      GL_FRAMEBUFFER,
      GL_COLOR_ATTACHMENT0,
      GL_TEXTURE_2D,
      this.sceneTexture,
      0,
    );
    const status = Number(this.glCheckFramebufferStatus(GL_FRAMEBUFFER));
    if (status !== GL_FRAMEBUFFER_COMPLETE) {
      throw new Error(`GLES scene framebuffer incomplete: 0x${status.toString(16)}`);
    }
    if (!damage) {
      this.outputSourceTexture = this.sceneTexture;
      return null;
    }
    this.glViewport(0, 0, scene.width, scene.height);
    this.restoreSceneScissor();
    const color = scene.clearColor >>> 0;
    this.glClearColor(
      (color & 0xff) / 255,
      ((color >>> 8) & 0xff) / 255,
      ((color >>> 16) & 0xff) / 255,
      ((color >>> 24) & 0xff) / 255,
    );
    this.glClear(GL_COLOR_BUFFER_BIT);
    this.glUseProgram(this.program);
    this.glUniform1f(this.outputSwizzleLocation, 0);
    this.glEnable(GL_BLEND);
    this.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    this.glActiveTexture(GL_TEXTURE0);
    this.glUniform1i(this.samplerLocation, 0);

    for (let layerIndex = 0; layerIndex < scene.layers.length; layerIndex++) {
      const layer = scene.layers[layerIndex]!;
      if (!rectsIntersect(layerBounds(layer, scene.width, scene.height), damage)) {
        continue;
      }
      const cachedGeometry = this.geometryForLayer(scene, layer);
      this.paintBackdropBlur(scene, layer, layerIndex);
      this.restoreSceneScissor(layer.clip);
      const shadow = layer.dropShadow;
      if (shadow) {
        const spread = shadow.spread ?? 0;
        const padding = Math.max(1, shadow.blurRadius + Math.max(0, spread));
        const shadowWidth = layer.destination.width + padding * 2;
        const shadowHeight = layer.destination.height + padding * 2;
        const halfWidth = (layer.destination.width + spread * 2) / 2;
        const halfHeight = (layer.destination.height + spread * 2) / 2;
        const radiusValue =
          typeof layer.cornerRadius === "number"
            ? layer.cornerRadius
            : Math.max(...(layer.cornerRadius ?? [0]));
        const shadowColor = shadow.color >>> 0;
        this.glUniform1f(this.modeLocation, 1);
        this.glUniform4f(this.uvRectLocation, 0, 0, 1, 1);
        this.glUniform2f(this.layerSizeLocation, shadowWidth, shadowHeight);
        this.glUniform4f(
          this.shadowRectLocation,
          shadow.blurRadius + halfWidth,
          shadow.blurRadius + halfHeight,
          halfWidth,
          halfHeight,
        );
        this.glUniform1f(this.shadowRadiusLocation, Math.max(0, radiusValue + spread));
        this.glUniform1f(this.shadowSoftnessLocation, Math.max(0.5, shadow.blurRadius * 0.5));
        this.glUniform4f(
          this.shadowColorLocation,
          (shadowColor & 0xff) / 255,
          ((shadowColor >>> 8) & 0xff) / 255,
          ((shadowColor >>> 16) & 0xff) / 255,
          (((shadowColor >>> 24) & 0xff) / 255) * (layer.opacity ?? 1),
        );
        this.drawQuad(cachedGeometry.shadowPositions, UNIT_QUAD_TEX_COORDS);
      }
      const texture = this.textureForLayer(layer);
      this.glBindTexture(GL_TEXTURE_2D, texture);
      this.glUniform1f(this.modeLocation, 0);
      this.glUniform1f(this.opacityLocation, layer.opacity ?? 1);
      this.setColorMatrix(layer.colorMatrix);
      this.setContentShape(layer);
      const geometry = layer.surfaceGeometry;
      this.glUniform1f(this.hasGeometryLocation, geometry ? 1 : 0);
      if (geometry) {
        this.glUniform4f(
          this.geometryLocation,
          geometry.x / layer.sourceWidth,
          geometry.y / layer.sourceHeight,
          (geometry.x + geometry.width) / layer.sourceWidth,
          (geometry.y + geometry.height) / layer.sourceHeight,
        );
      }
      const u0 = cachedGeometry.texCoords[0]!;
      const v0 = cachedGeometry.texCoords[1]!;
      const u1 = cachedGeometry.texCoords[2]!;
      const v1 = cachedGeometry.texCoords[5]!;
      this.glUniform4f(this.uvRectLocation, u0, v0, u1, v1);
      this.glUniform2f(this.layerSizeLocation, layer.destination.width, layer.destination.height);
      const radii =
        typeof layer.cornerRadius === "number"
          ? [layer.cornerRadius, layer.cornerRadius, layer.cornerRadius, layer.cornerRadius]
          : (layer.cornerRadius ?? [0, 0, 0, 0]);
      this.glUniform4f(this.cornerRadiiLocation, radii[0]!, radii[1]!, radii[2]!, radii[3]!);
      this.drawQuad(cachedGeometry.positions, cachedGeometry.texCoords);
    }
    this.glDisable(GL_BLEND);
    this.glDisable(GL_SCISSOR_TEST);
    this.activeDamage = null;
    this.outputSourceTexture = this.sceneTexture;

    if (this.compositionFrame % 120 === 0) {
      for (const [id, cached] of this.layerTextures) {
        if (this.compositionFrame - cached.lastSeenFrame < 120) continue;
        this.glDeleteTextures(1, new Uint32Array([cached.texture]));
        this.layerTextures.delete(id);
      }
      for (const [id, cached] of this.backdropCaches) {
        if (this.compositionFrame - cached.lastSeenFrame < 120) continue;
        this.glDeleteTextures(1, new Uint32Array([cached.texture]));
        this.backdropCaches.delete(id);
      }
      for (const [id, geometry] of this.layerGeometry) {
        if (this.compositionFrame - geometry.lastSeenFrame < 120) continue;
        this.layerGeometry.delete(id);
      }
    }
    return damage;
  }

  private validateOutputBounds(output: EglDirectOutput): void {
    if (
      output.x < 0 ||
      output.y < 0 ||
      output.x + output.width > this.sourceWidth ||
      output.y + output.height > this.sourceHeight
    ) {
      throw new RangeError(`Output ${output.id} lies outside the EGL scene`);
    }
  }

  private paintOutput(
    output: EglDirectOutput,
    texture: number,
    framebuffer: number,
    directScanout = false,
  ): void {
    this.validateOutputBounds(output);
    this.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    this.glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
    const status = Number(this.glCheckFramebufferStatus(GL_FRAMEBUFFER));
    if (status !== GL_FRAMEBUFFER_COMPLETE) {
      throw new Error(`GLES framebuffer incomplete: 0x${status.toString(16)}`);
    }
    this.glViewport(0, 0, output.targetWidth, output.targetHeight);
    this.glClearColor(0, 0, 0, 1);
    this.glClear(GL_COLOR_BUFFER_BIT);
    this.glUseProgram(this.program);
    this.glActiveTexture(GL_TEXTURE0);
    this.glBindTexture(GL_TEXTURE_2D, this.outputSourceTexture);
    this.glUniform1i(this.samplerLocation, 0);
    this.glUniform1f(this.opacityLocation, 1);
    this.glUniform1f(this.modeLocation, 0);
    this.glUniform1f(this.hasGeometryLocation, 0);
    this.setColorMatrix(outputColorMatrix(output.colorScale) ?? undefined);
    this.glUniform1f(this.outputSwizzleLocation, directScanout ? 1 : 0);
    this.glUniform1f(this.contentShapeModeLocation, 0);
    this.glDisable(GL_BLEND);

    const u0 = output.x / this.sourceWidth;
    const v0 = output.y / this.sourceHeight;
    const u1 = (output.x + output.width) / this.sourceWidth;
    const v1 = (output.y + output.height) / this.sourceHeight;
    this.glUniform4f(this.uvRectLocation, u0, v0, u1, v1);
    this.glUniform2f(this.layerSizeLocation, output.targetWidth, output.targetHeight);
    this.glUniform4f(this.cornerRadiiLocation, 0, 0, 0, 0);
    this.writeTexQuad(this.outputTexCoords, u0, v0, u1, v1);
    this.drawQuad(FULL_QUAD_POSITIONS, this.outputTexCoords);
  }

  private createDirectTarget(output: EglDirectOutput): DirectOutputTarget {
    if (!this.info.eglExtensions.includes("EGL_EXT_image_dma_buf_import")) {
      throw new Error("EGL_EXT_image_dma_buf_import is unavailable");
    }

    let bo: unknown = null;
    let image: unknown = null;
    let texture = 0;
    let framebuffer = 0;
    let framebufferId = 0;
    let primeFd = -1;
    try {
      bo = this.gbmBoCreate(
        this.gbmDevice,
        output.targetWidth,
        output.targetHeight,
        DRM_FORMAT_XRGB8888,
        GBM_BO_USE_SCANOUT | GBM_BO_USE_RENDERING | GBM_BO_USE_LINEAR,
      );
      if (pointerAddress(bo) === 0n) {
        throw new Error("gbm_bo_create scanout target failed");
      }
      const stride = Number(this.gbmBoGetStride(bo));
      primeFd = Number(this.gbmBoGetFd(bo));
      if (stride < output.targetWidth * 4 || primeFd < 0) {
        throw new Error("GBM scanout target has invalid stride or dma-buf fd");
      }

      const imageAttributes = new Int32Array([
        EGL_WIDTH,
        output.targetWidth,
        EGL_HEIGHT,
        output.targetHeight,
        EGL_LINUX_DRM_FOURCC_EXT,
        DRM_FORMAT_XRGB8888,
        EGL_DMA_BUF_PLANE0_FD_EXT,
        primeFd,
        EGL_DMA_BUF_PLANE0_OFFSET_EXT,
        0,
        EGL_DMA_BUF_PLANE0_PITCH_EXT,
        stride,
        EGL_NONE,
      ]);
      image = this.eglCreateImage(this.display, null, EGL_LINUX_DMA_BUF_EXT, null, imageAttributes);
      if (pointerAddress(image) === 0n) {
        throw new Error("eglCreateImageKHR dma-buf import failed");
      }
      this.noteTransfer("dmabufImport", stride * output.targetHeight);

      const glGenTextures = this.gl.func(
        "void glGenTextures(int n, _Out_ unsigned int *textures)",
      ) as NativeFunction;
      const glGenFramebuffers = this.gl.func(
        "void glGenFramebuffers(int n, _Out_ unsigned int *framebuffers)",
      ) as NativeFunction;
      texture = uintOut((out) => void glGenTextures(1, out));
      framebuffer = uintOut((out) => void glGenFramebuffers(1, out));
      this.configureTexture(texture);
      this.glBindTexture(GL_TEXTURE_2D, texture);
      this.glEglImageTargetTexture(GL_TEXTURE_2D, image);
      this.bindColorTarget(framebuffer, texture);

      const handleOut = koffi.alloc("uint32_t", 1);
      const framebufferOut = koffi.alloc("uint32_t", 1);
      try {
        const primeResult = Number(this.drmPrimeFdToHandle(this.drmFd, primeFd, handleOut));
        if (primeResult !== 0) {
          throw new Error(`drmPrimeFDToHandle failed (${primeResult})`);
        }
        const handle = koffi.decode(handleOut, "uint32_t") as number;
        let addResult = Number(
          this.drmModeAddFb2(
            this.drmFd,
            output.targetWidth,
            output.targetHeight,
            DRM_FORMAT_XRGB8888,
            new Uint32Array([handle, 0, 0, 0]),
            new Uint32Array([stride, 0, 0, 0]),
            new Uint32Array([0, 0, 0, 0]),
            framebufferOut,
            0,
          ),
        );
        if (addResult !== 0) {
          // Some virtual KMS drivers reject AddFB2 for otherwise valid linear
          // XRGB BOs but accept the legacy depth/bpp registration path.
          addResult = Number(
            this.drmModeAddFb(
              this.drmFd,
              output.targetWidth,
              output.targetHeight,
              24,
              32,
              stride,
              handle,
              framebufferOut,
            ),
          );
        }
        if (addResult !== 0) {
          const format = Number(this.gbmBoGetFormat(bo));
          const modifier = BigInt(this.gbmBoGetModifier(bo) as bigint | number);
          const planes = Number(this.gbmBoGetPlaneCount(bo));
          throw new Error(
            `DRM framebuffer registration failed (${addResult}) handle=${handle} stride=${stride} format=0x${format.toString(16)} modifier=0x${modifier.toString(16)} planes=${planes}`,
          );
        }
        framebufferId = koffi.decode(framebufferOut, "uint32_t") as number;
      } finally {
        koffi.free(handleOut);
        koffi.free(framebufferOut);
      }

      const target: DirectOutputTarget = {
        bo,
        image,
        texture,
        framebuffer,
        framebufferId,
        stride,
        width: output.targetWidth,
        height: output.targetHeight,
      };
      return target;
    } catch (error) {
      if (framebufferId) this.drmModeRmFb(this.drmFd, framebufferId);
      if (framebuffer) {
        this.glDeleteFramebuffers(1, new Uint32Array([framebuffer]));
      }
      if (texture) this.glDeleteTextures(1, new Uint32Array([texture]));
      if (pointerAddress(image) !== 0n) {
        this.eglDestroyImage(this.display, image);
      }
      if (pointerAddress(bo) !== 0n) this.gbmBoDestroy(bo);
      throw error;
    } finally {
      if (primeFd >= 0) closeFd(primeFd);
    }
  }

  private directTargetFor(output: EglDirectOutput, advance: boolean): DirectOutputTarget {
    const key = `${output.id}:${output.targetWidth}x${output.targetHeight}`;
    let pool = this.directTargets.get(key);
    if (!pool) {
      // A KMS mode switch first scans out its new durable dumb framebuffer,
      // so targets for the same connector's old dimensions are no longer in
      // use and can be reclaimed before allocating the replacement pair.
      const outputPrefix = `${output.id}:`;
      for (const [staleKey, stale] of this.directTargets) {
        if (staleKey === key || !staleKey.startsWith(outputPrefix)) continue;
        if (
          !stale.targets.every((target) =>
            canRetireKmsFramebuffer(this.drmFd, target.framebufferId),
          )
        )
          continue;
        for (const target of stale.targets) this.destroyDirectTarget(target);
        this.directTargets.delete(staleKey);
      }
      const first = this.createDirectTarget(output);
      let second: DirectOutputTarget | null = null;
      try {
        second = this.createDirectTarget(output);
      } catch (error) {
        this.destroyDirectTarget(first);
        throw error;
      }
      pool = {
        key,
        targets: [first, second],
        nextIndex: 0,
        lastRendered: null,
      };
      this.directTargets.set(key, pool);
    }
    if (!advance) return pool.lastRendered ?? pool.targets[0];
    const target = [
      pool.targets[pool.nextIndex]!,
      pool.targets[(pool.nextIndex + 1) % pool.targets.length]!,
    ].find((candidate) => isKmsFramebufferWritable(this.drmFd, candidate.framebufferId, output.id));
    if (!target) throw new Error(`No idle GBM scanout target for ${output.id}`);
    pool.nextIndex = target === pool.targets[0] ? 1 : 0;
    pool.lastRendered = target;
    return target;
  }

  private destroyDirectTarget(target: DirectOutputTarget): void {
    // Failed shutdown/modeset leaves native ownership unresolved. Retain the BO
    // rather than unregistering storage that may still be scanned out.
    if (!canRetireKmsFramebuffer(this.drmFd, target.framebufferId)) return;
    try {
      this.drmModeRmFb(this.drmFd, target.framebufferId);
    } catch {
      // best effort
    }
    this.glDeleteFramebuffers(1, new Uint32Array([target.framebuffer]));
    this.glDeleteTextures(1, new Uint32Array([target.texture]));
    this.eglDestroyImage(this.display, target.image);
    this.gbmBoDestroy(target.bo);
  }

  private createClientTarget(
    channel: string,
    width: number,
    height: number,
    formatRequested = DRM_FORMAT_ARGB8888,
  ): ClientTarget {
    if (!this.info.eglExtensions.includes("EGL_EXT_image_dma_buf_import")) {
      throw new Error("EGL_EXT_image_dma_buf_import is unavailable");
    }

    let bo: unknown = null;
    let image: unknown = null;
    let texture = 0;
    let framebuffer = 0;
    let fd = -1;
    try {
      // Linear is intentionally requested for the first client transport
      // tranche: it is accepted by the compositor's advertised dmabuf
      // feedback and leaves the CPU snapshot fallback viable.
      bo = this.gbmBoCreate(
        this.gbmDevice,
        width,
        height,
        formatRequested,
        GBM_BO_USE_RENDERING | GBM_BO_USE_LINEAR,
      );
      if (pointerAddress(bo) === 0n) {
        throw new Error("gbm_bo_create client target failed");
      }
      const stride = Number(this.gbmBoGetStride(bo));
      const format = Number(this.gbmBoGetFormat(bo));
      const modifier = BigInt(this.gbmBoGetModifier(bo) as bigint | number);
      fd = Number(this.gbmBoGetFd(bo));
      if (stride < width * 4 || fd < 0 || format !== formatRequested) {
        throw new Error("GBM client target has invalid stride, format or dma-buf fd");
      }

      const imageAttributes = new Int32Array([
        EGL_WIDTH,
        width,
        EGL_HEIGHT,
        height,
        EGL_LINUX_DRM_FOURCC_EXT,
        format,
        EGL_DMA_BUF_PLANE0_FD_EXT,
        fd,
        EGL_DMA_BUF_PLANE0_OFFSET_EXT,
        0,
        EGL_DMA_BUF_PLANE0_PITCH_EXT,
        stride,
        EGL_NONE,
      ]);
      image = this.eglCreateImage(this.display, null, EGL_LINUX_DMA_BUF_EXT, null, imageAttributes);
      if (pointerAddress(image) === 0n) {
        throw new Error("eglCreateImageKHR client dma-buf failed");
      }
      this.noteTransfer("dmabufImport", stride * height);

      const glGenTextures = this.gl.func(
        "void glGenTextures(int n, _Out_ unsigned int *textures)",
      ) as NativeFunction;
      const glGenFramebuffers = this.gl.func(
        "void glGenFramebuffers(int n, _Out_ unsigned int *framebuffers)",
      ) as NativeFunction;
      texture = uintOut((out) => void glGenTextures(1, out));
      framebuffer = uintOut((out) => void glGenFramebuffers(1, out));
      this.configureTexture(texture);
      this.glBindTexture(GL_TEXTURE_2D, texture);
      this.glEglImageTargetTexture(GL_TEXTURE_2D, image);
      this.bindColorTarget(framebuffer, texture);

      return {
        id: `${channel}:${this.nextClientTargetId++}`,
        fd,
        width,
        height,
        stride,
        format,
        modifier,
        damage: [],
        bo,
        image,
        texture,
        framebuffer,
        busy: false,
      };
    } catch (error) {
      if (framebuffer) {
        this.glDeleteFramebuffers(1, new Uint32Array([framebuffer]));
      }
      if (texture) this.glDeleteTextures(1, new Uint32Array([texture]));
      if (pointerAddress(image) !== 0n) {
        this.eglDestroyImage(this.display, image);
      }
      if (fd >= 0) closeFd(fd);
      if (pointerAddress(bo) !== 0n) this.gbmBoDestroy(bo);
      throw error;
    }
  }

  private destroyClientTarget(target: ClientTarget): void {
    this.glDeleteFramebuffers(1, new Uint32Array([target.framebuffer]));
    this.glDeleteTextures(1, new Uint32Array([target.texture]));
    this.eglDestroyImage(this.display, target.image);
    closeFd(target.fd);
    this.gbmBoDestroy(target.bo);
  }

  private collectClientPool(pool: ClientTargetPool): void {
    if (!pool.retired || pool.targets.some((target) => target.busy)) return;
    for (const target of pool.targets) this.destroyClientTarget(target);
    this.clientTargets.delete(pool.key);
  }

  /** Retired geometry/format pools still count while a compositor owns their buffers. */
  private canAllocateClientTarget(channel: string): boolean {
    let count = 0;
    for (const pool of this.clientTargets.values())
      if (pool.channel === channel) count += pool.targets.length;
    return count < 3;
  }

  hasClientFrame(id: string): boolean {
    return (
      !this.destroyed &&
      [...this.clientTargets.values()].some((pool) =>
        pool.targets.some((target) => target.id === id),
      )
    );
  }

  /**
   * Upload a software scene once, then present it from a renderer-owned GBM
   * BO. This is the transport bridge for native Wayland clients; a future
   * retained-scene EGL renderer can paint into the same targets directly.
   *
   * Returns null when all three targets are still held by the compositor so
   * callers can fall back to wl_shm without stalling the UI thread.
   */
  renderClientFrame(
    channel: string,
    pixels: Uint8Array,
    width: number,
    height: number,
  ): EglClientPresent | null {
    this.bindContext();
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    const key = `${channel}:${width}x${height}`;
    const previousKey = this.currentClientPool.get(channel);
    if (previousKey && previousKey !== key) {
      const previous = this.clientTargets.get(previousKey);
      if (previous) {
        previous.retired = true;
        this.collectClientPool(previous);
      }
    }
    this.currentClientPool.set(channel, key);

    let pool = this.clientTargets.get(key);
    if (!pool) {
      pool = { channel, key, retired: false, targets: [] };
      this.clientTargets.set(key, pool);
    }
    // Returning to a held prior geometry/format makes this pool current again.
    pool.retired = false;
    let target = pool.targets.find((candidate) => !candidate.busy);
    if (!target && pool.targets.length < 3 && this.canAllocateClientTarget(channel)) {
      target = this.createClientTarget(channel, width, height);
      pool.targets.push(target);
    }
    if (!target) return null;

    this.beginFrame(pixels, width, height);
    this.paintOutput(
      {
        id: channel,
        x: 0,
        y: 0,
        width,
        height,
        targetWidth: width,
        targetHeight: height,
      },
      target.texture,
      target.framebuffer,
      false,
    );
    this.finishGpuWork();
    this.noteTransfer("gpuCopy", width * height * 4);
    target.busy = true;
    return {
      id: target.id,
      fd: target.fd,
      width: target.width,
      height: target.height,
      stride: target.stride,
      format: target.format,
      modifier: target.modifier,
      damage: [{ x: 0, y: 0, width, height }],
    };
  }

  /** Paint a renderer-neutral retained client scene directly into a dma-buf. */
  renderClientComposition(channel: string, scene: EglCompositionScene): EglClientPresent | null {
    this.bindContext();
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    const { width, height } = scene;
    const format = hasOpaqueEglScene(scene) ? DRM_FORMAT_XRGB8888 : DRM_FORMAT_ARGB8888;
    const key = `${channel}:${width}x${height}:${format}`;
    const previousKey = this.currentClientPool.get(channel);
    if (previousKey && previousKey !== key) {
      const previous = this.clientTargets.get(previousKey);
      if (previous) {
        previous.retired = true;
        this.collectClientPool(previous);
      }
    }
    this.currentClientPool.set(channel, key);

    let pool = this.clientTargets.get(key);
    if (!pool) {
      pool = { channel, key, retired: false, targets: [] };
      this.clientTargets.set(key, pool);
    }
    // Returning to a held prior geometry/format makes this pool current again.
    pool.retired = false;
    let target = pool.targets.find((candidate) => !candidate.busy);
    if (!target && pool.targets.length < 3 && this.canAllocateClientTarget(channel)) {
      target = this.createClientTarget(channel, width, height, format);
      pool.targets.push(target);
    }
    if (!target) return null;

    const damage = this.beginComposition(scene);
    this.paintOutput(
      {
        id: channel,
        x: 0,
        y: 0,
        width,
        height,
        targetWidth: width,
        targetHeight: height,
      },
      target.texture,
      target.framebuffer,
      // Retained composition first paints through an ordinary RGBA scene
      // texture. Swizzle that intermediate result into the ARGB8888 GBM BO;
      // the one-pass software upload does not need this extra conversion.
      true,
    );
    this.finishGpuWork();
    this.noteTransfer("gpuCopy", width * height * 4);
    target.busy = true;
    return {
      id: target.id,
      fd: target.fd,
      width: target.width,
      height: target.height,
      stride: target.stride,
      format: target.format,
      modifier: target.modifier,
      damage: scene.damage ?? (damage ? [damage] : []),
    };
  }

  /** Mark a client target reusable after wl_buffer.release. */
  releaseClientFrame(id: string): void {
    this.bindContext();
    for (const pool of this.clientTargets.values()) {
      const target = pool.targets.find((candidate) => candidate.id === id);
      if (!target) continue;
      target.busy = false;
      this.collectClientPool(pool);
      return;
    }
  }

  /** Keep retained EGL rendering when a driver cannot allocate exportable BOs. */
  renderClientCompositionReadback(scene: EglCompositionScene): {
    pixels: Uint8Array;
    width: number;
    height: number;
  } {
    this.bindContext();
    this.beginComposition(scene);
    const bytes = scene.width * scene.height * 4;
    if (this.clientReadback?.byteLength !== bytes) {
      this.clientReadback = new Uint8Array(bytes);
    }
    this.renderOutput({
      id: "client-readback",
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
      targetWidth: scene.width,
      targetHeight: scene.height,
      targetPitch: scene.width * 4,
      target: this.clientReadback,
    });
    return { pixels: this.clientReadback, width: scene.width, height: scene.height };
  }

  /** Retire every target belonging to a destroyed Wayland surface. */
  dropClientChannel(channel: string): void {
    this.bindContext();
    this.currentClientPool.delete(channel);
    for (const pool of this.clientTargets.values()) {
      if (pool.channel !== channel) continue;
      // The wl_buffer objects are destroyed before this call. Moire snapshots
      // buffers during commit, so no server-side GPU access remains here.
      for (const target of pool.targets) target.busy = false;
      pool.retired = true;
      this.collectClientPool(pool);
    }
  }

  /**
   * Several scalers may share a process (a compositor and its in-process greeter client), and GL
   * calls go to whichever context is current: every entry point binds this scaler's own.
   */
  private bindContext(): void {
    if (this.destroyed || currentEglContext === this.context) return;
    if (!Number(this.eglMakeCurrent(this.display, null, null, this.context)))
      throw new Error("eglMakeCurrent failed for this EGL output scaler");
    currentEglContext = this.context;
  }

  /** WebGL2-shaped binding over this context for GPU scene producers; requires GLES 3. */
  producerGl(): Gles3 {
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    if (this.clientVersion !== 3) throw new Error("GPU scene producers require a GLES 3 context");
    return (this.producerBinding ??= createGles3(this.gl));
  }

  /** An RGBA target a producer renders into, composed like any resident layer. */
  createProducerTarget(width: number, height: number): EglProducerTarget {
    this.bindContext();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new RangeError("Invalid producer target size");
    const gl = this.producerGl();
    const restore = this.preserveSnapshotState();
    try {
      const resource = { texture: gl.createTexture(), framebuffer: gl.createFramebuffer() };
      this.configureTexture(resource.texture);
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        width,
        height,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        null,
      );
      try {
        this.bindColorTarget(resource.framebuffer, resource.texture);
      } catch (error) {
        gl.deleteFramebuffer(resource.framebuffer);
        gl.deleteTexture(resource.texture);
        throw error;
      }
      const image: EglResidentImage = new EglResidentImage(
        this,
        width,
        height,
        () => {
          this.bindContext();
          const live = this.residentResource(image);
          const restoreReadback = this.preserveSnapshotState();
          try {
            const pixels = new Uint8Array(width * height * 4);
            this.glBindFramebuffer(GL_FRAMEBUFFER, live.framebuffer);
            this.glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
            this.noteTransfer("gpuReadback", pixels.byteLength);
            return pixels;
          } finally {
            restoreReadback();
          }
        },
        () => {
          if (!this.residentImages.delete(image)) return;
          this.bindContext();
          this.glDeleteFramebuffers(1, new Uint32Array([resource.framebuffer]));
          this.glDeleteTextures(1, new Uint32Array([resource.texture]));
        },
      );
      this.residentImages.set(image, resource);
      return { image, framebuffer: resource.framebuffer };
    } finally {
      restore();
    }
  }

  /**
   * Run a producer's GL work against this context, then restore the state composition relies on
   * (client-side vertex arrays need VAO 0 and no bound array buffer).
   */
  produce<T>(draw: (gl: Gles3) => T): T {
    this.bindContext();
    const gl = this.producerGl();
    const restore = this.preserveSnapshotState();
    try {
      return draw(gl);
    } finally {
      gl.bindVertexArray(0);
      gl.bindBuffer(0x8892 /* GL_ARRAY_BUFFER */, 0);
      for (let unit = 7; unit >= 1; unit--) {
        gl.activeTexture(GL_TEXTURE0 + unit);
        gl.bindTexture(GL_TEXTURE_2D, 0);
      }
      this.glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
      restore();
    }
  }

  /** Render into a DRM-registered GBM BO without CPU readback. */
  renderOutputDirect(output: EglDirectOutput): EglDirectPresent {
    this.bindContext();
    const target = this.directTargetFor(output, true);
    this.paintOutput(output, target.texture, target.framebuffer, true);
    // Software GBM renderers do not attach a kernel fence to their CPU work.
    // Finish before publishing pixels to KMS (or a client buffer above).
    // Page-flip completion still controls reuse of the two scanout targets.
    this.finishGpuWork();
    return {
      framebufferId: target.framebufferId,
      stride: target.stride,
      width: target.width,
      height: target.height,
    };
  }

  /** Diagnostic readback for direct-target conformance; not used to present. */
  readDirectOutput(output: EglDirectOutput, pixels: Uint8Array): void {
    this.bindContext();
    const target = this.directTargetFor(output, false);
    const required = target.width * target.height * 4;
    if (pixels.byteLength < required) {
      throw new RangeError("Direct output diagnostic buffer is too small");
    }
    this.glBindFramebuffer(GL_FRAMEBUFFER, target.framebuffer);
    this.glReadPixels(0, 0, target.width, target.height, GL_RGBA, GL_UNSIGNED_BYTE, pixels);
    this.noteTransfer("gpuReadback", target.width * target.height * 4);
  }

  renderOutput(output: EglScaleOutput): void {
    this.bindContext();
    this.validateOutputBounds(output);
    if (
      output.targetPitch < output.targetWidth * 4 ||
      output.target.byteLength < output.targetPitch * output.targetHeight
    ) {
      throw new RangeError(`Target for ${output.id} is too small`);
    }

    this.glBindTexture(GL_TEXTURE_2D, this.targetTexture);
    if (output.targetWidth !== this.targetWidth || output.targetHeight !== this.targetHeight) {
      this.glTexImage2D(
        GL_TEXTURE_2D,
        0,
        GL_RGBA,
        output.targetWidth,
        output.targetHeight,
        0,
        GL_RGBA,
        GL_UNSIGNED_BYTE,
        null,
      );
      this.targetWidth = output.targetWidth;
      this.targetHeight = output.targetHeight;
    }
    this.paintOutput(output, this.targetTexture, this.framebuffer, false);

    const tightBytes = output.targetWidth * output.targetHeight * 4;
    const tight =
      output.targetPitch === output.targetWidth * 4
        ? output.target
        : this.readback?.byteLength === tightBytes
          ? this.readback
          : (this.readback = new Uint8Array(tightBytes));
    this.glReadPixels(
      0,
      0,
      output.targetWidth,
      output.targetHeight,
      GL_RGBA,
      GL_UNSIGNED_BYTE,
      tight,
    );
    this.noteTransfer("gpuReadback", tightBytes);
    if (tight !== output.target) {
      this.noteTransfer("cpuCopy", tightBytes);
      const rowBytes = output.targetWidth * 4;
      for (let row = 0; row < output.targetHeight; row++) {
        output.target.set(
          tight.subarray(row * rowBytes, (row + 1) * rowBytes),
          row * output.targetPitch,
        );
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.eglMakeCurrent(this.display, null, null, this.context);
      currentEglContext = this.context;
      for (const pool of this.directTargets.values()) {
        for (const target of pool.targets) this.destroyDirectTarget(target);
      }
      this.directTargets.clear();
      for (const pool of this.clientTargets.values()) {
        for (const target of pool.targets) this.destroyClientTarget(target);
      }
      this.clientTargets.clear();
      this.currentClientPool.clear();
      for (const image of this.residentImages.keys()) image.destroy();
      if (this.snapshotProgram) this.glDeleteProgram(this.snapshotProgram.program);
      this.snapshotProgram = null;
      const textures = [
        this.sourceTexture,
        this.targetTexture,
        this.sceneTexture,
        this.backdropTexture,
        this.blurTextureA,
        this.blurTextureB,
        ...[...this.layerTextures.values()].map((entry) => entry.texture),
        ...[...this.backdropCaches.values()].map((entry) => entry.texture),
      ];
      this.glDeleteTextures(textures.length, Uint32Array.from(textures));
      const framebuffers = [
        this.framebuffer,
        this.sceneFramebuffer,
        this.blurFramebufferA,
        this.blurFramebufferB,
      ];
      this.glDeleteFramebuffers(framebuffers.length, Uint32Array.from(framebuffers));
      this.layerTextures.clear();
      this.layerGeometry.clear();
      this.backdropCaches.clear();
      this.glDeleteProgram(this.program);
    } catch {
      // best effort during compositor shutdown
    }
    try {
      this.eglMakeCurrent(this.display, null, null, null);
      currentEglContext = null;
      this.eglDestroyContext(this.display, this.context);
      this.eglTerminate(this.display);
    } catch {
      // best effort
    }
    try {
      this.gbmDestroyDevice(this.gbmDevice);
    } catch {
      // best effort
    }
  }
}
