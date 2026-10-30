/**
 * Silk scene renderer: ribbon light and thread-transmission passes, a two-level bloom, and a graded
 * composite with the background waves. Written once against SilkGl, so the production pipeline is
 * what WebGL2 visual tests render. Text and other UI are React layers composed above its output.
 */
import { GL, type GlHandle, type SilkGl } from "./gl";
import {
  SILK_ASPECT,
  SILK_SAMPLES,
  SILK_TIMELINE,
  SilkMotion,
  type SilkMotionState,
} from "./motion";
import { BLUR_FS, BRIGHT_FS, COMPOSE_FS, FULLSCREEN_VS, RIBBON_FS, RIBBON_VS } from "./shaders";

type Target = { texture: GlHandle; framebuffer: GlHandle; width: number; height: number };

const RIBBON_ALONG = 720;
// Across resolution also carries the line-wave fold, whose ridge is steep.
const RIBBON_ACROSS = 48;

export class SilkRenderer {
  private readonly motion = new SilkMotion();
  private waveStart = Number.POSITIVE_INFINITY;
  private waveDuration = 2.6;
  /** Wave alignment, fixed when the morph begins so the pour never flips (0: unset). */
  private flipS = 0;
  private flipW = 0;
  private readonly ribbon: GlHandle;
  private readonly bright: GlHandle;
  private readonly blur: GlHandle;
  private readonly compose: GlHandle;
  private readonly ribbonVao: GlHandle;
  private readonly quadVao: GlHandle;
  private readonly buffers: GlHandle[] = [];
  private readonly ribbonCount: number;
  private readonly frameTexture: GlHandle;
  private readonly scene: Target;
  private readonly transmission: Target;
  private readonly half: [Target, Target];
  private readonly quarter: [Target, Target];
  private readonly layerScale: number;
  private readonly uniforms = new Map<string, GlHandle>();
  private destroyed = false;

  /** True when HDR (half-float) render targets are available; false uses 8-bit fallbacks. */
  readonly hdr: boolean;

  constructor(
    private readonly gl: SilkGl,
    readonly width: number,
    readonly height: number,
    /**
     * Write the Moire compositor's texture convention (B,G,R,A with rows top-down) instead of
     * GL's R,G,B,A bottom-up.
     */
    private readonly bgra = false,
    /** Resume the simulation here instead of replaying it from t = 0. */
    initial?: SilkMotionState,
  ) {
    if (initial) this.motion.restore(initial);
    this.hdr = !!(
      gl.getExtension("EXT_color_buffer_half_float") || gl.getExtension("EXT_color_buffer_float")
    );
    this.layerScale = this.hdr ? 1 : 0.25;

    this.ribbon = this.program(RIBBON_VS, RIBBON_FS);
    this.bright = this.program(FULLSCREEN_VS, BRIGHT_FS);
    this.blur = this.program(FULLSCREEN_VS, BLUR_FS);
    this.compose = this.program(FULLSCREEN_VS, COMPOSE_FS);

    // Ribbon grid: triangle strips across the width, joined by degenerate triangles.
    const verts: number[] = [];
    for (let j = 0; j < RIBBON_ACROSS; j++) {
      const w0 = -1 + (2 * j) / RIBBON_ACROSS,
        w1 = -1 + (2 * (j + 1)) / RIBBON_ACROSS;
      if (j > 0) verts.push(0, w0);
      for (let i = 0; i <= RIBBON_ALONG; i++) {
        const s = i / RIBBON_ALONG;
        verts.push(s, w0, s, w1);
      }
      verts.push(1, w1);
    }
    this.ribbonCount = verts.length / 2;
    this.ribbonVao = this.vertexArray(new Float32Array(verts));
    this.quadVao = this.vertexArray(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));

