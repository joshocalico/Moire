/**
 * The compositor's session lock as a pure state machine: locked or not, the password being typed,
 * the authentication round trip, and which locked frame has reached the screen.
 *
 * Fail closed: the compositor reads `locked` on every frame and every input event, and nothing
 * here can unlock except a successful authentication or an explicit `unlock("logind")`. A lock UI
 * that throws only changes how the locked screen is drawn, never whether it is locked.
 *
 * The password lives in one fixed byte buffer that is wiped as soon as it is submitted (and on
 * unlock); the UI only ever sees its length. Time and timers are injected for smokes.
 */
import { systemIdleTimers, type IdleTimers } from "./idle-policy";

export type LockReason = "idle" | "suspend" | "request" | "shortcut" | "logind" | "dbus";
export type UnlockReason = "authenticated" | "logind";

export type LockAuthVerdict = "ok" | "wrong" | "rate_limited" | "unavailable";
export type LockAuthResult = Readonly<{
  verdict: LockAuthVerdict;
  /** With rate_limited: how long until checks are allowed again. */
  retryInMs?: number | null;
}>;
/** Check the session user's password. Must not keep or log `secret`; it is wiped afterwards. */
export type LockAuthenticator = (secret: Uint8Array) => Promise<LockAuthResult>;

/** What the password field shows. */
export type LockEntryPhase = "entry" | "checking" | "wrong" | "rate-limited" | "unavailable";

export type LockScreenAction = "suspend" | "reboot" | "power-off";

/** The state the lock UI draws. It carries the password's length, never its bytes. */
export type LockScreenView = Readonly<{
  /** Changes whenever anything below changes. */
  revision: number;
  user: Readonly<{ name: string; username: string }>;
  /** Characters typed (code points). */
  length: number;
  phase: LockEntryPhase;
  /** With rate-limited: wall-clock ms (Date.now) when the user may try again. */
  retryAtMs: number | null;
  /** Failed attempts since this lock began (a new one restarts any "wrong" feedback). */
  failures: number;
  capsLock: boolean;
  /** The active keyboard layout, when the session has more than one. */
  layout: Readonly<{ label: string; name: string }> | null;
  /** Power actions logind allows this session without authentication. */
  power: Readonly<{ suspend: boolean; powerOff: boolean; reboot: boolean }>;
  reducedMotion: boolean;
}>;

const KEY_ESC = 1;
const KEY_BACKSPACE = 14;
const KEY_ENTER = 28;
const KEY_U = 22;
const KEY_KPENTER = 96;
/** Longest password accepted, in UTF-8 bytes; pam_unix truncates far earlier (PAM_MAX_RESP_SIZE). */
export const LOCK_PASSWORD_CAPACITY = 512;

export type SessionLockOptions = {
  authenticate?: LockAuthenticator;
  timers?: IdleTimers;
  /** Wall clock for retryAtMs; Date.now by default. */
  wallNow?: () => number;
  /** Anything the view shows changed (or the lock state did). */
  changed?: () => void;
};

export class SessionLock {
  private authenticate: LockAuthenticator | null;
  private readonly timers: IdleTimers;
  private readonly wallNow: () => number;
  private isLocked = false;
  private lockEpoch = 0;
  private presented = 0;
  private generation = 0;
  private readonly buffer = new Uint8Array(LOCK_PASSWORD_CAPACITY);
  private used = 0;
  private phase: LockEntryPhase = "entry";
  private retryAtMs: number | null = null;
  private cancelRetry: (() => void) | null = null;
  private failures = 0;
  private viewRevision = 0;
  private reason: LockReason | null = null;
  private readonly waiters: { epoch: number; resolve: (presented: boolean) => void }[] = [];
  private readonly lockListeners = new Set<(locked: boolean, reason: string) => void>();

  constructor(private readonly options: SessionLockOptions = {}) {
    this.authenticate = options.authenticate ?? null;
    this.timers = options.timers ?? systemIdleTimers;
    this.wallNow = options.wallNow ?? Date.now;
  }

  get locked(): boolean {
    return this.isLocked;
  }

  /** Increments with every lock; a frame drawn locked at epoch N proves lock N is on screen. */
  get epoch(): number {
    return this.lockEpoch;
  }

  get presentedEpoch(): number {
    return this.presented;
  }

  get lockReason(): LockReason | null {
    return this.reason;
  }

  get revision(): number {
    return this.viewRevision;
  }

  setAuthenticator(authenticate: LockAuthenticator | null): void {
    this.authenticate = authenticate;
  }

  onLockedChanged(listener: (locked: boolean, reason: string) => void): () => void {
    this.lockListeners.add(listener);
    return () => this.lockListeners.delete(listener);
  }

  /** Lock now. False when already locked (the existing lock stands). */
  lock(reason: LockReason): boolean {
    if (this.isLocked) return false;
    this.isLocked = true;
    this.reason = reason;
    this.lockEpoch++;
    this.generation++;
    this.wipe();
    this.phase = "entry";
    this.failures = 0;
    this.setRetry(null);
    this.bump();
    for (const listener of [...this.lockListeners]) listener(true, reason);
    return true;
  }

  /** Only a verified password or logind's Unlock (the session owner or root asked) gets here. */
  unlock(reason: UnlockReason): boolean {
    if (!this.isLocked) return false;
    this.isLocked = false;
    this.reason = null;
    this.generation++;
    this.wipe();
    this.phase = "entry";
    this.setRetry(null);
    // Nothing waiting for a locked frame will get one now.
    for (const waiter of this.waiters.splice(0)) waiter.resolve(false);
    this.bump();
    for (const listener of [...this.lockListeners]) listener(false, reason);
    return true;
  }

