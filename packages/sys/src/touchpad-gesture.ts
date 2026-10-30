/**
 * The touchpad gesture machine: frames in, pointer motion, buttons and scrolling out. Pure and
 * clocked only by event times and `tick(now)`, so smokes drive it with synthetic or recorded
 * streams and get the same answer every run.
 *
 * Touches are classified once, when they land:
 * - palm: firmware MT_TOOL_PALM, or touch major / pressure above the palm thresholds (a touch
 *   can also become a palm later, which ends it for gestures);
 * - typing: landed within `DWT_TIMEOUT_MS` of a key press while disable-while-typing is on;
 * - edge: landed in the outer side bands of a large pad; it becomes a finger if it moves inward,
 *   so a palm resting on the edge never moves the pointer or taps;
 * - thumb: on a clickpad, landed in the button area and has not moved; it is not counted while
 *   another finger is down, so a resting thumb does not turn one-finger motion into scrolling;
 * - finger: everything else.
 *
 * Tapping (1 finger left, 2 right, 3 middle) follows libinput's shape: a tap is a touch that
 * lifts within `TAP_TIMEOUT_MS` without travelling `TAP_MOVE_MM`. A one-finger tap presses
 * the left button and holds it for `TAP_DRAG_TIMEOUT_MS`; touching again in that window and
 * moving drags, lifting quickly instead is a double click.
 *
 * Two fingers scroll (with natural direction and kinetic coasting as options), or a finger
 * that lands on the right/bottom edge scrolls when edge scrolling is chosen. One finger moves
 * the pointer through the shared pointer acceleration, in resolution-normalised units.
 *
 * Clickpads (INPUT_PROP_BUTTONPAD) report one physical button; the click method decides which
 * button it is: by where the fingers are in the bottom button area, or by how many fingers
 * are down.
 */
import {
  createPointerAccelerator,
  swapHandedButton,
  type PointerAccelerator,
  type PointerAccelProfile,
  type PointerScrollMethod,
} from "./pointer-config";
import {
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  touchpadSizeMm,
  type TouchpadFrame,
  type TouchpadGeometry,
} from "./touchpad-device";

export type TouchpadClickMethod = "areas" | "clickfinger";

export type TouchpadOptions = {
  tap: boolean;
  scrollMethod: PointerScrollMethod;
  naturalScroll: boolean;
  kineticScroll: boolean;
  clickMethod: TouchpadClickMethod;
  disableWhileTyping: boolean;
  leftHanded: boolean;
  accelSpeed: number;
  accelProfile: PointerAccelProfile;
};

export const DEFAULT_TOUCHPAD_OPTIONS: TouchpadOptions = {
  tap: true,
  scrollMethod: "two-finger",
  naturalScroll: true,
  kineticScroll: true,
  clickMethod: "clickfinger",
  disableWhileTyping: true,
  leftHanded: false,
  accelSpeed: 0,
  accelProfile: "adaptive",
};

/**
 * Motion and scroll in compositor pixels. Scroll follows wl_pointer: positive `dy` moves the
 * view down (content up), positive `dx` moves it right.
 */
export type TouchpadOutput =
  | { kind: "motion"; dx: number; dy: number; timeMs: number }
  | { kind: "button"; code: number; value: 0 | 1; timeMs: number }
  | {
      kind: "scroll";
      dx: number;
      dy: number;
      source: "finger" | "edge" | "kinetic";
      timeMs: number;
    };

