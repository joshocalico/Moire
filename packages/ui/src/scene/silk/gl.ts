/**
 * The GL surface the silk renderer needs: a strict subset of WebGL2RenderingContext, so a browser
 * context satisfies it directly (visual tests) and the native GLES 3 binding implements the same
 * calls. Handles are opaque to the renderer.
 */
export type GlHandle = unknown;

export interface SilkGl {
  createShader(type: number): GlHandle;
  shaderSource(shader: GlHandle, source: string): void;
  compileShader(shader: GlHandle): void;
  getShaderParameter(shader: GlHandle, pname: number): unknown;
  getShaderInfoLog(shader: GlHandle): string | null;
  deleteShader(shader: GlHandle): void;
  createProgram(): GlHandle;
  attachShader(program: GlHandle, shader: GlHandle): void;
  linkProgram(program: GlHandle): void;
  getProgramParameter(program: GlHandle, pname: number): unknown;
  getProgramInfoLog(program: GlHandle): string | null;
  deleteProgram(program: GlHandle): void;
  useProgram(program: GlHandle): void;
  getUniformLocation(program: GlHandle, name: string): GlHandle;
  uniform1i(location: GlHandle, x: number): void;
  uniform1f(location: GlHandle, x: number): void;
  uniform2f(location: GlHandle, x: number, y: number): void;
  createBuffer(): GlHandle;
  bindBuffer(target: number, buffer: GlHandle): void;
  bufferData(target: number, data: Float32Array, usage: number): void;
  deleteBuffer(buffer: GlHandle): void;
  createVertexArray(): GlHandle;
  bindVertexArray(vao: GlHandle): void;
  deleteVertexArray(vao: GlHandle): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;
  drawArrays(mode: number, first: number, count: number): void;
  createTexture(): GlHandle;
  bindTexture(target: number, texture: GlHandle): void;
  deleteTexture(texture: GlHandle): void;
  activeTexture(unit: number): void;
  texParameteri(target: number, pname: number, param: number): void;
  pixelStorei(pname: number, param: number): void;
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
  ): void;
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
  ): void;
  createFramebuffer(): GlHandle;
  bindFramebuffer(target: number, framebuffer: GlHandle): void;
  deleteFramebuffer(framebuffer: GlHandle): void;
  framebufferTexture2D(
    target: number,
    attachment: number,
    textarget: number,
    texture: GlHandle,
    level: number,
  ): void;
  checkFramebufferStatus(target: number): number;
  viewport(x: number, y: number, width: number, height: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  enable(cap: number): void;
  disable(cap: number): void;
  blendFunc(sfactor: number, dfactor: number): void;
  getExtension(name: string): unknown;
  finish(): void;
}

/** GLES 3 / WebGL2 enum values (identical in both APIs). */
export const GL = Object.freeze({
  VERTEX_SHADER: 0x8b31,
  FRAGMENT_SHADER: 0x8b30,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  ARRAY_BUFFER: 0x8892,
  STATIC_DRAW: 0x88e4,
  FLOAT: 0x1406,
  HALF_FLOAT: 0x140b,
  UNSIGNED_BYTE: 0x1401,
  TRIANGLE_STRIP: 0x0005,
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  UNPACK_ALIGNMENT: 0x0cf5,
  RGBA: 0x1908,
  RED: 0x1903,
  RGBA8: 0x8058,
  R8: 0x8229,
  RGBA16F: 0x881a,
  RGBA32F: 0x8814,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  COLOR_BUFFER_BIT: 0x4000,
  BLEND: 0x0be2,
  ONE: 1,
  ZERO: 0,
  SRC_COLOR: 0x0300,
});
