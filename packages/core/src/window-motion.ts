/**
 * Desktop window motion on the retained scene: windows fade and settle in as they appear, close
 * by fading back and away, minimize by shrinking into their taskbar button and restore by
 * growing back out of it.
 *
 * Motion only rewrites a window's layers (opacity, transform, rise); the clients never see it.
 * A closing window is drawn from the layers of its last presented frame, so the compositor keeps
 * that frame's contents alive until the exit finishes (see `retains`).
 */
import type {
  CompositionLayer,
  CompositionMatrix4,
  CompositionRect,
  PixelSurface,
} from "./composition";

/** Fade-and-rise entrance for a newly mapped window. */
export const WINDOW_OPEN_MS = 180;
export const WINDOW_OPEN_RISE = 8;
/** Closing: fade out while settling back slightly. */
export const WINDOW_CLOSE_MS = 160;
export const WINDOW_CLOSE_SCALE = 0.96;
/** Minimize into, and restore out of, the window's taskbar button. */
export const WINDOW_MINIMIZE_MS = 240;

type Rect = CompositionRect;
type Fate = "minimized" | "closed";

type Exit = {
  fate: Fate;
  startedMs: number;
  layers: CompositionLayer[];
  bounds: Rect;
  target: Rect | null;
};

export type WindowMotionHost = {
  /** False for stages without a desktop (the greeter) and under reduced motion. */
  enabled(): boolean;
  /** Whether a window that stopped being shown was minimized or went away. */
  fate(key: string): Fate;
  /** The window's taskbar button in output coordinates, when it has one. */
  taskAnchor(key: string): Rect | null;
};

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function union(layers: readonly CompositionLayer[], start: number, end: number): Rect {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = start; i < end; i++) {
    const d = layers[i]!.destination;
    x0 = Math.min(x0, d.x);
    y0 = Math.min(y0, d.y);
    x1 = Math.max(x1, d.x + d.width);
    y1 = Math.max(y1, d.y + d.height);
  }
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

/**
 * Scale a window's layers by `scale` about its centre, move that centre by (dx, dy) and multiply
 * their opacity. Scene-space masks (clip, content shape) follow the same mapping.
 */
export function transformWindowLayers(
  layers: readonly CompositionLayer[],
  bounds: Rect,
  scale: number,
  dx: number,
  dy: number,
  opacity: number,
): CompositionLayer[] {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const mapRect = (r: Rect): Rect => ({
    x: cx + (r.x - cx) * scale + dx,
    y: cy + (r.y - cy) * scale + dy,
    width: r.width * scale,
    height: r.height * scale,
  });
  const identity = scale === 1;
  const matrix: CompositionMatrix4 = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1];
  return layers.map((layer) => {
    const opacityOnly = { ...layer, opacity: (layer.opacity ?? 1) * opacity };
    if (identity && dx === 0 && dy === 0) return opacityOnly;
    if (identity) {
      // A pure move stays on the cheap, regionally damaged path.
      return {
        ...opacityOnly,
        destination: {
          ...layer.destination,
          x: layer.destination.x + dx,
          y: layer.destination.y + dy,
        },
        clip: layer.clip && { ...layer.clip, x: layer.clip.x + dx, y: layer.clip.y + dy },
        contentShape: layer.contentShape && {
          ...layer.contentShape,
          bounds: {
            ...layer.contentShape.bounds,
            x: layer.contentShape.bounds.x + dx,
            y: layer.contentShape.bounds.y + dy,
          },
        },
      };
    }
    return {
      ...opacityOnly,
      transform: {
        matrix,
        origin: [cx - layer.destination.x, cy - layer.destination.y, 0],
      },
      clip: layer.clip && mapRect(layer.clip),
      contentShape: layer.contentShape && {
        ...layer.contentShape,
        bounds: mapRect(layer.contentShape.bounds),
        radii: layer.contentShape.radii.map((radius) => radius * scale) as unknown as readonly [
          number,
          number,
          number,
          number,
        ],
      },
    };
  });
}

/** Where a window stands `t` (0…1) of the way into its taskbar button. */
function towardAnchor(bounds: Rect, anchor: Rect, t: number) {
  const fit = Math.min(anchor.width / bounds.width, anchor.height / bounds.height, 1);
  const scale = 1 + (fit - 1) * t;
  const dx = (anchor.x + anchor.width / 2 - (bounds.x + bounds.width / 2)) * t;
  const dy = (anchor.y + anchor.height / 2 - (bounds.y + bounds.height / 2)) * t;
  // Mostly opaque while it travels, gone as it lands.
  const opacity = 1 - Math.max(0, (t - 0.55) / 0.45);
  return { scale, dx, dy, opacity };
}

export class WindowMotion {
  /** When each shown window appeared, and how (a restore grows out of the taskbar). */
  private readonly shown = new Map<string, { sinceMs: number; restored: Rect | null }>();
  /** Each shown window's untransformed layers from the last frame, for its exit. */
  private readonly remembered = new Map<string, { layers: CompositionLayer[]; bounds: Rect }>();
  private readonly exits = new Map<string, Exit>();
  private readonly minimized = new Set<string>();
  private retainedSources = new Set<PixelSurface>();
  private readonly deferred = new Set<{ destroy(): void } & PixelSurface>();
  private seen = new Set<string>();
  private moving = false;

