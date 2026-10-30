/**
 * Silk boot motion: a soft ribbon (particle chain) drawn by a choreographed leader through a
 * gentle current, then laid out between two held ends. Pure TypeScript and deterministic:
 * the same time always yields the same frame, so it renders identically in WebGL tests and
 * on the native GLES path.
 *
 * Space: x in iso units (viewport width = ASPECT), y down (viewport height = 1), z toward the
 * viewer.
 */

export const SILK_SAMPLES = 512;
export const SILK_ASPECT = 1.6;

type Vec3 = [number, number, number];

const PI = Math.PI;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const ease5 = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * x * (x * (x * 6 - 15) + 10);
};
const smooth = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const u2 = u * u,
    u3 = u2 * u;
  const c = (k: 0 | 1 | 2) =>
    0.5 *
    (2 * p1[k] +
      (-p0[k] + p2[k]) * u +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3);
  return [c(0), c(1), c(2)];
}

// ---------- Leader: WHERE it goes (one arc-length curve) and HOW FAST (one speed profile) ----------

const PATH_POINTS: Vec3[] = (() => {
  const C = [1.1, 0.42],
    R = [0.44, 0.3],
    th0 = 3.89;
  const entry: Vec3 = [C[0]! + R[0]! * Math.cos(th0), C[1]! + R[1]! * Math.sin(th0), 0];
  const pts: Vec3[] = [[-0.6, 1.4, 0], [-0.42, 1.27, 0], [0.18, 0.74, 0], entry];
  // 02: one slow twirl around an eye-shaped orbit tilted in depth (clockwise on screen).
  for (let k = 1; k <= 24; k++) {
    const u = k / 24,
      th = th0 + 2 * PI * 0.92 * u;
    pts.push([
      C[0]! + R[0]! * Math.cos(th),
      C[1]! + R[1]! * Math.sin(th),
      0.28 * Math.sin(th - th0),
    ]);
  }
  // 03: draw the loop out along its axis toward the viewer, then come to rest off-screen right.
  pts.push(
    [0.86, 0.15, 0.22],
    [1.05, 0.15, 0.5],
    [1.32, 0.2, 0.78],
    [1.62, 0.3, 0.92],
    [1.98, 0.48, 0.62],
    [2.12, 0.66, 0.25],
    [2.06, 0.76, 0.0],
    [2.02, 0.765, 0.0],
  );
  return pts;
})();

/** Dense arc-length table of a centripetal Catmull-Rom through the path points. */
const PATH = (() => {
  const P = PATH_POINTS;
  const samples: Vec3[] = [];
  const lengths = [0];
  const knot = (a: Vec3, b: Vec3) =>
    Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) || 1e-6;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)]!,
      p1 = P[i]!,
      p2 = P[i + 1]!,
      p3 = P[Math.min(P.length - 1, i + 2)]!;
    const t0 = 0,
      t1 = t0 + knot(p0, p1),
      t2 = t1 + knot(p1, p2),
      t3 = t2 + knot(p2, p3);
    for (let k = i === 0 ? 0 : 1; k <= 40; k++) {
      const t = t1 + (t2 - t1) * (k / 40);
      const L = (pa: Vec3, pb: Vec3, ta: number, tb: number): Vec3 => [
        ((tb - t) * pa[0] + (t - ta) * pb[0]) / (tb - ta),
        ((tb - t) * pa[1] + (t - ta) * pb[1]) / (tb - ta),
        ((tb - t) * pa[2] + (t - ta) * pb[2]) / (tb - ta),
      ];
      const A1 = L(p0, p1, t0, t1),
        A2 = L(p1, p2, t1, t2),
        A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2),
        B2 = L(A2, A3, t1, t3);
      const p = L(B1, B2, t1, t2);
      const last = samples[samples.length - 1];
      if (last)
        lengths.push(
          lengths[lengths.length - 1]! + Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]),
        );
      samples.push(p);
    }
  }
  return { samples, lengths, total: lengths[lengths.length - 1]! };
})();