// Thresholds, in millimetres and milliseconds. libinput's values where it has one.
export const TAP_TIMEOUT_MS = 180;
export const TAP_DRAG_TIMEOUT_MS = 180;
export const TAP_MOVE_MM = 1.5;
export const DWT_TIMEOUT_MS = 500;
/** Pointer units per millimetre before acceleration (about 300 dpi of finger travel). */
export const TOUCHPAD_UNITS_PER_MM = 12;
export const SCROLL_PX_PER_MM = 7;
export const SCROLL_START_MM = 1.5;
export const EDGE_SCROLL_MM = 7;
export const EDGE_SCROLL_START_MM = 2;
/** Side bands treated as possible palms, on pads at least `EDGE_PALM_MIN_WIDTH_MM` wide. */
export const EDGE_PALM_FRACTION = 0.05;
export const EDGE_PALM_MIN_WIDTH_MM = 70;
export const BUTTON_AREA_MM = 12;
export const THUMB_MOVE_MM = 2;
/** Contact size and pressure above these fractions of the axis range are palms. */
export const PALM_MAJOR_MM = 25;
export const PALM_MAJOR_FRACTION = 0.6;
export const PALM_PRESSURE_FRACTION = 0.8;
export const KINETIC_FRAME_MS = 16;
export const KINETIC_TAU_MS = 325;
export const KINETIC_START_PX_PER_MS = 0.3;
export const KINETIC_STOP_PX_PER_MS = 0.02;
/** Fingers must still have been moving this recently for a lift to start coasting. */
export const KINETIC_RECENT_MS = 50;

type TouchKind = "finger" | "palm" | "typing" | "edge" | "thumb";

type Touch = {
  key: string;
  kind: TouchKind;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  /** The farthest this touch has been from where it landed. */
  travel: number;
  /** Landed in the button area (clickpads). */
  buttonArea: boolean;
  /** Edge scroll zone it landed in, when edge scrolling is on. */
  scrollEdge: "right" | "bottom" | null;
  /** Took part in a two-finger scroll: it never moves the pointer afterwards. */
  scrolled: boolean;
  /** Counts toward tap finger totals (edge touches that became fingers do not). */
  tappable: boolean;
};

type TapState =
  | { kind: "idle" }
  | { kind: "touch"; start: number; fingers: number }
  | { kind: "tapped"; until: number }
  | { kind: "drag-or-double"; start: number }
  | { kind: "dragging" }
  | { kind: "dead" };

type Kinetic = { vx: number; vy: number; last: number };

const KEY_MODIFIERS = new Set([29, 97, 42, 54, 56, 100, 125, 126, 58]);

export class TouchpadGestures {
  private options: TouchpadOptions;
  private touches = new Map<string, Touch>();
  private tap: TapState = { kind: "idle" };
  private physical = { left: false, right: false, middle: false };
  /** The button a physical press was mapped to, released with it. */
  private pressed = new Map<"left" | "right" | "middle", number>();
  private accel: PointerAccelerator;
  private lastKey: number | null = null;
  private scrolling = false;
  private scrollTravel = 0;
  private velocity = { vx: 0, vy: 0, at: 0 };
  private kinetic: Kinetic | null = null;
  private readonly width: number;
  private readonly height: number;

  constructor(
    private readonly geometry: TouchpadGeometry,
    options: Partial<TouchpadOptions> = {},
  ) {
    this.options = { ...DEFAULT_TOUCHPAD_OPTIONS, ...options };
    this.accel = createPointerAccelerator(this.options.accelProfile, this.options.accelSpeed);
    const size = touchpadSizeMm(geometry);
    this.width = size.width;
    this.height = size.height;
  }

  get config(): Readonly<TouchpadOptions> {
    return this.options;
  }

  /** The tap machine's state, for smokes and traces. */
  get tapState(): TapState["kind"] {
    return this.tap.kind;
  }

  get coasting(): boolean {
    return this.kinetic !== null;
  }

  /** Change options; turning tapping off mid-tap releases the held tap button. */
  configure(patch: Partial<TouchpadOptions>, timeMs = 0): TouchpadOutput[] {
    const out: TouchpadOutput[] = [];
    this.options = { ...this.options, ...patch };
    if (patch.accelProfile !== undefined || patch.accelSpeed !== undefined)
      this.accel = createPointerAccelerator(this.options.accelProfile, this.options.accelSpeed);
    if (!this.options.tap && this.tapHolds()) this.releaseTap(out, timeMs, "dead");
    if (!this.options.kineticScroll) this.kinetic = null;
    return out;
  }

  /** A keyboard key; feeds disable-while-typing. Modifiers don't count, so Ctrl+click works. */
  key(code: number, value: number, timeMs: number): void {
    if (value === 0 || KEY_MODIFIERS.has(code)) return;
    this.lastKey = timeMs;
    // A touch waiting to become a tap when typing starts is a palm brushing the pad.
    if (this.options.disableWhileTyping && this.tap.kind === "touch") this.tap = { kind: "dead" };
  }

