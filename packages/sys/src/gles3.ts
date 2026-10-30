/**
 * WebGL2-shaped binding over a current native GLES 3 context. GPU scene producers (the boot silk)
 * are written once against the WebGL2 subset and run unchanged in a browser for visual tests and
 * here on KMS. Object handles are GL names; a missing uniform is null, as in WebGL.
 */
import type { IKoffiLib } from "koffi";

const GL_EXTENSIONS = 0x1f03;
const GL_NUM_EXTENSIONS = 0x821d;
const GL_INFO_LOG_LENGTH = 0x8b84;

type Native = (...args: unknown[]) => unknown;

export type Gles3 = ReturnType<typeof createGles3>;

export function createGles3(lib: IKoffiLib) {
  const fn = (declaration: string) => lib.func(declaration) as Native;
  const gen = fn("void glGenTextures(int n, _Out_ uint32_t *names)");
  const genBuffers = fn("void glGenBuffers(int n, _Out_ uint32_t *names)");
  const genFramebuffers = fn("void glGenFramebuffers(int n, _Out_ uint32_t *names)");
  const genVertexArrays = fn("void glGenVertexArrays(int n, _Out_ uint32_t *names)");
  const delTextures = fn("void glDeleteTextures(int n, const uint32_t *names)");
  const delBuffers = fn("void glDeleteBuffers(int n, const uint32_t *names)");
  const delFramebuffers = fn("void glDeleteFramebuffers(int n, const uint32_t *names)");
  const delVertexArrays = fn("void glDeleteVertexArrays(int n, const uint32_t *names)");
  const getShaderiv = fn("void glGetShaderiv(uint32_t shader, uint32_t pname, _Out_ int *value)");
  const getProgramiv = fn(
    "void glGetProgramiv(uint32_t program, uint32_t pname, _Out_ int *value)",
  );
  const shaderLog = fn(
    "void glGetShaderInfoLog(uint32_t shader, int size, _Out_ int *length, _Out_ uint8_t *log)",
  );
  const programLog = fn(
    "void glGetProgramInfoLog(uint32_t program, int size, _Out_ int *length, _Out_ uint8_t *log)",
  );
  const shaderSource = fn(
    "void glShaderSource(uint32_t shader, int count, const char **sources, const int *lengths)",
  );
  const getString = fn("const char *glGetString(uint32_t name)");
  const getStringi = fn("const char *glGetStringi(uint32_t name, uint32_t index)");
  const getIntegerv = fn("void glGetIntegerv(uint32_t pname, _Out_ int *value)");
  const bufferData = fn(
    "void glBufferData(uint32_t target, intptr_t size, const void *data, uint32_t usage)",
  );
  const attribPointer = fn(
    "void glVertexAttribPointer(uint32_t index, int size, uint32_t type, uint8_t normalized, int stride, intptr_t offset)",
  );
  const texImage2D = fn(
    "void glTexImage2D(uint32_t target, int level, int internalformat, int width, int height, int border, uint32_t format, uint32_t type, const void *pixels)",
  );
  const texSubImage2D = fn(
    "void glTexSubImage2D(uint32_t target, int level, int x, int y, int width, int height, uint32_t format, uint32_t type, const void *pixels)",
  );
  const uniformLocation = fn("int glGetUniformLocation(uint32_t program, const char *name)");
  const one = (gen: Native) => {
    const out = new Uint32Array(1);
    gen(1, out);
    return out[0]!;
  };
  const drop = (del: Native, name: unknown) => {
    if (name) del(1, new Uint32Array([name as number]));
  };
  const integer = (query: Native, name: number, pname: number) => {
    const out = new Int32Array(1);
    query(name, pname, out);
    return out[0]!;
  };
  const log = (query: Native, read: Native, name: unknown) => {
    const size = integer(query, name as number, GL_INFO_LOG_LENGTH);
    if (size <= 0) return "";
    const bytes = new Uint8Array(size);
    read(name, size, new Int32Array(1), bytes);
    return Buffer.from(bytes).toString("utf8").replace(/\0.*$/s, "");
  };
  const view = (pixels: ArrayBufferView | null) =>
    pixels ? new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength) : null;

  let extensions: Set<string> | null = null;
  const extensionSet = () => {
    if (extensions) return extensions;
    const count = new Int32Array(1);
    getIntegerv(GL_NUM_EXTENSIONS, count);
    extensions = new Set<string>();
    for (let index = 0; index < count[0]!; index++) {
      extensions.add(String(getStringi(GL_EXTENSIONS, index) ?? ""));
    }
    if (extensions.size === 0) {
      for (const name of String(getString(GL_EXTENSIONS) ?? "").split(/\s+/))
        if (name) extensions.add(name);
    }
    return extensions;
  };

  const direct = {
    createShader: fn("uint32_t glCreateShader(uint32_t type)") as (type: number) => number,
    compileShader: fn("void glCompileShader(uint32_t shader)") as (shader: unknown) => void,
    deleteShader: fn("void glDeleteShader(uint32_t shader)") as (shader: unknown) => void,
    createProgram: fn("uint32_t glCreateProgram(void)") as () => number,
    attachShader: fn("void glAttachShader(uint32_t program, uint32_t shader)") as (
      program: unknown,
      shader: unknown,
    ) => void,
    linkProgram: fn("void glLinkProgram(uint32_t program)") as (program: unknown) => void,
    deleteProgram: fn("void glDeleteProgram(uint32_t program)") as (program: unknown) => void,
    useProgram: fn("void glUseProgram(uint32_t program)") as (program: unknown) => void,
    uniform1i: fn("void glUniform1i(int location, int x)") as (
      location: unknown,
      x: number,
    ) => void,
    uniform1f: fn("void glUniform1f(int location, float x)") as (
      location: unknown,
      x: number,
    ) => void,
    uniform2f: fn("void glUniform2f(int location, float x, float y)") as (
      location: unknown,
      x: number,
      y: number,
    ) => void,
    bindBuffer: fn("void glBindBuffer(uint32_t target, uint32_t buffer)") as (
      target: number,
      buffer: unknown,
    ) => void,
    bindVertexArray: fn("void glBindVertexArray(uint32_t array)") as (vao: unknown) => void,
    enableVertexAttribArray: fn("void glEnableVertexAttribArray(uint32_t index)") as (
      index: number,
    ) => void,
    drawArrays: fn("void glDrawArrays(uint32_t mode, int first, int count)") as (
      mode: number,
      first: number,
      count: number,
    ) => void,
    bindTexture: fn("void glBindTexture(uint32_t target, uint32_t texture)") as (
      target: number,
      texture: unknown,
    ) => void,
    activeTexture: fn("void glActiveTexture(uint32_t unit)") as (unit: number) => void,
    texParameteri: fn("void glTexParameteri(uint32_t target, uint32_t pname, int param)") as (
      target: number,
      pname: number,
      param: number,
    ) => void,
    pixelStorei: fn("void glPixelStorei(uint32_t pname, int param)") as (
      pname: number,
      param: number,
    ) => void,
    bindFramebuffer: fn("void glBindFramebuffer(uint32_t target, uint32_t framebuffer)") as (
      target: number,
      framebuffer: unknown,
    ) => void,
    framebufferTexture2D: fn(
      "void glFramebufferTexture2D(uint32_t target, uint32_t attachment, uint32_t textarget, uint32_t texture, int level)",
    ) as (
      target: number,
      attachment: number,
      textarget: number,
      texture: unknown,
      level: number,
    ) => void,
    checkFramebufferStatus: fn("uint32_t glCheckFramebufferStatus(uint32_t target)") as (
      target: number,
    ) => number,
    viewport: fn("void glViewport(int x, int y, int width, int height)") as (
      x: number,
      y: number,
      width: number,
      height: number,
    ) => void,
    clearColor: fn("void glClearColor(float r, float g, float b, float a)") as (
      r: number,
      g: number,
      b: number,
      a: number,
    ) => void,
    clear: fn("void glClear(uint32_t mask)") as (mask: number) => void,
    enable: fn("void glEnable(uint32_t cap)") as (cap: number) => void,
    disable: fn("void glDisable(uint32_t cap)") as (cap: number) => void,
    blendFunc: fn("void glBlendFunc(uint32_t sfactor, uint32_t dfactor)") as (
      sfactor: number,
      dfactor: number,
    ) => void,
    finish: fn("void glFinish(void)") as () => void,
  };

  return {
    ...direct,
    shaderSource(shader: unknown, source: string) {
      shaderSource(shader, 1, [source], null);
    },
    getShaderParameter: (shader: unknown, pname: number) =>
      integer(getShaderiv, shader as number, pname),
    getProgramParameter: (program: unknown, pname: number) =>
      integer(getProgramiv, program as number, pname),
    getShaderInfoLog: (shader: unknown) => log(getShaderiv, shaderLog, shader),
    getProgramInfoLog: (program: unknown) => log(getProgramiv, programLog, program),
    getUniformLocation(program: unknown, name: string): number | null {
      const location = Number(uniformLocation(program, name));
      return location < 0 ? null : location;
    },
    createBuffer: () => one(genBuffers),
    deleteBuffer: (buffer: unknown) => drop(delBuffers, buffer),
    bufferData(target: number, data: ArrayBufferView, usage: number) {
      bufferData(target, data.byteLength, view(data), usage);
    },
    createVertexArray: () => one(genVertexArrays),
    deleteVertexArray: (vao: unknown) => drop(delVertexArrays, vao),
    vertexAttribPointer(
      index: number,
      size: number,
      type: number,
      normalized: boolean,
      stride: number,
      offset: number,
    ) {
      attribPointer(index, size, type, normalized ? 1 : 0, stride, offset);
    },
    createTexture: () => one(gen),
    deleteTexture: (texture: unknown) => drop(delTextures, texture),
    createFramebuffer: () => one(genFramebuffers),
    deleteFramebuffer: (framebuffer: unknown) => drop(delFramebuffers, framebuffer),
    texImage2D(
      target: number,
      level: number,
      internalformat: number,
      width: number,
      height: number,
      border: number,
      format: number,
      type: number,
      pixels: ArrayBufferView | null,
    ) {
      texImage2D(target, level, internalformat, width, height, border, format, type, view(pixels));
    },
    texSubImage2D(
      target: number,
      level: number,
      x: number,
      y: number,
      width: number,
      height: number,
      format: number,
      type: number,
      pixels: ArrayBufferView,
    ) {
      texSubImage2D(target, level, x, y, width, height, format, type, view(pixels));
    },
    /** WebGL names map to their GLES spellings; returns a truthy marker when supported. */
    getExtension(name: string): object | null {
      const set = extensionSet();
      return set.has(name) || set.has(`GL_${name}`) ? {} : null;
    },
  };
}
