/**
 * Numeric motion values. Legacy values may be read during React render;
 * presentation values can instead be attached directly to scene transforms so
 * the renderer advances them without reconciling the component tree.
 */
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { RetainedMotionAdmission } from "./retained-motion-admission";
export type { RetainedMotionAdmission } from "./retained-motion-admission";

export type MotionValue = {
  get(): number;
  /** Jump immediately to v (no easing). */
  set(v: number): void;
  /** Desired value the motion eases toward. */
  target: number;
  /**
   * Advance by dt seconds.
   * Returns true if the value is still moving (|target - value| ≥ 0.5).
   */
  tick(dt: number): boolean;
};

const SETTLE_PX = 0.5;
const DEFAULT_SPEED = 14; // higher = faster convergence

type TickableMotion = {
  get(): number;
  tick(dt: number): boolean;
  isActive(): boolean;
  presentationOnly?: boolean;
};

const registry = new Set<TickableMotion>();

class MotionValueImpl implements MotionValue {
  private _value: number;
  target: number;
  _speed: number;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): number => this._value;
  private publish(previous: number): void {
    if (previous !== this._value) for (const listener of this.listeners) listener();
  }

  constructor(initial: number, speed?: number) {
    this._value = initial;
    this.target = initial;
    this._speed = speed ?? DEFAULT_SPEED;
  }

  get(): number {
    return this._value;
  }

  set(v: number): void {
    const previous = this._value;
    this._value = v;
    this.target = v;
    this.publish(previous);
  }

  tick(dt: number): boolean {
    const previous = this._value;
    const diff = this.target - this._value;
    if (Math.abs(diff) < SETTLE_PX) {
      this._value = this.target;
      this.publish(previous);
      return false;
    }
    this._value += diff * (1 - Math.exp(-this._speed * dt));
    if (Math.abs(this.target - this._value) < SETTLE_PX) {
      // The scheduler stops ticking inactive values. Publish the exact final
      // value now, including zero opacity, rather than waiting for another tick.
      this._value = this.target;
      this.publish(previous);
      return false;
    }
    this.publish(previous);
    return true;
  }

  isActive(): boolean {
    return Math.abs(this.target - this._value) >= SETTLE_PX;
  }
}

/**
 * Create a new motion value with the given initial position.
 * The returned value is registered globally and will be ticked by tickAllMotions.
 */
export function createMotionValue(initial: number): MotionValue {
  const mv = new MotionValueImpl(initial);
  registry.add(mv);
  return mv;
}

/**
 * React-owned motion value. Unlike createMotionValue(), this registers once
 * for the component lifetime and leaves the global tick registry on unmount.
 */
export function useMotionValue(initial: number): MotionValue {
  const ref = useRef<MotionValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new MotionValueImpl(initial);
    registry.add(ref.current);
  }
  const value = ref.current;
  // Numeric-read consumers must rerender even when Window content is static JSX.
  // Presentation-only motion keeps its separate renderer path below.
  useSyncExternalStore(value.subscribe, value.snapshot, value.snapshot);
  useEffect(
    () => () => {
      registry.delete(value);
    },
    [value],
  );
  return value;
}

/**
 * Set the motion value's target.  An optional speed (default 14) controls
 * how quickly it converges (higher = faster).
 */
export function easeTo(mv: MotionValue, target: number, speed?: number): void {
  mv.target = target;
  if (speed != null) {
    (mv as MotionValueImpl)._speed = speed;
  }
}

export type TweenEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export type TweenOptions = {
  duration?: number;
  easing?: TweenEasing;
};

export type TweenValue = {
  get(): number;
  set(value: number): void;
  target: number;
  animateTo(value: number, options?: TweenOptions): void;
  tick(dt: number): boolean;
};