  /** When `tick` next needs to run, in event time; null when nothing is pending. */
  deadline(): number | null {
    const times: number[] = [];
    if (this.tap.kind === "tapped") times.push(this.tap.until);
    if (this.kinetic) times.push(this.kinetic.last + KINETIC_FRAME_MS);
    return times.length ? Math.min(...times) : null;
  }

  tick(now: number): TouchpadOutput[] {
    const out: TouchpadOutput[] = [];
    if (this.tap.kind === "tapped" && now >= this.tap.until)
      this.releaseTap(out, this.tap.until, "idle");
    this.coast(now, out);
    return out;
  }

  /** Release everything held (device lost, SYN_DROPPED handled by the decoder, shutdown). */
  reset(timeMs: number): TouchpadOutput[] {
    const out: TouchpadOutput[] = [];
    if (this.tapHolds()) out.push({ kind: "button", code: BTN_LEFT, value: 0, timeMs });
    for (const code of this.pressed.values()) out.push({ kind: "button", code, value: 0, timeMs });
    this.pressed.clear();
    this.physical = { left: false, right: false, middle: false };
    this.touches.clear();
    this.tap = { kind: "idle" };
    this.kinetic = null;
    this.scrolling = false;
    return out;
  }

  frame(frame: TouchpadFrame): TouchpadOutput[] {
    const out: TouchpadOutput[] = [];
    const t = frame.timeMs;
    const previous = new Map(this.touches);
    const moved = new Map<string, { dx: number; dy: number }>();
    const next = new Map<string, Touch>();
    let landed = false;

    for (const contact of frame.contacts) {
      const key = `${contact.slot}:${contact.id}`;
      const x = (contact.x - this.geometry.x.minimum) / this.geometry.x.resolution;
      const y = (contact.y - this.geometry.y.minimum) / this.geometry.y.resolution;
      const old = previous.get(key);
      const palm = contact.palm || this.isPalm(contact.major, contact.pressure);
      if (!old) {
        const touch = this.land(key, x, y, t, palm);
        next.set(key, touch);
        if (touch.kind === "finger" || touch.kind === "thumb") landed = true;
        continue;
      }
      const touch = { ...old };
      if (palm) touch.kind = "palm";
      if (touch.kind !== "palm" && touch.kind !== "typing")
        moved.set(key, { dx: x - old.x, dy: y - old.y });
      touch.x = x;
      touch.y = y;
      touch.travel = Math.max(touch.travel, Math.hypot(x - touch.startX, y - touch.startY));
      if (touch.kind === "edge" && !this.inSideBand(x)) {
        // Moved inward: a finger from here on, but its landing was not a tap.
        touch.kind = "finger";
        moved.delete(key);
      }
      if (touch.kind === "thumb" && touch.travel > THUMB_MOVE_MM) touch.kind = "finger";
      next.set(key, touch);
    }
    this.touches = next;

    if (landed) this.kinetic = null;

    // Fingers beyond the slots (BTN_TOOL_TRIPLETAP on a two-slot pad) count but don't move.
    const phantom = Math.max(0, frame.fingers - frame.contacts.length);
    const fingers = [...next.values()].filter((touch) => touch.kind === "finger");
    const thumbs = [...next.values()].filter((touch) => touch.kind === "thumb");
    // A resting thumb only counts when it is the only touch.
    const active = fingers.length ? fingers : thumbs;
    const count = active.length + (active.length ? phantom : 0);
    const tapCount =
      active.filter((touch) => touch.tappable).length + (active.length ? phantom : 0);

    this.buttons(frame, out);
    if (this.options.tap) this.tapFrame(t, tapCount, active, out);
    this.motion(t, active, count, moved, out);
    return out;
  }

  // -------------------------------------------------------------------------
  // Classification
  // -------------------------------------------------------------------------

