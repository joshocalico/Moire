/**
 * Surfaceless EGL/GLES output scaler.
 *
 * This is intentionally independent from KMS presentation: it uploads one
 * logical BGRA/XRGB scene, crops/scales it for each output on the GPU, and
 * reads the result into the caller's proven scanout buffer. A future GBM
 * scanout target can replace readPixels without changing the composition API.
 */
import koffi from "koffi";
import { assertLinux } from "./platform.js";

const EGL_PLATFORM_GBM_KHR = 0x31d7;
const EGL_OPENGL_ES_API = 0x30a0;
const EGL_RENDERABLE_TYPE = 0x3040;
const EGL_OPENGL_ES2_BIT = 0x0004;
const EGL_RED_SIZE = 0x3024;
const EGL_GREEN_SIZE = 0x3023;
const EGL_BLUE_SIZE = 0x3022;
const EGL_ALPHA_SIZE = 0x3021;
const EGL_CONTEXT_CLIENT_VERSION = 0x3098;
const EGL_NONE = 0x3038;
const EGL_VENDOR = 0x3053;
const EGL_VERSION = 0x3054;
const EGL_EXTENSIONS = 0x3055;

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
const GL_ONE = 1;
const GL_ONE_MINUS_SRC_ALPHA = 0x0303;

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
};

export type EglCompositionLayer = {
  id: string;
  pixels: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  sourceStride: number;
  revision?: number;
  sourceRect?: { x: number; y: number; width: number; height: number };
  destination: { x: number; y: number; width: number; height: number };
  opacity?: number;
  /** Column-major 4×4 transform around the optional local-space origin. */
  transform?: readonly number[];
  transformOrigin?: readonly [number, number, number?];
  sampling?: "nearest" | "linear";
  surfaceGeometry?: { x: number; y: number; width: number; height: number };
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
};

export type EglCompositionScene = {
  width: number;
  height: number;
  clearColor: number;
  layers: readonly EglCompositionLayer[];
};

type CachedTexture = {
  texture: number;
  width: number;
  height: number;
  revision: number | undefined;
  pixels: Uint8Array;
  lastSeenFrame: number;
};

export class EglOutputScaler {
  readonly info: EglOutputInfo;

  private readonly gbm: ReturnType<typeof koffi.load>;
  private readonly egl: ReturnType<typeof koffi.load>;
  private readonly gl: ReturnType<typeof koffi.load>;
  private readonly gbmDevice: unknown;
  private readonly display: unknown;
  private readonly context: unknown;
  private readonly gbmDestroyDevice: NativeFunction;
  private readonly eglDestroyContext: NativeFunction;
  private readonly eglTerminate: NativeFunction;
  private readonly eglMakeCurrent: NativeFunction;
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
  private readonly glDisableVertexAttribArray: NativeFunction;
  private readonly glVertexAttribPointer: NativeFunction;
  private readonly glDrawArrays: NativeFunction;
  private readonly glReadPixels: NativeFunction;
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
  private readonly modeLocation: number;
  private readonly shadowRectLocation: number;
  private readonly shadowRadiusLocation: number;
  private readonly shadowSoftnessLocation: number;
  private readonly shadowColorLocation: number;
  private readonly blurDirectionLocation: number;
  private readonly saturationLocation: number;
  private readonly tintColorLocation: number;
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
  private compositionFrame = 0;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private sceneWidth = 0;
  private sceneHeight = 0;
  private backdropWidth = 0;
  private backdropHeight = 0;
  private blurWidth = 0;
  private blurHeight = 0;
  private targetWidth = 0;
  private targetHeight = 0;
  private readback: Uint8Array | null = null;
  private destroyed = false;