function applyEasing(value: number, easing: TweenEasing): number {
  const t = Math.max(0, Math.min(1, value));
  if (easing === "ease-in") return t * t * t;
  if (easing === "ease-out") return 1 - Math.pow(1 - t, 3);
  if (easing === "ease-in-out") {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  return t;
}

class TweenValueImpl implements TweenValue {
  private value: number;
  private from: number;
  private elapsed = 0;
  private duration = 0.22;
  private easing: TweenEasing = "ease-in-out";
  target: number;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = (): number => this.value;
  private publish(previous: number): void {
    if (previous !== this.value) for (const listener of this.listeners) listener();
  }

  constructor(initial: number) {
    this.value = initial;
    this.from = initial;
    this.target = initial;
  }

  get(): number {
    return this.value;
  }

  set(value: number): void {
    const previous = this.value;
    this.value = value;
    this.from = value;
    this.target = value;
    this.elapsed = this.duration;
    this.publish(previous);
  }

  animateTo(value: number, options?: TweenOptions): void {
    this.from = this.value;
    this.target = value;
    this.elapsed = 0;
    this.duration = Math.max(0, (options?.duration ?? 220) / 1000);
    this.easing = options?.easing ?? "ease-in-out";
    if (this.duration === 0) this.set(value);
  }

  tick(dt: number): boolean {
    if (this.value === this.target || this.duration === 0) return false;
    const previous = this.value;
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const progress = this.elapsed / this.duration;
    this.value = this.from + (this.target - this.from) * applyEasing(progress, this.easing);
    if (this.elapsed >= this.duration) {
      this.value = this.target;
      this.publish(previous);
      return false;
    }
    this.publish(previous);
    return true;
  }

  isActive(): boolean {
    return this.value !== this.target && this.duration > 0;
  }
}

export function createTweenValue(initial: number): TweenValue {
  const value = new TweenValueImpl(initial);
  registry.add(value);
  return value;
}

export function useTweenValue(initial: number): TweenValue {
  const ref = useRef<TweenValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new TweenValueImpl(initial);
    registry.add(ref.current);
  }
  const value = ref.current;
  useSyncExternalStore(value.subscribe, value.snapshot, value.snapshot);
  useEffect(
    () => () => {
      registry.delete(value);
    },
    [value],
  );
  return value;
}

export function tweenTo(value: TweenValue, target: number, options?: TweenOptions): void {
  value.animateTo(target, options);
}

export function useTween(
  target: number,
  options?: TweenOptions & { initialValue?: number },
): number {
  const value = useTweenValue(options?.initialValue ?? target);
  const duration = options?.duration;
  const easing = options?.easing;
  useEffect(() => {
    value.animateTo(target, { duration, easing });
  }, [duration, easing, target, value]);
  return value.get();
}

export type TweenProps = TweenOptions & {
  value: number;
  from?: number;
  children: (value: number) => ReactNode;
};

/** Declarative duration/easing adapter for any numeric component property. */
export function Tween(props: TweenProps): ReactNode {
  const value = useTween(props.value, {
    initialValue: props.from,
    duration: props.duration,
    easing: props.easing,
  });
  return props.children(value);
}

export type LoopOptions = {
  from: number;
  to: number;
  /** Duration of one journey from one endpoint to the other, in milliseconds. */
  duration?: number;
  easing?: TweenEasing;
  /** `mirror` reverses at each endpoint; `loop` jumps back to `from`. */
  repeat?: "mirror" | "loop";
  playing?: boolean;
};

/** Read directly by renderer presentation properties such as translateX/Y. */
export type AnimationValue = {
  get(): number;
};

export type OwnedAnimationValue = AnimationValue & {
  dispose(): void;
};

export type AnimatedValueOptions = TweenOptions & {
  initialValue?: number;
};

export type DampedValueOptions = {
  /** Exponential convergence rate in inverse seconds. Higher values settle sooner. */
  speed?: number;
  /** Distance at which the value snaps to its target. */
  settleThreshold?: number;
  /** Bypass interpolation for direct manipulation. */
  immediate?: boolean;
  initialValue?: number;
};

class AnimatedValueImpl implements OwnedAnimationValue, TickableMotion {
  readonly presentationOnly = true;
  private value: number;
  private from: number;
  private target: number;
  private elapsed = 0;
  private duration: number;
  private easing: TweenEasing;

  constructor(target: number, options?: AnimatedValueOptions) {
    this.value = options?.initialValue ?? target;
    this.from = this.value;
    this.target = target;
    this.duration = Math.max(0, (options?.duration ?? 220) / 1_000);
    this.easing = options?.easing ?? "ease-in-out";
    this.elapsed = this.value === target ? this.duration : 0;
  }

  configure(target: number, options?: AnimatedValueOptions): void {
    this.duration = Math.max(0, (options?.duration ?? 220) / 1_000);
    this.easing = options?.easing ?? "ease-in-out";
    if (target === this.target) {
      // Direct manipulation must be able to take ownership from an in-flight
      // animation without waiting for the target to change again.
      if (this.duration === 0 && this.value !== target) {
        this.value = target;
        this.from = target;
        this.elapsed = 0;
      }
      return;
    }
    this.from = this.value;
    this.target = target;
    this.elapsed = 0;
    if (this.duration === 0) this.value = target;
  }

  get(): number {
    return this.value;
  }