  private isPalm(major: number | null, pressure: number | null): boolean {
    const g = this.geometry;
    if (major !== null && g.touchMajor) {
      const span = g.touchMajor.maximum - g.touchMajor.minimum;
      const mm =
        g.touchMajor.resolution > 0 ? (major - g.touchMajor.minimum) / g.touchMajor.resolution : 0;
      if (mm >= PALM_MAJOR_MM || major - g.touchMajor.minimum >= span * PALM_MAJOR_FRACTION)
        return true;
    }
    if (pressure !== null && g.pressure) {
      const span = g.pressure.maximum - g.pressure.minimum;
      if (pressure - g.pressure.minimum >= span * PALM_PRESSURE_FRACTION) return true;
    }
    return false;
  }

  private typing(t: number): boolean {
    return (
      this.options.disableWhileTyping && this.lastKey !== null && t - this.lastKey < DWT_TIMEOUT_MS
    );
  }

  private inSideBand(x: number): boolean {
    if (this.width < EDGE_PALM_MIN_WIDTH_MM) return false;
    const band = this.width * EDGE_PALM_FRACTION;
    if (x < band) return true;
    // The right edge is the scroll zone when edge scrolling is on.
    return this.options.scrollMethod !== "edge" && x > this.width - band;
  }

  private inButtonArea(y: number): boolean {
    return this.geometry.clickpad && y > this.height - BUTTON_AREA_MM;
  }

  private land(key: string, x: number, y: number, t: number, palm: boolean): Touch {
    const buttonArea = this.inButtonArea(y);
    let scrollEdge: Touch["scrollEdge"] = null;
    if (this.options.scrollMethod === "edge") {
      if (x > this.width - EDGE_SCROLL_MM) scrollEdge = "right";
      // Clickpads click in the bottom band, so it can't also scroll sideways.
      else if (!this.geometry.clickpad && y > this.height - EDGE_SCROLL_MM) scrollEdge = "bottom";
    }
    const kind: TouchKind = palm
      ? "palm"
      : this.typing(t)
        ? "typing"
        : scrollEdge === null && this.inSideBand(x)
          ? "edge"
          : buttonArea
            ? "thumb"
            : "finger";
    return {
      key,
      kind,
      x,
      y,
      startX: x,
      startY: y,
      startTime: t,
      travel: 0,
      buttonArea,
      scrollEdge,
      scrolled: false,
      tappable: kind === "finger" || kind === "thumb",
    };
  }

  // -------------------------------------------------------------------------
  // Buttons
  // -------------------------------------------------------------------------

  private buttons(frame: TouchpadFrame, out: TouchpadOutput[]): void {
    const t = frame.timeMs;
    for (const name of ["left", "right", "middle"] as const) {
      const down = frame.buttons[name];
      if (down === this.physical[name]) continue;
      this.physical[name] = down;
      if (down) {
        // A physical click ends any tap in progress: release a held tap button first.
        if (this.tapHolds()) this.releaseTap(out, t, "dead");
        else if (this.tap.kind !== "idle") this.tap = { kind: "dead" };
        const code = swapHandedButton(this.mapButton(name), this.options.leftHanded);
        this.pressed.set(name, code);
        out.push({ kind: "button", code, value: 1, timeMs: t });
      } else {
        const code = this.pressed.get(name);
        this.pressed.delete(name);
        if (code !== undefined) out.push({ kind: "button", code, value: 0, timeMs: t });
      }
    }
  }

  private mapButton(name: "left" | "right" | "middle"): number {
    if (!this.geometry.clickpad || name !== "left")
      return name === "left" ? BTN_LEFT : name === "right" ? BTN_RIGHT : BTN_MIDDLE;
    const touches = [...this.touches.values()].filter((touch) => touch.kind !== "palm");
    if (this.options.clickMethod === "clickfinger") {
      // A thumb resting in the button area doesn't turn a one-finger click into a right click.
      const counted = touches.filter((touch) => touch.kind !== "thumb");
      const fingers = Math.max(1, counted.length || touches.length);
      return fingers >= 3 ? BTN_MIDDLE : fingers === 2 ? BTN_RIGHT : BTN_LEFT;
    }
    const inArea = touches.filter((touch) => this.inButtonArea(touch.y));
    const right = inArea.some((touch) => touch.x > this.width / 2);
    const left = inArea.some((touch) => touch.x <= this.width / 2);
    return right && left ? BTN_MIDDLE : right ? BTN_RIGHT : BTN_LEFT;
  }