    this.frameTexture = gl.createTexture();
    gl.bindTexture(GL.TEXTURE_2D, this.frameTexture);
    gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA32F, SILK_SAMPLES, 2, 0, GL.RGBA, GL.FLOAT, null);
    this.sampling(GL.NEAREST);

    this.scene = this.target(width, height, this.hdr);
    this.transmission = this.target(width, height, false);
    const hw = Math.max(1, Math.round(width / 4)),
      hh = Math.max(1, Math.round(height / 4));
    const qw = Math.max(1, Math.round(width / 16)),
      qh = Math.max(1, Math.round(height / 16));
    this.half = [this.target(hw, hh, this.hdr), this.target(hw, hh, this.hdr)];
    this.quarter = [this.target(qw, qh, this.hdr), this.target(qw, qh, this.hdr)];
  }

  /** Seconds after which the scene is fully settled and only breathes. */
  static get settledAt(): number {
    return SILK_TIMELINE.settled;
  }

  /**
   * Pour the ribbon into the line-wave (the greeter's backdrop) from scene time `start` over
   * `duration` seconds. `-Infinity` shows the wave alone, with no ribbon physics at all.
   */
  morphToWave(start: number, duration = 2.6): void {
    this.waveStart = start;
    this.waveDuration = Math.max(0.001, duration);
  }

  private morphAt(t: number): number {
    if (this.waveStart === Number.POSITIVE_INFINITY) return 0;
    if (this.waveStart === Number.NEGATIVE_INFINITY) return 1;
    return Math.min(1, Math.max(0, (t - this.waveStart) / this.waveDuration));
  }

  /** Which ribbon end and side meet the wave's left edge and lower side: the shortest path. */
  private alignWave(frame: Float32Array): void {
    const last = (SILK_SAMPLES - 1) * 4;
    const mid = (SILK_SAMPLES >> 1) * 4;
    this.flipS = frame[last]! >= frame[0]! ? 1 : -1;
    const acrossY = frame[SILK_SAMPLES * 4 + mid + 1]!;
    this.flipW = acrossY >= 0 ? 1 : -1;
  }

  /** Render the scene at time t (seconds) into `output` (null: the default framebuffer). */
  render(t: number, output: GlHandle | null): void {
    if (this.destroyed) throw new Error("Silk renderer is destroyed");
    const gl = this.gl;
    const morph = this.morphAt(t);
    // Fully settled into the wave, the ribbon is no longer drawn from the simulation.
    if (morph < 1) {
      const frame = this.motion.frame(t);
      if (morph === 0 || this.flipS === 0) this.alignWave(frame.data);
      gl.bindTexture(GL.TEXTURE_2D, this.frameTexture);
      gl.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, SILK_SAMPLES, 2, GL.RGBA, GL.FLOAT, frame.data);
    } else if (this.flipS === 0) {
      this.flipS = 1;
      this.flipW = 1;
    }

    // Ribbon light; alpha accumulates layer coverage.
    gl.bindFramebuffer(GL.FRAMEBUFFER, this.scene.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.enable(GL.BLEND);
    gl.blendFunc(GL.ONE, GL.ONE);
    gl.useProgram(this.ribbon);
    gl.activeTexture(GL.TEXTURE0);
    gl.bindTexture(GL.TEXTURE_2D, this.frameTexture);
    gl.uniform1i(this.uniform(this.ribbon, "uFrame"), 0);
    gl.uniform1i(this.uniform(this.ribbon, "uSamples"), SILK_SAMPLES);
    gl.uniform1f(this.uniform(this.ribbon, "uTime"), t);
    gl.uniform1f(this.uniform(this.ribbon, "uAspect"), this.width / this.height);
    gl.uniform1f(
      this.uniform(this.ribbon, "uOffsetX"),
      (this.width / this.height - SILK_ASPECT) / 2,
    );
    gl.uniform1f(this.uniform(this.ribbon, "uLayerScale"), this.layerScale);
    gl.uniform1i(this.uniform(this.ribbon, "uMode"), 0);
    gl.uniform1f(this.uniform(this.ribbon, "uMorph"), morph);
    gl.uniform1f(this.uniform(this.ribbon, "uFlipS"), this.flipS || 1);
    gl.uniform1f(this.uniform(this.ribbon, "uFlipW"), this.flipW || 1);
    gl.bindVertexArray(this.ribbonVao);
    gl.drawArrays(GL.TRIANGLE_STRIP, 0, this.ribbonCount);

    // Thread transmission, multiplied layer over layer.
    gl.bindFramebuffer(GL.FRAMEBUFFER, this.transmission.framebuffer);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.blendFunc(GL.ZERO, GL.SRC_COLOR);
    gl.uniform1i(this.uniform(this.ribbon, "uMode"), 1);
    gl.drawArrays(GL.TRIANGLE_STRIP, 0, this.ribbonCount);
    gl.disable(GL.BLEND);

    this.bloom(this.scene, this.half);
    this.bloom(this.half[0], this.quarter);

    // Graded composite into the output.
    gl.bindFramebuffer(GL.FRAMEBUFFER, output);
    gl.viewport(0, 0, this.width, this.height);
    const p = this.compose;
    gl.useProgram(p);
    this.bindSampler(p, "scene", 0, this.scene.texture);
    this.bindSampler(p, "bloomA", 1, this.half[0].texture);
    this.bindSampler(p, "bloomB", 2, this.quarter[0].texture);
    this.bindSampler(p, "trans", 3, this.transmission.texture);
    gl.uniform1f(this.uniform(p, "uTime"), t);
    gl.uniform1f(this.uniform(p, "uLayerScale"), this.layerScale);
    gl.uniform1i(this.uniform(p, "uBgra"), this.bgra ? 1 : 0);
    gl.uniform1f(this.uniform(p, "uBackdrop"), 1 - 0.8 * morph);
    gl.uniform1i(this.uniform(p, "uFlipY"), this.bgra ? 1 : 0);
    gl.uniform2f(this.uniform(p, "res"), this.width, this.height);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    for (const t of [this.scene, this.transmission, ...this.half, ...this.quarter]) {
      gl.deleteFramebuffer(t.framebuffer);
      gl.deleteTexture(t.texture);
    }
    gl.deleteTexture(this.frameTexture);
    gl.deleteVertexArray(this.ribbonVao);
    gl.deleteVertexArray(this.quadVao);
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const p of [this.ribbon, this.bright, this.blur, this.compose]) gl.deleteProgram(p);
  }

  private bloom(source: Target, pair: [Target, Target]): void {
    const gl = this.gl;
    this.fullscreen(this.bright, pair[0], () =>
      this.bindSampler(this.bright, "src", 0, source.texture),
    );
    for (let k = 0; k < 2; k++) {
      this.fullscreen(this.blur, pair[1], () => {
        this.bindSampler(this.blur, "src", 0, pair[0].texture);
        gl.uniform2f(this.uniform(this.blur, "dir"), 1 / pair[0].width, 0);
      });
      this.fullscreen(this.blur, pair[0], () => {
        this.bindSampler(this.blur, "src", 0, pair[1].texture);
        gl.uniform2f(this.uniform(this.blur, "dir"), 0, 1 / pair[0].height);
      });
    }
  }

  private fullscreen(program: GlHandle, target: Target, setup: () => void): void {
    const gl = this.gl;
    gl.bindFramebuffer(GL.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(program);
    setup();
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
  }

  private bindSampler(program: GlHandle, name: string, unit: number, texture: GlHandle): void {
    const gl = this.gl;
    gl.activeTexture(GL.TEXTURE0 + unit);
    gl.bindTexture(GL.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(program, name), unit);
  }

  private uniform(program: GlHandle, name: string): GlHandle {
    const key = `${[this.ribbon, this.bright, this.blur, this.compose].indexOf(program)}:${name}`;
    let location = this.uniforms.get(key);
    if (location === undefined) {
      location = this.gl.getUniformLocation(program, name);
      this.uniforms.set(key, location);
    }
    return location;
  }

  private program(vertex: string, fragment: string): GlHandle {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, GL.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Silk shader compile failed: ${log ?? "no log"}`);
      }
      return shader;
    };
    const vs = compile(GL.VERTEX_SHADER, vertex);
    const fs = compile(GL.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, GL.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Silk program link failed: ${log ?? "no log"}`);
    }
    return program;
  }

  private vertexArray(data: Float32Array): GlHandle {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    this.buffers.push(buffer);
    gl.bindBuffer(GL.ARRAY_BUFFER, buffer);
    gl.bufferData(GL.ARRAY_BUFFER, data, GL.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);
    return vao;
  }

  private sampling(filter: number): void {
    const gl = this.gl;
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE);
  }

  private target(width: number, height: number, hdr: boolean): Target {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(GL.TEXTURE_2D, texture);
    gl.texImage2D(
      GL.TEXTURE_2D,
      0,
      hdr ? GL.RGBA16F : GL.RGBA8,
      width,
      height,
      0,
      GL.RGBA,
      hdr ? GL.HALF_FLOAT : GL.UNSIGNED_BYTE,
      null,
    );
    this.sampling(GL.LINEAR);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(GL.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
    if (status !== GL.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `Silk render target incomplete (0x${status.toString(16)}) ${width}x${height}`,
      );
    }
    return { texture, framebuffer, width, height };
  }
}