  dispose(): void {
    registry.delete(this);
  }

  isActive(): boolean {
    return this.value !== this.target && this.duration > 0;
  }

  tick(dt: number): boolean {
    if (!this.isActive()) return false;
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const progress = this.duration === 0 ? 1 : this.elapsed / this.duration;
    this.value = this.from + (this.target - this.from) * applyEasing(progress, this.easing);
    if (this.elapsed >= this.duration) {
      this.value = this.target;
      return false;
    }
    return true;
  }
}

/**
 * Declaratively animate toward `target` without putting intermediate values
 * through React. Attach the result directly to translateX/Y or opacity.
 */
export function useAnimatedValue(target: number, options?: AnimatedValueOptions): AnimationValue {
  const ref = useRef<AnimatedValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new AnimatedValueImpl(target, options);
    registry.add(ref.current);
  }
  const value = ref.current;
  value.configure(target, options);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

class DampedValueImpl implements OwnedAnimationValue, TickableMotion {
  readonly presentationOnly = true;
  private value: number;
  private target: number;
  private speed = 18;
  private settleThreshold = 0.2;

  constructor(target: number, options?: DampedValueOptions) {
    this.value = options?.initialValue ?? target;
    this.target = target;
    this.configure(target, options);
  }

  configure(target: number, options?: DampedValueOptions): void {
    this.speed = Math.max(0.01, options?.speed ?? 18);
    this.settleThreshold = Math.max(0.001, options?.settleThreshold ?? 0.2);
    this.target = target;
    if (options?.immediate) this.value = target;
  }

  get(): number {
    return this.value;
  }

  dispose(): void {
    registry.delete(this);
  }

  isActive(): boolean {
    return Math.abs(this.target - this.value) > this.settleThreshold;
  }

  tick(dt: number): boolean {
    if (!this.isActive()) {
      this.value = this.target;
      return false;
    }
    const frameSeconds = Math.max(0, dt);
    this.value += (this.target - this.value) * (1 - Math.exp(-this.speed * frameSeconds));
    if (!this.isActive()) {
      this.value = this.target;
      return false;
    }
    return true;
  }
}

/**
 * Declaratively approach a presentation target without restarting a timed
 * easing curve when that target changes. This is suited to streams of small
 * input deltas such as wheel scrolling.
 */
export function useDampedValue(target: number, options?: DampedValueOptions): AnimationValue {
  const ref = useRef<DampedValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new DampedValueImpl(target, options);
    registry.add(ref.current);
  }
  const value = ref.current;
  value.configure(target, options);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

export type OscillationOptions = {
  from: number;
  to: number;
  /** Duration of one complete sine wave, in milliseconds. */
  period?: number;
  /** Starting phase in radians. */
  phase?: number;
  playing?: boolean;
  /** Window-owned, qualified presentation pacing; excluded from the legacy registry. */
  admission?: RetainedMotionAdmission;
};

class OscillationValueImpl implements OwnedAnimationValue, TickableMotion {
  readonly presentationOnly = true;
  private value = 0;
  private elapsed = 0;
  private from = 0;
  private to = 0;
  private period = 1;
  private phase = 0;
  private playing = true;
  private admission: RetainedMotionAdmission | undefined;
  private unregister: (() => void) | null = null;

  constructor(options: OscillationOptions) {
    this.configure(options);
  }

  configure(options: OscillationOptions): void {
    if (this.admission !== options.admission) {
      this.unregister?.();
      registry.delete(this);
      this.admission = options.admission;
      this.unregister = this.admission?.register(this) ?? null;
      if (!this.admission) registry.add(this);
    }
    this.from = options.from;
    this.to = options.to;
    this.period = Math.max(0.001, (options.period ?? 2_000) / 1_000);
    this.phase = options.phase ?? 0;
    this.playing = options.playing !== false;
    if (this.admission && !this.playing) this.elapsed = 0;
    this.updateValue();
  }

  private updateValue(): void {
    const center = (this.from + this.to) / 2;
    const amplitude = (this.to - this.from) / 2;
    this.value =
      center + amplitude * Math.sin((this.elapsed / this.period) * Math.PI * 2 + this.phase);
  }

  get(): number {
    return this.value;
  }

  dispose(): void {
    this.playing = false;
    this.unregister?.();
    this.unregister = null;
    registry.delete(this);
  }

  isActive(): boolean {
    return this.playing && this.from !== this.to;
  }

  reset(): boolean {
    const previous = this.value;
    this.elapsed = 0;
    this.updateValue();
    return this.value !== previous;
  }