function pathAt(distance: number): Vec3 {
  const { samples, lengths, total } = PATH;
  const d = Math.max(0, Math.min(total, distance));
  let lo = 0,
    hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const k = (d - lengths[lo]!) / Math.max(1e-9, lengths[hi]! - lengths[lo]!);
  const a = samples[lo]!,
    b = samples[hi]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Speed keys (seconds, relative speed); smootherstep between keys keeps acceleration continuous. */
const SPEED_KEYS: ReadonlyArray<readonly [number, number]> = [
  [0.25, 0],
  [0.8, 1.9],
  [1.2, 1.75],
  [2.25, 1.15],
  [3.05, 1.15],
  [3.55, 1.55],
  [4.4, 1.3],
  [5.4, 0.42],
  [6.6, 0.1],
  [7.8, 0.0],
];
function speedAt(t: number): number {
  const K = SPEED_KEYS;
  if (t <= K[0]![0]) return K[0]![1];
  for (let i = 0; i < K.length - 1; i++) {
    const [ta, va] = K[i]!,
      [tb, vb] = K[i + 1]!;
    if (t <= tb) {
      const u = (t - ta) / (tb - ta);
      return va + (vb - va) * u * u * u * (u * (u * 6 - 15) + 10);
    }
  }
  return K[K.length - 1]![1];
}
const DIST = (() => {
  // Integrate the profile, then scale so the head arrives exactly at rest.
  const dt = 1 / 960;
  const table = [0];
  for (let t = dt; t <= 9; t += dt) table.push(table[table.length - 1]! + speedAt(t) * dt);
  const k = PATH.total / table[table.length - 1]!;
  return { dt, table: Float64Array.from(table, (v) => v * k) };
})();

export function leaderAt(t: number): Vec3 {
  const x = Math.min(DIST.table.length - 1.001, Math.max(0, t / DIST.dt));
  const i = Math.floor(x);
  const p = pathAt(DIST.table[i]! + (DIST.table[i + 1]! - DIST.table[i]!) * (x - i));
  // At rest the anchor keeps a slow breath, so the silk never stops dead.
  const idle = ease5(5.0, 7.5, t);
  return [
    p[0] + idle * 0.015 * Math.sin(t * 0.55),
    p[1] + idle * 0.018 * Math.sin(t * 0.8 + 1.0),
    p[2] + idle * 0.03 * Math.sin(t * 0.45),
  ];
}

/** Still at first, then a breath from the right that lays the silk out; eases to a light breeze. */
function current(x: number, y: number, z: number, t: number): Vec3 {
  const stream = ease5(3.6, 6.2, t);
  const sway = Math.sin(y * 5.1 + t * 0.9) * 0.6 + Math.sin(x * 3.3 - t * 0.7) * 0.4;
  return [
    -2.3 * stream * (1 - 0.8 * ease5(4.6, 5.8, t)) * (0.6 + 0.4 * clamp01((1.9 - x) / 1.8)) +
      0.1 * Math.sin(y * 4 + t * 0.6),
    0.22 * sway * (0.4 + 0.6 * stream) + (0.76 - y) * 5.0 * stream,
    0.18 * Math.sin(x * 2.7 + t * 0.8) - z * 0.8 * stream,
  ];
}

// ---------- The chain ----------

const N = 220;
const LENGTH = 3.2;
const SEG = LENGTH / (N - 1);
const DT = 1 / 240;
const BEND: ReadonlyArray<readonly [number, number]> = [
  [2, 0.95],
  [6, 0.86],
  [16, 0.7],
  [32, 0.52],
];

export type SilkFrame = Readonly<{
  /** SILK_SAMPLES × 2 RGBA texels: row 0 centre xyz + half width; row 1 across xyz + billow. */
  data: Float32Array;
  time: number;
}>;

/** Complete simulation state at a fixed step, so a later stage can resume it exactly. */
export type SilkMotionState = Readonly<{
  time: number;
  pos: readonly number[];
  prev: readonly number[];
  seed: readonly [number, number, number] | null;
}>;

export class SilkMotion {
  private readonly pos = new Float64Array(N * 3);
  private readonly prev = new Float64Array(N * 3);
  private simTime = 0;
  private started = false;
  private frameSeed: Vec3 | null = null;
  private readonly data = new Float32Array(SILK_SAMPLES * 2 * 4);

  constructor() {
    this.reset();
  }

  reset(): void {
    const start = leaderAt(0);
    for (let i = 0; i < N; i++) {
      // Spooled off-screen down-left of the entry, so the leader draws it out.
      this.pos[i * 3] = start[0] - i * SEG * 0.3;
      this.pos[i * 3 + 1] = start[1] + i * SEG * 0.18;
      this.pos[i * 3 + 2] = -i * SEG * 0.6;
    }
    this.prev.set(this.pos);
    this.simTime = 0;
    this.started = false;
    this.frameSeed = null;
  }

  /** The state after the last simulated step (call after frame() to include the frame seed). */
  snapshot(): SilkMotionState {
    return {
      time: this.simTime,
      pos: Array.from(this.pos),
      prev: Array.from(this.prev),
      seed: this.frameSeed ? [this.frameSeed[0], this.frameSeed[1], this.frameSeed[2]] : null,
    };
  }

  /** Resume from a snapshot; later frames continue exactly as the original run would. */
  restore(state: SilkMotionState): void {
    if (state.pos.length !== N * 3 || state.prev.length !== N * 3)
      throw new Error("Silk snapshot does not match the simulation");
    this.pos.set(state.pos);
    this.prev.set(state.prev);
    this.simTime = state.time;
    this.started = true;
    this.frameSeed = state.seed ? [state.seed[0], state.seed[1], state.seed[2]] : null;
  }

  /** Read-only view of the particle chain (for diagnostics and tests). */
  particles(): Float64Array {
    return this.pos;
  }

  /** Advance the fixed-step simulation to t (seconds). Going backwards restarts deterministically. */
  simulateTo(t: number): void {
    if (t < this.simTime - 1e-9) this.reset();
    this.started = true;
    while (this.simTime + DT <= t + 1e-9) this.step();
  }

  private step(): void {
    const pos = this.pos,
      prev = this.prev;
    const t = this.simTime + DT;
    // Anisotropic air drag: a ribbon slides easily along its length but resists moving broadside,
    // so it follows the path its head has drawn (how a gymnast's ribbon holds a spiral).
    const along = 0.01;
    const broadside = mix(
      mix(mix(0.3, 0.11, ease5(3.35, 4.1, t)), 0.045, ease5(4.1, 5.0, t)),
      0.16,
      ease5(5.2, 6.6, t),
    );
    for (let i = 1; i < N; i++) {
      const o = i * 3,
        a = (i - 1) * 3,
        c = Math.min(N - 1, i + 1) * 3;
      let tx = pos[a]! - pos[c]!,
        ty = pos[a + 1]! - pos[c + 1]!,
        tz = pos[a + 2]! - pos[c + 2]!;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const vx = pos[o]! - prev[o]!,
        vy = pos[o + 1]! - prev[o + 1]!,
        vz = pos[o + 2]! - prev[o + 2]!;
      const vt = vx * tx + vy * ty + vz * tz;
      const nx = vx - vt * tx,
        ny = vy - vt * ty,
        nz = vz - vt * tz;
      const f = current(pos[o]!, pos[o + 1]!, pos[o + 2]!, t);
      prev[o] = pos[o]!;
      prev[o + 1] = pos[o + 1]!;
      prev[o + 2] = pos[o + 2]!;
      pos[o] = pos[o]! + vt * tx * (1 - along) + nx * (1 - broadside) + f[0] * DT * DT * 3.0;
      pos[o + 1] =
        pos[o + 1]! + vt * ty * (1 - along) + ny * (1 - broadside) + f[1] * DT * DT * 3.0;
      pos[o + 2] =
        pos[o + 2]! + vt * tz * (1 - along) + nz * (1 - broadside) + f[2] * DT * DT * 3.0;
    }
    const lead = leaderAt(t);
    prev[0] = pos[0]!;
    prev[1] = pos[1]!;
    prev[2] = pos[2]!;
    pos[0] = lead[0];
    pos[1] = lead[1];
    pos[2] = lead[2];
    // Settle: the tail end is guided to rest off-screen left, so the silk drapes between two
    // held ends instead of being flung straight by the current.
    const hold = ease5(4.0, 7.2, t);
    if (hold > 0) {
      const o = (N - 1) * 3;
      const target = [-0.55, 0.775 + 0.012 * Math.sin(t * 0.7), 0.02 * Math.sin(t * 0.5)];
      const k = hold * 0.005;
      for (let j = 0; j < 3; j++) pos[o + j] = pos[o + j]! + (target[j]! - pos[o + j]!) * k;
    }
    for (let iter = 0; iter < 10; iter++) {
      for (let i = 0; i < N - 1; i++) this.constrain(i, i + 1, SEG, 1, false);
      // Multi-scale bending: loops stay open and roll out instead of cinching into knots.
      for (const [gap, fraction] of BEND) {
        const min = SEG * gap * fraction;
        for (let i = 0; i + gap < N; i++) this.constrain(i, i + gap, min, 0.45, true);
      }
    }
    this.simTime = t;
  }

  private constrain(
    i: number,
    j: number,
    length: number,
    stiffness: number,
    minimumOnly: boolean,
  ): void {
    const pos = this.pos;
    const a = i * 3,
      b = j * 3;
    const dx = pos[b]! - pos[a]!,
      dy = pos[b + 1]! - pos[a + 1]!,
      dz = pos[b + 2]! - pos[a + 2]!;
    const d = Math.hypot(dx, dy, dz) || 1e-9;
    if (minimumOnly && d >= length) return;
    const k = ((d - length) / d) * stiffness;
    // The head (index 0) is kinematic: only the other end moves.
    const wa = i === 0 ? 0 : 0.5,
      wb = i === 0 ? 1 : 0.5;
    pos[a] = pos[a]! + dx * k * wa;
    pos[a + 1] = pos[a + 1]! + dy * k * wa;
    pos[a + 2] = pos[a + 2]! + dz * k * wa;
    pos[b] = pos[b]! - dx * k * wb;
    pos[b + 1] = pos[b + 1]! - dy * k * wb;
    pos[b + 2] = pos[b + 2]! - dz * k * wb;
  }

  /** Ribbon geometry for time t: centreline, half width, width direction and billow per sample. */
  frame(t: number): SilkFrame {
    this.simulateTo(t);
    const pos = this.pos;
    const S = SILK_SAMPLES;
    const at = (i: number): Vec3 => [pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!];
    const pts = Array.from({ length: S }, (_, j): Vec3 => {
      const x = (j / (S - 1)) * (N - 1);
      const i = Math.min(N - 2, Math.floor(x));
      return catmull(at(Math.max(0, i - 1)), at(i), at(i + 1), at(Math.min(N - 1, i + 2)), x - i);
    });
    const tans = Array.from({ length: S }, (_, i) =>
      norm(sub(pts[Math.min(S - 1, i + 1)]!, pts[Math.max(0, i - 1)]!)),
    );

    // Seed the transported frame coherently in TIME: keep whichever side agrees with the last
    // frame's seed. A per-frame "face up-left" test would flip the sheet (and its billow) in one
    // frame whenever the head's heading swept past that direction.
    let r = cross([0, 0, 1], tans[0]!);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = this.frameSeed ?? [1, 0, 0];
    r = norm(r);
    if (this.frameSeed ? dot(r, this.frameSeed) < 0 : dot(r, [-0.6, -0.8, 0]) < 0) r = scale(r, -1);
    this.frameSeed = r;

    const data = this.data;
    const acrossRaw: Vec3[] = Array.from({ length: S }, (): Vec3 => [0, 0, 0]);
    const billows = new Float32Array(S);
    let bank = 0;
    const open = ease5(0.9, 2.2, t);
    for (let i = 0; i < S; i++) {
      if (i > 0) {
        // Double reflection (Wang et al. 2008): rotation-minimising frame without flips.
        const v1 = sub(pts[i]!, pts[i - 1]!);
        const c1 = dot(v1, v1);
        if (c1 > 1e-12) {
          const rL = sub(r, scale(v1, (2 / c1) * dot(v1, r)));
          const tL = sub(tans[i - 1]!, scale(v1, (2 / c1) * dot(v1, tans[i - 1]!)));
          const v2 = sub(tans[i]!, tL);
          const c2 = dot(v2, v2);
          r = c2 > 1e-12 ? sub(rL, scale(v2, (2 / c2) * dot(v2, rL))) : rL;
        }
      }
      const s = i / (S - 1);
      const b = cross(tans[i]!, r);
      // Bank into turns (smoothed screen-space curvature) plus twists that travel tail-ward.
      const tp = tans[Math.max(0, i - 3)]!,
        tn = tans[Math.min(S - 1, i + 3)]!;
      const turn = tp[0] * tn[1] - tp[1] * tn[0];
      bank = mix(bank, Math.max(-0.7, Math.min(0.7, turn * 4)), 0.035);
      const wave =
        0.85 * Math.sin(2 * PI * (s * 1.35 - t * 0.32)) +
        0.35 * Math.sin(2 * PI * (s * 3.1 - t * 0.55) + 1.3);
      const phi = mix(PI * 0.47, 0.15 + bank + wave * (1 + 0.25 * ease5(3.6, 5.2, t)), open);
      acrossRaw[i] = add(scale(r, Math.cos(phi)), scale(b, Math.sin(phi)));
      // Width unfurls from the head toward the tail, tapering softly at both ends.
      const unfurl = smooth(-0.15, 0.25, ease5(0.9, 2.4, t) * 1.3 - s);
      const ends = smooth(0.0, 0.1, s) * (1 - smooth(0.74, 1.0, s));
      const hw = mix(0.01, 0.105, unfurl) * ends * mix(1, 0.62, ease5(3.6, 5.2, t));
      const p = pts[i]!;
      data[i * 4] = p[0];
      data[i * 4 + 1] = p[1];
      data[i * 4 + 2] = p[2];
      data[i * 4 + 3] = hw;
      billows[i] = (0.32 + 0.22 * Math.sin(s * 6.0 - t * 1.1)) * open;
    }
    // Smooth the width direction along the ribbon and limit its turn per sample, so tight folds
    // never flip triangles into faceted flashes.
    let across = acrossRaw.map((v) => [...v] as Vec3);
    for (let pass = 0; pass < 3; pass++) {
      const next = across.map((v) => [...v] as Vec3);
      for (let i = 1; i < S - 1; i++) {
        next[i] = norm(
          add(
            add(scale(across[i - 1]!, 0.25), scale(across[i]!, 0.5)),
            scale(across[i + 1]!, 0.25),
          ),
        );
      }
      across = next;
    }
    const MAX_TURN = 0.12;
    for (let i = 1; i < S; i++) {
      let a = across[i]!;
      if (dot(a, across[i - 1]!) < 0) a = scale(a, -1);
      const cosT = Math.min(1, dot(a, across[i - 1]!));
      if (Math.acos(cosT) > MAX_TURN)
        a = norm(add(scale(across[i - 1]!, 1 - MAX_TURN), scale(a, MAX_TURN)));
      across[i] = norm(sub(a, scale(tans[i]!, dot(a, tans[i]!))));
    }
    for (let i = 0; i < S; i++) {
      const a = across[i]!;
      const o = (S + i) * 4;
      data[o] = a[0];
      data[o + 1] = a[1];
      data[o + 2] = a[2];
      data[o + 3] = billows[i]!;
    }
    return { data, time: t };
  }

  get time(): number {
    return this.started ? this.simTime : 0;
  }
}

/** Composition timing shared by every renderer (all in seconds since the silk started). */
export const SILK_TIMELINE = Object.freeze({
  /** The settled band is fully at rest after this. */
  settled: 7.6,
});
