/**
 * Simple exponential-ease motion values for animated UI properties.
 * Widgets read .get() during render; window.ts calls tickAllMotions(dt) each tick.
 */
import { useEffect, useRef, type ReactNode } from "react";

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

type TickableMotion = { tick(dt: number): boolean };

const registry = new Set<TickableMotion>();

class MotionValueImpl implements MotionValue {
  private _value: number;
  target: number;
  _speed: number;

  constructor(initial: number, speed?: number) {
    this._value = initial;
    this.target = initial;
    this._speed = speed ?? DEFAULT_SPEED;
  }

  get(): number {
    return this._value;
  }

  set(v: number): void {
    this._value = v;
    this.target = v;
  }

  tick(dt: number): boolean {
    const diff = this.target - this._value;
    if (Math.abs(diff) < SETTLE_PX) {
      this._value = this.target;
      return false;
    }
    this._value += diff * (1 - Math.exp(-this._speed * dt));
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
  useEffect(() => () => {
    registry.delete(value);
  }, [value]);
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

  constructor(initial: number) {
    this.value = initial;
    this.from = initial;
    this.target = initial;
  }

  get(): number {
    return this.value;
  }

  set(value: number): void {
    this.value = value;
    this.from = value;
    this.target = value;
    this.elapsed = this.duration;
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
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt));
    const progress = this.elapsed / this.duration;
    this.value = this.from + (this.target - this.from) * applyEasing(progress, this.easing);
    if (this.elapsed >= this.duration) {
      this.value = this.target;
      return false;
    }
    return true;
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
  useEffect(() => () => {
    registry.delete(value);
  }, [value]);
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

/**
 * Tick all registered motion values.
 * Returns true if any value is still in motion (window should stay dirty).
 */
export function tickAllMotions(dt: number): boolean {
  let anyMoving = false;
  for (const mv of registry) {
    if (mv.tick(dt)) anyMoving = true;
  }
  return anyMoving;
}