  tick(dt: number): boolean {
    if (!this.isActive()) return false;
    this.elapsed = (this.elapsed + Math.max(0, dt)) % this.period;
    this.updateValue();
    return true;
  }
}

/** A compositor-frame-paced sine wave for paint-only presentation values. */
export function useOscillation(options: OscillationOptions): AnimationValue {
  const ref = useRef<OscillationValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new OscillationValueImpl(options);
    if (!options.admission) registry.add(ref.current);
  }
  const value = ref.current;
  value.configure(options);
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

class LoopValueImpl implements OwnedAnimationValue, TickableMotion {
  readonly presentationOnly = true;
  private value: number;
  private elapsed = 0;
  private from: number;
  private to: number;
  private duration: number;
  private easing: TweenEasing;
  private repeat: "mirror" | "loop";
  private playing: boolean;

  constructor(options: LoopOptions) {
    this.from = options.from;
    this.to = options.to;
    this.value = options.from;
    this.duration = Math.max(0.001, (options.duration ?? 1_000) / 1_000);
    this.easing = options.easing ?? "ease-in-out";
    this.repeat = options.repeat ?? "mirror";
    this.playing = options.playing !== false;
  }

  configure(options: LoopOptions): void {
    this.from = options.from;
    this.to = options.to;
    this.duration = Math.max(0.001, (options.duration ?? 1_000) / 1_000);
    this.easing = options.easing ?? "ease-in-out";
    this.repeat = options.repeat ?? "mirror";
    this.playing = options.playing !== false;
  }

  get(): number {
    return this.value;
  }

  dispose(): void {
    this.playing = false;
    registry.delete(this);
  }

  tick(dt: number): boolean {
    if (!this.playing || this.from === this.to) return false;
    this.elapsed += Math.max(0, dt);
    if (this.repeat === "loop") {
      const progress = (this.elapsed % this.duration) / this.duration;
      this.value = this.from + (this.to - this.from) * applyEasing(progress, this.easing);
      return true;
    }
    const leg = Math.floor(this.elapsed / this.duration);
    const legProgress = (this.elapsed % this.duration) / this.duration;
    const progress = leg % 2 === 0 ? legProgress : 1 - legProgress;
    this.value = this.from + (this.to - this.from) * applyEasing(progress, this.easing);
    return true;
  }

  isActive(): boolean {
    return this.playing && this.from !== this.to;
  }
}

export function createLoopValue(options: LoopOptions): OwnedAnimationValue {
  const value = new LoopValueImpl(options);
  registry.add(value);
  return value;
}

/**
 * Declarative, compositor-frame-paced repeating motion. Pass the returned
 * value directly to a presentation prop; React only rerenders when options
 * such as endpoints or `playing` change.
 */
export function useLoop(options: LoopOptions): AnimationValue {
  const ref = useRef<LoopValueImpl | null>(null);
  if (!ref.current) {
    ref.current = new LoopValueImpl(options);
    registry.add(ref.current);
  }
  const value = ref.current;
  value.configure(options);
  useEffect(
    () => () => {
      value.dispose();
    },
    [value],
  );
  return value;
}

export type MotionFrameResult = {
  active: boolean;
  presentationChanged: boolean;
  requiresReconcile: boolean;
};

export type MotionActivity = {
  active: boolean;
  presentationActive: boolean;
  reconcileActive: boolean;
};

/** Inspect newly mounted/configured animations without advancing their clocks. */
export function getMotionActivity(): MotionActivity {
  let presentationActive = false;
  let reconcileActive = false;
  for (const motion of registry) {
    if (!motion.isActive()) continue;
    if (motion.presentationOnly) presentationActive = true;
    else reconcileActive = true;
  }
  return {
    active: presentationActive || reconcileActive,
    presentationActive,
    reconcileActive,
  };
}

/** Advance all values once and classify the cheapest redraw they require. */
export function tickMotionFrame(dt: number): MotionFrameResult {
  let active = false;
  let presentationChanged = false;
  let requiresReconcile = false;
  for (const motion of registry) {
    const before = motion.get();
    const moving = motion.tick(dt);
    const changed = before !== motion.get();
    if (moving) active = true;
    if (!moving && !changed) continue;
    if (motion.presentationOnly) presentationChanged = true;
    else requiresReconcile = true;
  }
  return { active, presentationChanged, requiresReconcile };
}

/**
 * Tick all registered motion values.
 * Returns true if any value is still in motion (window should stay dirty).
 */
export function tickAllMotions(dt: number): boolean {
  return tickMotionFrame(dt).active;
}