  /**
   * One key edge while locked. `text` is the UTF-8 this press produces in the current keyboard
   * state (empty for keys without text); the caller wipes its own copy afterwards.
   */
  key(
    code: number,
    value: number,
    text: Uint8Array,
    modifiers: { ctrl: boolean; meta?: boolean },
  ): void {
    if (!this.isLocked || value === 0) return;
    if (code === KEY_ENTER || code === KEY_KPENTER) {
      if (value === 1) this.submit();
      return;
    }
    if (this.phase === "checking") return;
    if (code === KEY_ESC || (modifiers.ctrl && code === KEY_U)) {
      if (value === 1 && this.used > 0) {
        this.wipe();
        this.settleFeedback();
        this.bump();
      }
      return;
    }
    if (code === KEY_BACKSPACE) {
      if (this.used === 0) return;
      // Drop one code point: back over UTF-8 continuation bytes to its lead byte.
      let end = this.used - 1;
      while (end > 0 && (this.buffer[end]! & 0xc0) === 0x80) end--;
      this.buffer.fill(0, end, this.used);
      this.used = end;
      this.settleFeedback();
      this.bump();
      return;
    }
    // Shortcuts (Ctrl, Super) never type into the password.
    if (modifiers.ctrl || modifiers.meta || text.length === 0 || !printable(text)) return;
    if (this.used + text.length > this.buffer.length) return;
    this.buffer.set(text, this.used);
    this.used += text.length;
    this.settleFeedback();
    this.bump();
  }

  /** Check what was typed. The typed bytes are wiped now; the copy handed out is wiped after. */
  submit(): void {
    if (!this.isLocked || this.phase === "checking" || this.used === 0) return;
    if (this.phase === "rate-limited") return;
    const authenticate = this.authenticate;
    const secret = this.buffer.slice(0, this.used);
    this.wipe();
    if (!authenticate) {
      secret.fill(0);
      this.phase = "unavailable";
      this.bump();
      return;
    }
    const generation = this.generation;
    this.phase = "checking";
    this.bump();
    let pending: Promise<LockAuthResult>;
    try {
      pending = authenticate(secret);
    } catch {
      pending = Promise.resolve({ verdict: "unavailable" });
    }
    void pending
      .catch((): LockAuthResult => ({ verdict: "unavailable" }))
      .then((result) => {
        secret.fill(0);
        // Unlocked (logind) or relocked meanwhile: this answer belongs to a finished lock.
        if (generation !== this.generation || !this.isLocked) return;
        switch (result.verdict) {
          case "ok":
            this.unlock("authenticated");
            return;
          case "wrong":
            this.failures++;
            this.phase = "wrong";
            break;
          case "rate_limited": {
            const wait = Math.max(1000, result.retryInMs ?? 60_000);
            this.phase = "rate-limited";
            this.setRetry(wait);
            break;
          }
          default:
            this.phase = "unavailable";
        }
        this.bump();
      });
  }

  /** The view without the per-session extras (user, keyboard, power) the compositor adds. */
  entry(): Pick<LockScreenView, "revision" | "length" | "phase" | "retryAtMs" | "failures"> {
    let length = 0;
    for (let index = 0; index < this.used; index++)
      if ((this.buffer[index]! & 0xc0) !== 0x80) length++;
    return {
      revision: this.viewRevision,
      length,
      phase: this.phase,
      retryAtMs: this.retryAtMs,
      failures: this.failures,
    };
  }

  /** Bytes currently typed (for smokes asserting the buffer is wiped). */
  typedBytes(): number {
    return this.used;
  }

  /** Something outside this machine that the view shows changed (caps lock, layout, power). */
  touch(): void {
    if (this.isLocked) this.bump();
  }

  /**
   * Resolves true once a frame drawn for the current lock has been presented (or there is no
   * screen to present on), false if the lock ended first. Already locked and presented: at once.
   */
  whenPresented(): Promise<boolean> {
    if (!this.isLocked) return Promise.resolve(false);
    if (this.presented >= this.lockEpoch) return Promise.resolve(true);
    return new Promise((resolve) => this.waiters.push({ epoch: this.lockEpoch, resolve }));
  }

  /** The compositor presented a frame it drew while locked at `epoch`. */
  markPresented(epoch: number): void {
    if (!this.isLocked || epoch !== this.lockEpoch || epoch <= this.presented) return;
    this.presented = epoch;
    for (let index = this.waiters.length - 1; index >= 0; index--) {
      if (this.waiters[index]!.epoch > epoch) continue;
      this.waiters.splice(index, 1)[0]!.resolve(true);
    }
  }

  dispose(): void {
    this.wipe();
    this.setRetry(null);
    for (const waiter of this.waiters.splice(0)) waiter.resolve(false);
  }

  private wipe(): void {
    this.buffer.fill(0);
    this.used = 0;
  }

  /** Typing again clears a "wrong" or "unavailable" notice; a lockout stays until it ends. */
  private settleFeedback(): void {
    if (this.phase === "wrong" || this.phase === "unavailable") this.phase = "entry";
  }

  private setRetry(delayMs: number | null): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.retryAtMs = null;
    if (delayMs === null) return;
    this.retryAtMs = this.wallNow() + delayMs;
    const generation = this.generation;
    this.cancelRetry = this.timers.schedule(delayMs, () => {
      this.cancelRetry = null;
      if (generation !== this.generation || this.phase !== "rate-limited") return;
      this.retryAtMs = null;
      this.phase = "entry";
      this.bump();
    });
  }

  private bump(): void {
    this.viewRevision++;
    this.options.changed?.();
  }
}

/** No C0 controls or DEL: Enter, Tab, Escape and Ctrl+letter never become password bytes. */
function printable(text: Uint8Array): boolean {
  for (const byte of text) if (byte < 0x20 || byte === 0x7f) return false;
  return true;
}