  constructor(drmFd: number) {
    assertLinux("EGL compositor output");
    this.gbm = loadFirst(["libgbm.so.1", "libgbm.so"]);
    this.egl = loadFirst(["libEGL.so.1", "libEGL.so"]);
    this.gl = loadFirst(["libGLESv2.so.2", "libGLESv2.so"]);

    const gbmCreateDevice = this.gbm.func(
      "void *gbm_create_device(int fd)",
    ) as NativeFunction;
    this.gbmDestroyDevice = this.gbm.func(
      "void gbm_device_destroy(void *gbm)",
    ) as NativeFunction;
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
    const eglBindApi = this.egl.func(
      "unsigned int eglBindAPI(unsigned int api)",
    ) as NativeFunction;
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
    this.eglTerminate = this.egl.func(
      "unsigned int eglTerminate(void *display)",
    ) as NativeFunction;
    const eglQueryString = this.egl.func(
      "const char *eglQueryString(void *display, int name)",
    ) as NativeFunction;
    const eglGetError = this.egl.func(
      "unsigned int eglGetError(void)",
    ) as NativeFunction;

    this.display = eglGetPlatformDisplay(
      EGL_PLATFORM_GBM_KHR,
      this.gbmDevice,
      null,
    );
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

    const configAttrs = new Int32Array([
      EGL_RENDERABLE_TYPE,
      EGL_OPENGL_ES2_BIT,
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
    let config: unknown;
    try {
      if (
        !Number(
          eglChooseConfig(
            this.display,
            configAttrs,
            configOut,
            1,
            configCount,
          ),
        ) ||
        (koffi.decode(configCount, "int") as number) < 1
      ) {
        throw new Error(`eglChooseConfig failed: 0x${Number(eglGetError()).toString(16)}`);
      }
      config = koffi.decode(configOut, "void *");
    } finally {
      koffi.free(configOut);
      koffi.free(configCount);
    }
    const contextAttrs = new Int32Array([
      EGL_CONTEXT_CLIENT_VERSION,
      2,
      EGL_NONE,
    ]);
    this.context = eglCreateContext(this.display, config, null, contextAttrs);
    if (pointerAddress(this.context) === 0n) {
      throw new Error(`eglCreateContext failed: 0x${Number(eglGetError()).toString(16)}`);
    }
    if (!Number(this.eglMakeCurrent(this.display, null, null, this.context))) {
      throw new Error(`surfaceless eglMakeCurrent failed: 0x${Number(eglGetError()).toString(16)}`);
    }

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

    this.glDeleteTextures = this.gl.func(
      "void glDeleteTextures(int n, const unsigned int *textures)",
    ) as NativeFunction;
    this.glDeleteFramebuffers = this.gl.func(
      "void glDeleteFramebuffers(int n, const unsigned int *framebuffers)",
    ) as NativeFunction;
    this.glDeleteProgram = this.gl.func(
      "void glDeleteProgram(unsigned int program)",
    ) as NativeFunction;
    this.glUseProgram = this.gl.func(
      "void glUseProgram(unsigned int program)",
    ) as NativeFunction;
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
    this.glClearColor = this.gl.func(
      "void glClearColor(float red, float green, float blue, float alpha)",
    ) as NativeFunction;
    this.glClear = this.gl.func(
      "void glClear(unsigned int mask)",
    ) as NativeFunction;
    this.glUniform1i = this.gl.func(
      "void glUniform1i(int location, int v0)",
    ) as NativeFunction;
    this.glUniform1f = this.gl.func(
      "void glUniform1f(int location, float v0)",
    ) as NativeFunction;
    this.glUniform4f = this.gl.func(
      "void glUniform4f(int location, float v0, float v1, float v2, float v3)",
    ) as NativeFunction;
    this.glUniform2f = this.gl.func(
      "void glUniform2f(int location, float v0, float v1)",
    ) as NativeFunction;
    this.glEnable = this.gl.func(
      "void glEnable(unsigned int cap)",
    ) as NativeFunction;
    this.glDisable = this.gl.func(
      "void glDisable(unsigned int cap)",
    ) as NativeFunction;
    this.glBlendFunc = this.gl.func(
      "void glBlendFunc(unsigned int sfactor, unsigned int dfactor)",
    ) as NativeFunction;
    this.glEnableVertexAttribArray = this.gl.func(
      "void glEnableVertexAttribArray(unsigned int index)",
    ) as NativeFunction;
    this.glDisableVertexAttribArray = this.gl.func(
      "void glDisableVertexAttribArray(unsigned int index)",
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
    this.geometryLocation = Number(
      glGetUniformLocation(this.program, "u_surface_geometry"),
    );
    this.hasGeometryLocation = Number(
      glGetUniformLocation(this.program, "u_has_surface_geometry"),
    );
    this.uvRectLocation = Number(glGetUniformLocation(this.program, "u_uv_rect"));
    this.layerSizeLocation = Number(glGetUniformLocation(this.program, "u_layer_size"));
    this.cornerRadiiLocation = Number(
      glGetUniformLocation(this.program, "u_corner_radii"),
    );
    this.modeLocation = Number(glGetUniformLocation(this.program, "u_mode"));
    this.shadowRectLocation = Number(glGetUniformLocation(this.program, "u_shadow_rect"));
    this.shadowRadiusLocation = Number(glGetUniformLocation(this.program, "u_shadow_radius"));
    this.shadowSoftnessLocation = Number(
      glGetUniformLocation(this.program, "u_shadow_softness"),
    );
    this.shadowColorLocation = Number(glGetUniformLocation(this.program, "u_shadow_color"));
    this.blurDirectionLocation = Number(
      glGetUniformLocation(this.program, "u_blur_direction"),
    );
    this.saturationLocation = Number(
      glGetUniformLocation(this.program, "u_saturation"),
    );
    this.tintColorLocation = Number(
      glGetUniformLocation(this.program, "u_tint_color"),
    );
    if (this.positionLocation < 0 || this.texCoordLocation < 0) {
      throw new Error("GLES compositor shader attributes unavailable");
    }

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
        throw new Error(`GLES shader compile failed: ${log.toString("utf8").replace(/\0.*$/s, "")}`);
      }
    } finally {
      koffi.free(status);
    }
    return shader;
  }

  private createProgram(): number {
    const vertex = this.createShader(
      GL_VERTEX_SHADER,
      "attribute vec2 a_position; attribute vec2 a_tex_coord; varying vec2 v_tex_coord; void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_tex_coord = a_tex_coord; }",
    );
    const fragment = this.createShader(
      GL_FRAGMENT_SHADER,
      `precision mediump float;
uniform sampler2D u_texture;
uniform float u_opacity;
uniform vec4 u_surface_geometry;
uniform float u_has_surface_geometry;
uniform vec4 u_uv_rect;
uniform vec2 u_layer_size;
uniform vec4 u_corner_radii;
uniform float u_mode;
uniform vec4 u_shadow_rect;
uniform float u_shadow_radius;
uniform float u_shadow_softness;
uniform vec4 u_shadow_color;
uniform vec2 u_blur_direction;
uniform float u_saturation;
uniform vec4 u_tint_color;
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
  if (u_mode > 2.5) {
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luminance), color.rgb, u_saturation);
    color.rgb = color.rgb * (1.0 - u_tint_color.a) + u_tint_color.rgb * u_tint_color.a;
    gl_FragColor = color * u_opacity;
    return;
  }
  if (u_has_surface_geometry > 0.5) {
    bool outside =
      v_tex_coord.x < u_surface_geometry.x ||
      v_tex_coord.y < u_surface_geometry.y ||
      v_tex_coord.x >= u_surface_geometry.z ||
      v_tex_coord.y >= u_surface_geometry.w;
    if (outside && color.a > 0.999) discard;
  }
  gl_FragColor = color * u_opacity;
}`,
    );
    const glCreateProgram = this.gl.func(
      "unsigned int glCreateProgram(void)",
    ) as NativeFunction;
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
          throw new Error(`GLES program link failed: ${log.toString("utf8").replace(/\0.*$/s, "")}`);
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

  private configureTexture(texture: number): void {
    this.glBindTexture(GL_TEXTURE_2D, texture);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  }

  beginFrame(source: Uint8Array, width: number, height: number): void {
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    if (source.byteLength < width * height * 4) {
      throw new RangeError("Logical EGL scene buffer is too small");
    }
    this.glActiveTexture(GL_TEXTURE0);
    this.glBindTexture(GL_TEXTURE_2D, this.sourceTexture);
    this.outputSourceTexture = this.sourceTexture;
    if (width !== this.sourceWidth || height !== this.sourceHeight) {
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
      this.sourceWidth = width;
      this.sourceHeight = height;
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
  }

  private textureForLayer(layer: EglCompositionLayer): number {
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
        lastSeenFrame: this.compositionFrame,
      };
      this.layerTextures.set(layer.id, cached);
    }
    cached.lastSeenFrame = this.compositionFrame;
    this.glBindTexture(GL_TEXTURE_2D, cached.texture);
    const filter = layer.sampling === "nearest" ? GL_NEAREST : GL_LINEAR;
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
    this.glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);

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
      for (let row = 0; row < layer.sourceHeight; row++) {
        upload.set(
          layer.pixels.subarray(
            row * layer.sourceStride,
            row * layer.sourceStride + tightStride,
          ),
          row * tightStride,
        );
      }
    }
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
    cached.width = layer.sourceWidth;
    cached.height = layer.sourceHeight;
    cached.revision = layer.revision;
    cached.pixels = layer.pixels;
    return cached.texture;
  }

  private transformLayerPoint(
    layer: EglCompositionLayer,
    x: number,
    y: number,
  ): readonly [number, number] {
    const matrix = layer.transform;
    if (!matrix) {
      return [layer.destination.x + x, layer.destination.y + y];
    }
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
    return [
      layer.destination.x + origin[0] + tx * invW,
      layer.destination.y + origin[1] + ty * invW,
    ];
  }

  private drawQuad(positions: Float32Array, texCoords: Float32Array): void {
    this.glEnableVertexAttribArray(this.positionLocation);
    this.glEnableVertexAttribArray(this.texCoordLocation);
    this.glVertexAttribPointer(this.positionLocation, 2, GL_FLOAT, 0, 0, positions);
    this.glVertexAttribPointer(this.texCoordLocation, 2, GL_FLOAT, 0, 0, texCoords);
    this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  }

  private bindColorTarget(framebuffer: number, texture: number): void {
    this.glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
    this.glFramebufferTexture2D(
      GL_FRAMEBUFFER,
      GL_COLOR_ATTACHMENT0,
      GL_TEXTURE_2D,
      texture,
      0,
    );
    const status = Number(this.glCheckFramebufferStatus(GL_FRAMEBUFFER));
    if (status !== GL_FRAMEBUFFER_COMPLETE) {
      throw new Error(`GLES effect framebuffer incomplete: 0x${status.toString(16)}`);
    }
  }

  private paintBackdropBlur(
    scene: EglCompositionScene,
    layer: EglCompositionLayer,
  ): void {
    const effect = layer.backdropBlur;
    if (!effect || effect.radius <= 0) return;

    // An untransformed material only needs the pixels beneath its bounds plus
    // the kernel reach. Transformed effects retain the conservative full-scene
    // path until transformed damage/bounds are represented by the graph.
    const padding = Math.ceil(effect.radius);
    const regional = !layer.transform;
    const sampleX = regional
      ? Math.max(0, Math.floor(layer.destination.x - padding))
      : 0;
    const sampleY = regional
      ? Math.max(0, Math.floor(layer.destination.y - padding))
      : 0;
    const sampleRight = regional
      ? Math.min(
          scene.width,
          Math.ceil(layer.destination.x + layer.destination.width + padding),
        )
      : scene.width;
    const sampleBottom = regional
      ? Math.min(
          scene.height,
          Math.ceil(layer.destination.y + layer.destination.height + padding),
        )
      : scene.height;
    const backdropWidth = Math.max(1, sampleRight - sampleX);
    const backdropHeight = Math.max(1, sampleBottom - sampleY);

    // Snapshot the already-composited stack. Sampling sceneTexture while it is
    // the active render target would be undefined feedback in GLES.
    this.glActiveTexture(GL_TEXTURE0);
    this.glBindTexture(GL_TEXTURE_2D, this.backdropTexture);
    if (
      backdropWidth !== this.backdropWidth ||
      backdropHeight !== this.backdropHeight
    ) {
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

    const downsample = 4;
    const blurWidth = Math.max(1, Math.ceil(backdropWidth / downsample));
    const blurHeight = Math.max(1, Math.ceil(backdropHeight / downsample));
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

    const fullPositions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const fullCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
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
    this.drawQuad(fullPositions, fullCoords);

    this.bindColorTarget(this.blurFramebufferB, this.blurTextureB);
    this.glBindTexture(GL_TEXTURE_2D, this.blurTextureA);
    this.glUniform2f(
      this.blurDirectionLocation,
      0,
      Math.max(0.5, effect.radius / downsample) / kernelReach / blurHeight,
    );
    this.drawQuad(fullPositions, fullCoords);

    this.bindColorTarget(this.sceneFramebuffer, this.sceneTexture);
    this.glViewport(0, 0, scene.width, scene.height);
    this.glEnable(GL_BLEND);
    this.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    this.glBindTexture(GL_TEXTURE_2D, this.blurTextureB);
    this.glUniform1f(this.modeLocation, 3);
    this.glUniform1f(this.opacityLocation, layer.opacity ?? 1);
    this.glUniform1f(this.hasGeometryLocation, 0);
    this.glUniform1f(this.saturationLocation, effect.saturation ?? 1);
    const tint = effect.tint ?? 0;
    this.glUniform4f(
      this.tintColorLocation,
      (tint & 0xff) / 255,
      ((tint >>> 8) & 0xff) / 255,
      ((tint >>> 16) & 0xff) / 255,
      ((tint >>> 24) & 0xff) / 255,
    );

    const clipX = (x: number) => (x / scene.width) * 2 - 1;
    const clipY = (y: number) => (y / scene.height) * 2 - 1;
    const p0 = this.transformLayerPoint(layer, 0, 0);
    const p1 = this.transformLayerPoint(layer, layer.destination.width, 0);
    const p2 = this.transformLayerPoint(layer, 0, layer.destination.height);
    const p3 = this.transformLayerPoint(
      layer,
      layer.destination.width,
      layer.destination.height,
    );
    const positions = new Float32Array([
      clipX(p0[0]), clipY(p0[1]),
      clipX(p1[0]), clipY(p1[1]),
      clipX(p2[0]), clipY(p2[1]),
      clipX(p3[0]), clipY(p3[1]),
    ]);
    const x0 = (layer.destination.x - sampleX) / backdropWidth;
    const y0 = (layer.destination.y - sampleY) / backdropHeight;
    const x1 =
      (layer.destination.x + layer.destination.width - sampleX) / backdropWidth;
    const y1 =
      (layer.destination.y + layer.destination.height - sampleY) / backdropHeight;
    this.glUniform4f(this.uvRectLocation, x0, y0, x1, y1);
    this.glUniform2f(
      this.layerSizeLocation,
      layer.destination.width,
      layer.destination.height,
    );
    const radii =
      typeof layer.cornerRadius === "number"
        ? [layer.cornerRadius, layer.cornerRadius, layer.cornerRadius, layer.cornerRadius]
        : layer.cornerRadius ?? [0, 0, 0, 0];
    this.glUniform4f(
      this.cornerRadiiLocation,
      radii[0]!,
      radii[1]!,
      radii[2]!,
      radii[3]!,
    );
    this.drawQuad(
      positions,
      new Float32Array([x0, y0, x1, y0, x0, y1, x1, y1]),
    );
  }

  /** Compose retained, revisioned layers into one logical GPU scene. */
  beginComposition(scene: EglCompositionScene): void {
    if (this.destroyed) throw new Error("EGL output scaler is destroyed");
    if (scene.width < 1 || scene.height < 1) {
      throw new RangeError("EGL composition scene has invalid dimensions");
    }
    this.compositionFrame++;
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
    this.glViewport(0, 0, scene.width, scene.height);
    const color = scene.clearColor >>> 0;
    this.glClearColor(
      (color & 0xff) / 255,
      ((color >>> 8) & 0xff) / 255,
      ((color >>> 16) & 0xff) / 255,
      ((color >>> 24) & 0xff) / 255,
    );
    this.glClear(GL_COLOR_BUFFER_BIT);
    this.glUseProgram(this.program);
    this.glEnable(GL_BLEND);
    this.glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    this.glActiveTexture(GL_TEXTURE0);
    this.glUniform1i(this.samplerLocation, 0);

    for (const layer of scene.layers) {
      const clipX = (x: number) => (x / scene.width) * 2 - 1;
      const clipY = (y: number) => (y / scene.height) * 2 - 1;
      this.paintBackdropBlur(scene, layer);
      const shadow = layer.dropShadow;
      if (shadow) {
        const spread = shadow.spread ?? 0;
        const padding = Math.max(1, shadow.blurRadius + Math.max(0, spread));
        const x0 = shadow.offsetX - padding;
        const y0 = shadow.offsetY - padding;
        const shadowWidth = layer.destination.width + padding * 2;
        const shadowHeight = layer.destination.height + padding * 2;
        const sp0 = this.transformLayerPoint(layer, x0, y0);
        const sp1 = this.transformLayerPoint(layer, x0 + shadowWidth, y0);
        const sp2 = this.transformLayerPoint(layer, x0, y0 + shadowHeight);
        const sp3 = this.transformLayerPoint(
          layer,
          x0 + shadowWidth,
          y0 + shadowHeight,
        );
        const shadowPositions = new Float32Array([
          clipX(sp0[0]), clipY(sp0[1]),
          clipX(sp1[0]), clipY(sp1[1]),
          clipX(sp2[0]), clipY(sp2[1]),
          clipX(sp3[0]), clipY(sp3[1]),
        ]);
        const unitCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
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
        this.glUniform1f(
          this.shadowSoftnessLocation,
          Math.max(0.5, shadow.blurRadius * 0.5),
        );
        this.glUniform4f(
          this.shadowColorLocation,
          (shadowColor & 0xff) / 255,
          ((shadowColor >>> 8) & 0xff) / 255,
          ((shadowColor >>> 16) & 0xff) / 255,
          (((shadowColor >>> 24) & 0xff) / 255) * (layer.opacity ?? 1),
        );
        this.glEnableVertexAttribArray(this.positionLocation);
        this.glEnableVertexAttribArray(this.texCoordLocation);
        this.glVertexAttribPointer(
          this.positionLocation,
          2,
          GL_FLOAT,
          0,
          0,
          shadowPositions,
        );
        this.glVertexAttribPointer(
          this.texCoordLocation,
          2,
          GL_FLOAT,
          0,
          0,
          unitCoords,
        );
        this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
      }
      const texture = this.textureForLayer(layer);
      this.glBindTexture(GL_TEXTURE_2D, texture);
      this.glUniform1f(this.modeLocation, 0);
      this.glUniform1f(this.opacityLocation, layer.opacity ?? 1);
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
      const p0 = this.transformLayerPoint(layer, 0, 0);
      const p1 = this.transformLayerPoint(layer, layer.destination.width, 0);
      const p2 = this.transformLayerPoint(layer, 0, layer.destination.height);
      const p3 = this.transformLayerPoint(
        layer,
        layer.destination.width,
        layer.destination.height,
      );
      const positions = new Float32Array([
        clipX(p0[0]), clipY(p0[1]),
        clipX(p1[0]), clipY(p1[1]),
        clipX(p2[0]), clipY(p2[1]),
        clipX(p3[0]), clipY(p3[1]),
      ]);
      const source = layer.sourceRect ?? {
        x: 0,
        y: 0,
        width: layer.sourceWidth,
        height: layer.sourceHeight,
      };
      const u0 = source.x / layer.sourceWidth;
      const v0 = source.y / layer.sourceHeight;
      const u1 = (source.x + source.width) / layer.sourceWidth;
      const v1 = (source.y + source.height) / layer.sourceHeight;
      this.glUniform4f(this.uvRectLocation, u0, v0, u1, v1);
      this.glUniform2f(
        this.layerSizeLocation,
        layer.destination.width,
        layer.destination.height,
      );
      const radii =
        typeof layer.cornerRadius === "number"
          ? [
              layer.cornerRadius,
              layer.cornerRadius,
              layer.cornerRadius,
              layer.cornerRadius,
            ]
          : layer.cornerRadius ?? [0, 0, 0, 0];
      this.glUniform4f(
        this.cornerRadiiLocation,
        radii[0]!,
        radii[1]!,
        radii[2]!,
        radii[3]!,
      );
      const texCoords = new Float32Array([u0, v0, u1, v0, u0, v1, u1, v1]);
      this.glEnableVertexAttribArray(this.positionLocation);
      this.glEnableVertexAttribArray(this.texCoordLocation);
      this.glVertexAttribPointer(this.positionLocation, 2, GL_FLOAT, 0, 0, positions);
      this.glVertexAttribPointer(this.texCoordLocation, 2, GL_FLOAT, 0, 0, texCoords);
      this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    }
    this.glDisableVertexAttribArray(this.positionLocation);
    this.glDisableVertexAttribArray(this.texCoordLocation);
    this.glDisable(GL_BLEND);
    this.outputSourceTexture = this.sceneTexture;

    if (this.compositionFrame % 120 === 0) {
      for (const [id, cached] of this.layerTextures) {
        if (this.compositionFrame - cached.lastSeenFrame < 120) continue;
        this.glDeleteTextures(1, new Uint32Array([cached.texture]));
        this.layerTextures.delete(id);
      }
    }
  }

  renderOutput(output: EglScaleOutput): void {
    if (
      output.x < 0 ||
      output.y < 0 ||
      output.x + output.width > this.sourceWidth ||
      output.y + output.height > this.sourceHeight
    ) {
      throw new RangeError(`Output ${output.id} lies outside the EGL scene`);
    }
    if (
      output.targetPitch < output.targetWidth * 4 ||
      output.target.byteLength < output.targetPitch * output.targetHeight
    ) {
      throw new RangeError(`Target for ${output.id} is too small`);
    }

    this.glBindTexture(GL_TEXTURE_2D, this.targetTexture);
    if (
      output.targetWidth !== this.targetWidth ||
      output.targetHeight !== this.targetHeight
    ) {
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
    this.glBindFramebuffer(GL_FRAMEBUFFER, this.framebuffer);
    this.glFramebufferTexture2D(
      GL_FRAMEBUFFER,
      GL_COLOR_ATTACHMENT0,
      GL_TEXTURE_2D,
      this.targetTexture,
      0,
    );
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
    this.glDisable(GL_BLEND);

    const u0 = output.x / this.sourceWidth;
    const v0 = output.y / this.sourceHeight;
    const u1 = (output.x + output.width) / this.sourceWidth;
    const v1 = (output.y + output.height) / this.sourceHeight;
    this.glUniform4f(this.uvRectLocation, u0, v0, u1, v1);
    this.glUniform2f(this.layerSizeLocation, output.targetWidth, output.targetHeight);
    this.glUniform4f(this.cornerRadiiLocation, 0, 0, 0, 0);
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const texCoords = new Float32Array([u0, v0, u1, v0, u0, v1, u1, v1]);
    this.glEnableVertexAttribArray(this.positionLocation);
    this.glEnableVertexAttribArray(this.texCoordLocation);
    this.glVertexAttribPointer(
      this.positionLocation,
      2,
      GL_FLOAT,
      0,
      0,
      positions,
    );
    this.glVertexAttribPointer(
      this.texCoordLocation,
      2,
      GL_FLOAT,
      0,
      0,
      texCoords,
    );
    this.glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
    this.glDisableVertexAttribArray(this.positionLocation);
    this.glDisableVertexAttribArray(this.texCoordLocation);

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
    if (tight !== output.target) {
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
      const textures = [
        this.sourceTexture,
        this.targetTexture,
        this.sceneTexture,
        this.backdropTexture,
        this.blurTextureA,
        this.blurTextureB,
        ...[...this.layerTextures.values()].map((entry) => entry.texture),
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
      this.glDeleteProgram(this.program);
    } catch {
      // best effort during compositor shutdown
    }
    try {
      this.eglMakeCurrent(this.display, null, null, null);
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