  constructor(private readonly host: WindowMotionHost) {}

  /** True while any window is mid-motion; the compositor keeps producing frames. */
  get active(): boolean {
    return this.moving;
  }

  /** Whether an exit (or a possible exit) still draws from this content. */
  retains(source: PixelSurface): boolean {
    return this.retainedSources.has(source);
  }

  /** Destroy this content once no window motion draws from it any longer. */
  defer(content: { destroy(): void } & PixelSurface): void {
    this.deferred.add(content);
  }

  beginFrame(): void {
    this.seen = new Set();
    this.moving = false;
  }

  /**
   * A window's layers for this frame are `layers[start…]`. Remember them for its exit and apply
   * its entrance (fade and rise, or a restore out of its taskbar button) while it lasts.
   */
  present(key: string, layers: CompositionLayer[], start: number, now: number): void {
    if (layers.length <= start) return;
    this.seen.add(key);
    const own = layers.slice(start);
    const bounds = union(layers, start, layers.length);
    this.remembered.set(key, { layers: own, bounds });
    // A window shown again mid-exit (restored while minimizing) simply resumes.
    this.exits.delete(key);
    let entry = this.shown.get(key);
    if (!entry) {
      const enabled = this.host.enabled();
      const restored = enabled && this.minimized.has(key) ? this.host.taskAnchor(key) : null;
      entry = { sinceMs: enabled ? now : -Infinity, restored };
      this.shown.set(key, entry);
      this.minimized.delete(key);
    }
    const duration = entry.restored ? WINDOW_MINIMIZE_MS : WINDOW_OPEN_MS;
    const u = (now - entry.sinceMs) / duration;
    if (!(u < 1)) return;
    this.moving = true;
    const t = Math.max(0, u);
    let next: CompositionLayer[];
    if (entry.restored) {
      const step = towardAnchor(bounds, entry.restored, 1 - easeInOut(t));
      next = transformWindowLayers(own, bounds, step.scale, step.dx, step.dy, step.opacity);
    } else {
      const settle = easeOut(t);
      // Opacity leads the rise so the window reads as solid before it lands.
      const rise = Math.round((1 - settle) * WINDOW_OPEN_RISE);
      next = transformWindowLayers(own, bounds, 1, 0, rise, Math.min(1, settle * 1.4));
    }
    layers.splice(start, own.length, ...next);
  }

  /**
   * Start exits for windows that stopped being shown, append every exiting window's layers
   * (from `z` upwards) and release contents nothing draws from any more. Returns the next z.
   */
  endFrame(layers: CompositionLayer[], z: number, now: number): number {
    const enabled = this.host.enabled();
    for (const [key, last] of this.remembered) {
      if (this.seen.has(key)) continue;
      this.remembered.delete(key);
      this.shown.delete(key);
      const fate = this.host.fate(key);
      if (fate === "minimized") this.minimized.add(key);
      if (!enabled || last.bounds.width <= 0 || last.bounds.height <= 0) continue;
      this.exits.set(key, {
        fate,
        startedMs: now,
        layers: last.layers,
        bounds: last.bounds,
        target: fate === "minimized" ? this.host.taskAnchor(key) : null,
      });
    }
    for (const [key, exit] of this.exits) {
      const duration = exit.fate === "minimized" ? WINDOW_MINIMIZE_MS : WINDOW_CLOSE_MS;
      const u = (now - exit.startedMs) / duration;
      if (!(u < 1)) {
        this.exits.delete(key);
        continue;
      }
      this.moving = true;
      const t = Math.max(0, u);
      const step = exit.target
        ? towardAnchor(exit.bounds, exit.target, easeInOut(t))
        : {
            scale: 1 + (WINDOW_CLOSE_SCALE - 1) * easeOut(t),
            dx: 0,
            dy: Math.round(easeOut(t) * 6),
            opacity: 1 - easeOut(t),
          };
      for (const layer of transformWindowLayers(
        exit.layers,
        exit.bounds,
        step.scale,
        step.dx,
        step.dy,
        step.opacity,
      ))
        layers.push({ ...layer, id: `exit:${key}:${layer.id}`, z: z++ });
    }
    this.retainedSources = new Set();
    for (const { layers: own } of this.remembered.values())
      for (const layer of own) this.retainedSources.add(layer.source);
    for (const exit of this.exits.values())
      for (const layer of exit.layers) this.retainedSources.add(layer.source);
    for (const content of this.deferred) {
      if (this.retainedSources.has(content)) continue;
      this.deferred.delete(content);
      content.destroy();
    }
    return z;
  }

  /** Forget everything (output loss, stage handoff) and release held contents. */
  reset(): void {
    this.shown.clear();
    this.remembered.clear();
    this.exits.clear();
    this.minimized.clear();
    this.retainedSources = new Set();
    for (const content of this.deferred) content.destroy();
    this.deferred.clear();
    this.moving = false;
  }
}
