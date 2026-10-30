/**
 * Screen dimming and output power for the idle policy. Dimming is a black overlay faded over the
 * composed frame (no backlight control exists yet); power is DPMS on every output.
 *
 * While outputs are off the compositor presents nothing: the CRTCs are inactive, so a page flip
 * would fail, and clients get no frame callbacks until the screen wakes.
 */
import { ScreenFade } from "./idle-policy";

export type OutputPowerDriver<Output> = {
  outputs(): readonly Output[];
  /** DPMS on/off for one output; false when unsupported or refused. */
  setPower(output: Output, on: boolean): boolean;
  /** No page flip in flight on this output. */
  settled(output: Output): boolean;
  now(): number;
  wait(ms: number): Promise<void>;
  /** Schedule a composite (the overlay changed or the screen woke). */
  repaint(): void;
};

/** How long a pending flip may delay turning outputs off. */
const SETTLE_TIMEOUT_MS = 250;
const SETTLE_POLL_MS = 4;

export class OutputPowerControl<Output> {
  private readonly fade = new ScreenFade();
  private powered = true;
  private generation = 0;
  private dpmsSupported: boolean | null = null;

  constructor(private readonly driver: OutputPowerDriver<Output>) {}

  /** False while outputs are off; composition must not present. */
  get presenting(): boolean {
    return this.powered;
  }

  /** Whether the last power-off reached every output; null before the first attempt. */
  get supported(): boolean | null {
    return this.dpmsSupported;
  }

  /** Overlay opacity (0 none … 1 black) at this moment. */
  dimLevel(nowMs = this.driver.now()): number {
    return this.fade.value(nowMs);
  }

  /** True while the overlay is still fading; the compositor keeps drawing frames until it ends. */
  animating(nowMs = this.driver.now()): boolean {
    return this.fade.animating(nowMs);
  }

  setDim(level: number, durationMs: number): void {
    const now = this.driver.now();
    if (this.fade.target === level && !this.fade.animating(now) && this.fade.value(now) === level)
      return;
    this.fade.set(level, now, durationMs);
    this.driver.repaint();
  }

  /**
   * Turn every output off (after any in-flight flip lands) or back on. A later call supersedes an
   * earlier one still waiting, so a keypress during power-off wins.
   */
  async setPowered(on: boolean): Promise<boolean> {
    const generation = ++this.generation;
    if (on) {
      let ok = true;
      if (!this.powered) {
        for (const output of this.driver.outputs()) ok = this.driver.setPower(output, true) && ok;
      }
      this.powered = true;
      this.driver.repaint();
      return ok;
    }
    if (!this.powered) return this.dpmsSupported ?? false;
    this.powered = false;
    const deadline = this.driver.now() + SETTLE_TIMEOUT_MS;
    while (
      this.driver.outputs().some((output) => !this.driver.settled(output)) &&
      this.driver.now() < deadline
    ) {
      await this.driver.wait(SETTLE_POLL_MS);
      if (generation !== this.generation) return false;
    }
    if (generation !== this.generation) return false;
    let ok = true;
    for (const output of this.driver.outputs()) ok = this.driver.setPower(output, false) && ok;
    this.dpmsSupported = ok;
    return ok;
  }
}