  // -------------------------------------------------------------------------
  // Tapping
  // -------------------------------------------------------------------------

  /** Whether the tap machine is holding BTN_LEFT down. */
  private tapHolds(): boolean {
    return (
      this.tap.kind === "tapped" ||
      this.tap.kind === "drag-or-double" ||
      this.tap.kind === "dragging"
    );
  }

  private releaseTap(out: TouchpadOutput[], t: number, then: "idle" | "dead"): void {
    if (this.tapHolds()) out.push({ kind: "button", code: BTN_LEFT, value: 0, timeMs: t });
    this.tap = { kind: then };
  }

  private tapFrame(t: number, count: number, active: Touch[], out: TouchpadOutput[]): void {
    const travelled = active.some((touch) => touch.travel > TAP_MOVE_MM);
    const tap = this.tap;
    switch (tap.kind) {
      case "idle":
        if (count > 0) this.tap = { kind: "touch", start: t, fingers: count };
        return;
      case "dead":
        if (count === 0) this.tap = { kind: "idle" };
        return;
      case "touch": {
        if (count === 0) {
          if (t - tap.start > TAP_TIMEOUT_MS) {
            this.tap = { kind: "idle" };
            return;
          }
          const code =
            tap.fingers >= 3 ? BTN_MIDDLE : tap.fingers === 2 ? BTN_RIGHT : BTN_LEFT;
          out.push({ kind: "button", code, value: 1, timeMs: t });
          if (code === BTN_LEFT) {
            this.tap = { kind: "tapped", until: t + TAP_DRAG_TIMEOUT_MS };
            return;
          }
          out.push({ kind: "button", code, value: 0, timeMs: t });
          this.tap = { kind: "idle" };
          return;
        }
        if (travelled || t - tap.start > TAP_TIMEOUT_MS) this.tap = { kind: "dead" };
        else this.tap = { kind: "touch", start: tap.start, fingers: Math.max(tap.fingers, count) };
        return;
      }
      case "tapped":
        if (t >= tap.until) {
          // The timer did not run before this frame; same outcome as if it had.
          this.releaseTap(out, tap.until, "idle");
          this.tapFrame(t, count, active, out);
          return;
        }
        if (count === 1) this.tap = { kind: "drag-or-double", start: t };
        else if (count > 1) {
          this.releaseTap(out, t, "idle");
          this.tap = { kind: "touch", start: t, fingers: count };
        }
        return;
      case "drag-or-double":
        if (count === 0) {
          // Lifted again quickly without moving: a double click.
          out.push({ kind: "button", code: BTN_LEFT, value: 0, timeMs: t });
          out.push({ kind: "button", code: BTN_LEFT, value: 1, timeMs: t });
          out.push({ kind: "button", code: BTN_LEFT, value: 0, timeMs: t });
          this.tap = { kind: "idle" };
        } else if (count > 1) this.releaseTap(out, t, "dead");
        else if (travelled || t - tap.start > TAP_TIMEOUT_MS) this.tap = { kind: "dragging" };
        return;
      case "dragging":
        if (count === 0) this.releaseTap(out, t, "idle");
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Motion and scrolling
  // -------------------------------------------------------------------------

  private motion(
    t: number,
    active: Touch[],
    count: number,
    moved: Map<string, { dx: number; dy: number }>,
    out: TouchpadOutput[],
  ): void {
    const dragging = this.tap.kind === "drag-or-double" || this.tap.kind === "dragging";
    const twoFinger =
      this.options.scrollMethod === "two-finger" && count >= 2 && !dragging && active.length >= 1;
    if (!twoFinger) this.endScroll(t);

    // Edge scrolling: one finger that landed in an edge zone scrolls along it.
    if (active.length === 1 && active[0]!.scrollEdge && count === 1) {
      const touch = active[0]!;
      const delta = moved.get(touch.key);
      const along =
        touch.scrollEdge === "right" ? touch.y - touch.startY : touch.x - touch.startX;
      if (delta && Math.abs(along) >= EDGE_SCROLL_START_MM) {
        const px = (touch.scrollEdge === "right" ? delta.dy : delta.dx) * SCROLL_PX_PER_MM;
        const sign = this.options.naturalScroll ? -1 : 1;
        if (px)
          out.push({
            kind: "scroll",
            dx: touch.scrollEdge === "bottom" ? sign * px : 0,
            dy: touch.scrollEdge === "right" ? sign * px : 0,
            source: "edge",
            timeMs: t,
          });
      }
      return;
    }

    if (twoFinger) {
      const deltas = active.slice(0, 2).map((touch) => moved.get(touch.key));
      for (const touch of active) touch.scrolled = true;
      if (deltas.some((delta) => !delta)) return; // A finger just landed: no reference yet.
      const dx = (deltas[0]!.dx + deltas[1]!.dx) / 2;
      const dy = (deltas[0]!.dy + deltas[1]!.dy) / 2;
      this.scrollTravel += Math.hypot(dx, dy);
      if (!this.scrolling && this.scrollTravel < SCROLL_START_MM) return;
      this.scrolling = true;
      // Snap to the dominant axis so a vertical swipe doesn't drift sideways.
      const sx = Math.abs(dx) < Math.abs(dy) * 0.3 ? 0 : dx;
      const sy = Math.abs(dy) < Math.abs(dx) * 0.3 ? 0 : dy;
      const sign = this.options.naturalScroll ? -1 : 1;
      const px = { dx: sign * sx * SCROLL_PX_PER_MM, dy: sign * sy * SCROLL_PX_PER_MM };
      if (!px.dx && !px.dy) return;
      out.push({ kind: "scroll", ...px, source: "finger", timeMs: t });
      const dt = Math.max(1, t - (this.velocity.at || t - KINETIC_FRAME_MS));
      this.velocity = {
        vx: 0.5 * this.velocity.vx + 0.5 * (px.dx / dt),
        vy: 0.5 * this.velocity.vy + 0.5 * (px.dy / dt),
        at: t,
      };
      return;
    }

    // Pointer motion from the finger that moved most; scroll fingers never move the pointer.
    let best: { dx: number; dy: number } | null = null;
    for (const touch of active) {
      if (touch.scrolled || touch.scrollEdge) continue;
      const delta = moved.get(touch.key);
      if (delta && (!best || Math.hypot(delta.dx, delta.dy) > Math.hypot(best.dx, best.dy)))
        best = delta;
    }
    if (!best || (!best.dx && !best.dy)) return;
    const motion = this.accel.filter(
      best.dx * TOUCHPAD_UNITS_PER_MM,
      best.dy * TOUCHPAD_UNITS_PER_MM,
      t,
    );
    if (motion.dx || motion.dy) out.push({ kind: "motion", dx: motion.dx, dy: motion.dy, timeMs: t });
  }

  private endScroll(t: number): void {
    if (this.scrolling && this.options.kineticScroll && t - this.velocity.at <= KINETIC_RECENT_MS) {
      const { vx, vy } = this.velocity;
      if (Math.hypot(vx, vy) >= KINETIC_START_PX_PER_MS) this.kinetic = { vx, vy, last: t };
    }
    this.scrolling = false;
    this.scrollTravel = 0;
    this.velocity = { vx: 0, vy: 0, at: 0 };
  }

  private coast(now: number, out: TouchpadOutput[]): void {
    const kinetic = this.kinetic;
    if (!kinetic || now < kinetic.last + KINETIC_FRAME_MS) return;
    const dt = now - kinetic.last;
    const decay = Math.exp(-dt / KINETIC_TAU_MS);
    // Distance over the interval of an exponentially decaying velocity.
    const factor = KINETIC_TAU_MS * (1 - decay);
    out.push({
      kind: "scroll",
      dx: kinetic.vx * factor,
      dy: kinetic.vy * factor,
      source: "kinetic",
      timeMs: now,
    });
    const vx = kinetic.vx * decay;
    const vy = kinetic.vy * decay;
    this.kinetic = Math.hypot(vx, vy) < KINETIC_STOP_PX_PER_MS ? null : { vx, vy, last: now };
  }
}
