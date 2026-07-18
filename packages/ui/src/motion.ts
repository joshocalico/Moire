/**
 * Simple exponential-ease motion values for animated UI properties.
 * Widgets read .get() during render; window.ts calls tickAllMotions(dt) each tick.
 */
import { useEffect, useRef } from "react";

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

const registry = new Set<MotionValueImpl>();

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
