/**
 * The compositor's secure prompt as a pure state machine: one modal, compositor-owned question
 * at a time (a password for the polkit agent, later the keyring's unlock and consent), the
 * requests waiting behind it, and the answer being typed.
 *
 * Fail closed: every way out other than an accepted answer (or an allowed consent) resolves the
 * request as not granted, and a verdict that arrives after its prompt ended is dropped. A prompt
 * is never visible while the session is locked.
 *
 * The answer lives in one fixed byte buffer, as on the lock screen: wiped on submit, cancel,
 * identity change, timeout and lock, and the UI only ever sees its length. Time and timers are
 * injected for smokes. See docs/polkit-agent.md.
 */
import { systemIdleTimers, type IdleTimers } from "./idle-policy";
import type {
  SecurePromptDetail,
  SecurePromptHandle,
  SecurePromptIdentity,
  SecurePromptOutcome,
  SecurePromptRequest,
  SecurePromptRequester,
  SecurePromptResult,
  SecurePrompts,
  SecurePromptVerdict,
} from "./secure-prompt-types";

/** What the answer field shows. */
export type SecurePromptPhase = "entry" | "checking" | "wrong" | "throttled" | "unavailable";

/** A choice made with the pointer in the prompt's UI. */
export type SecurePromptAction =
  | { type: "cancel" }
  | { type: "submit" }
  | { type: "identity"; index: number }
  | { type: "allow" }
  | { type: "deny" };

/** The state the prompt UI draws. It carries the answer's length, never its bytes. */
export type SecurePromptEntry = Readonly<{
  /** Changes whenever anything below changes. */
  revision: number;
  /** A new number for every prompt shown. */
  id: number;
  kind: "password" | "consent";
  headline: string;
  requester: SecurePromptRequester | null;
  identities: readonly SecurePromptIdentity[];
  selected: number;
  needsAdministrator: boolean;
  details: readonly SecurePromptDetail[];
  /** Characters typed (code points). */
  length: number;
  phase: SecurePromptPhase;
  /** Rejected answers on this prompt (a new one restarts the shake). */
  failures: number;
  /** Requests waiting behind this one. */
  waiting: number;
  /** Times the verification key was pressed on this prompt (a new one pulses the badge). */
  verifications: number;
}>;

/** The entry plus what the compositor adds for its session (keyboard, motion). */
export type SecurePromptView = SecurePromptEntry &
  Readonly<{
    /** True for a moment after the verification key. */
    pulsing: boolean;
    capsLock: boolean;
    layout: Readonly<{ label: string; name: string }> | null;
    reducedMotion: boolean;
  }>;

const KEY_ESC = 1;
const KEY_BACKSPACE = 14;
const KEY_ENTER = 28;
const KEY_U = 22;
const KEY_KPENTER = 96;
const KEY_UP = 103;
const KEY_DOWN = 108;

/** Longest answer accepted, in UTF-8 bytes (the lock screen's limit, and the helper's). */
export const SECURE_PROMPT_CAPACITY = 512;
/** Keys and clicks count this long after a prompt appears. */
export const SECURE_PROMPT_ARMING_MS = 400;
/** A prompt nobody touches is cancelled after this. */
export const SECURE_PROMPT_IDLE_MS = 120_000;
/** A request waits behind another prompt, or behind the lock, at most this long. */
export const SECURE_PROMPT_WAIT_MS = 120_000;
/** Requests that may wait behind the visible one. */
export const SECURE_PROMPT_QUEUE_LIMIT = 3;
/**
 * After a cancel, the same requester and action are refused this long. Short on purpose: it
 * answers the requests already queued behind the cancelled one and a requester that retries
 * at once, but a person who cancelled by mistake and clicks again gets their prompt.
 */
export const SECURE_PROMPT_COOL_DOWN_MS = 2_000;
/** Three cancels of one requester within this window, whatever it asked for, are a flood. */
export const SECURE_PROMPT_FLOOD_WINDOW_MS = 120_000;
export const SECURE_PROMPT_FLOOD_CANCELS = 3;
/** A flood refuses that requester, for every action, this long. */
export const SECURE_PROMPT_FLOOD_COOL_DOWN_MS = 300_000;
export const SECURE_PROMPT_MAX_IDENTITIES = 8;
const MAX_DETAILS = 8;
const MAX_COOL_DOWN_KEYS = 64;

export type SecurePromptQueueOptions = {
  timers?: IdleTimers;
  /** Anything a view shows changed. */
  changed?: () => void;
  /** A prompt became visible, or none is any more. Called before the request's result settles. */
  shown?: (visible: boolean) => void;
  /** A requester kept asking after being cancelled; called once per flood. */
  flood?: (requester: SecurePromptRequester | null) => void;
};

type Pending = {
  id: number;
  request: SecurePromptRequest;
  resolve(result: SecurePromptResult): void;
  settled: boolean;
  cancelWait: (() => void) | null;
};

type Flood = { cancels: number[]; until: number };

export class SecurePromptQueue implements SecurePrompts {
  private readonly timers: IdleTimers;
  private current: Pending | null = null;
  private readonly queue: Pending[] = [];
  private locked = false;
  private disposed = false;
  private announced = false;
  private nextId = 1;
  private generation = 0;
  private readonly buffer = new Uint8Array(SECURE_PROMPT_CAPACITY);
  private used = 0;
  private phase: SecurePromptPhase = "entry";
  private failures = 0;
  private selected = 0;
  private verifications = 0;
  private shownAtMs = 0;
  private lastActivityMs = 0;
  private cancelIdle: (() => void) | null = null;
  /** Keys pressed since this prompt armed; a key held from before is never in here. */
  private readonly fresh = new Set<number>();
  /** The short cool-down's end, by `coolDownKey`. */
  private readonly coolDowns = new Map<string, number>();
  /** Recent cancels and the flood pause, by requester. */
  private readonly floods = new Map<string, Flood>();
  private viewRevision = 0;

  constructor(private readonly options: SecurePromptQueueOptions = {}) {
    this.timers = options.timers ?? systemIdleTimers;
  }

  /** A prompt is up (never while locked). */
  get visible(): boolean {
    return this.current !== null;
  }

  get revision(): number {
    return this.viewRevision;
  }

  /** Requests waiting behind the visible prompt or the lock. */
  get waiting(): number {
    return this.queue.length;
  }

  request(request: SecurePromptRequest): SecurePromptHandle {
    const clean = sanitize(request);
    if (
      this.disposed ||
      !clean ||
      this.coolingDown(clean) ||
      (this.current ? 1 : 0) + this.queue.length > SECURE_PROMPT_QUEUE_LIMIT
    )
      return { result: Promise.resolve({ outcome: "refused" }), cancel() {} };
    let resolve!: (result: SecurePromptResult) => void;
    const result = new Promise<SecurePromptResult>((done) => (resolve = done));
    const pending: Pending = {
      id: this.nextId++,
      request: clean,
      resolve,
      settled: false,
      cancelWait: null,
    };
    if (!this.current && !this.locked) this.show(pending);
    else {
      this.queue.push(pending);
      pending.cancelWait = this.timers.schedule(SECURE_PROMPT_WAIT_MS, () => {
        pending.cancelWait = null;
        this.withdraw(pending, "timed-out");
      });
      this.bump();
    }
    return { result, cancel: () => this.withdraw(pending, "cancelled") };
  }

  /**
   * One key edge while a prompt is up. `text` is the UTF-8 this press produces in the current
   * keyboard state (empty for keys without text); the caller wipes its own copy afterwards.
   */
  key(
    code: number,
    value: number,
    text: Uint8Array,
    modifiers: { ctrl: boolean; meta?: boolean },
  ): void {
    const pending = this.current;
    if (!pending) return;
    if (value === 0) {
      this.fresh.delete(code);
      return;
    }
    // Only a press made after the arming delay counts, and only its own repeats after it.
    if (value === 1) {
      if (!this.armed()) return;
      this.fresh.add(code);
    } else if (!this.fresh.has(code)) return;
    this.activity();
    if (code === KEY_ESC) {
      if (value === 1) this.userCancel();
      return;
    }
    // Consent is given with the pointer: a stray Enter never allows anything.
    if (pending.request.kind !== "password") return;
    if (code === KEY_ENTER || code === KEY_KPENTER) {
      if (value === 1) this.submit();
      return;
    }
    if (this.phase === "checking") return;
    if (code === KEY_UP || code === KEY_DOWN) {
      this.selectIdentity(this.selected + (code === KEY_UP ? -1 : 1));
      return;
    }
    if (modifiers.ctrl && code === KEY_U) {
      if (value === 1 && this.used > 0) {
        this.wipe();
        this.phase = "entry";
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
      this.phase = "entry";
      this.bump();
      return;
    }
    // Shortcuts (Ctrl, Super) never type into the answer.
    if (modifiers.ctrl || modifiers.meta || text.length === 0 || !printable(text)) return;
    if (this.used + text.length > this.buffer.length) return;
    this.buffer.set(text, this.used);
    this.used += text.length;
    this.phase = "entry";
    this.bump();
  }

  /** A choice from the prompt's UI. Ignored until the prompt is armed, like keys. */
  action(action: SecurePromptAction): void {
    const pending = this.current;
    if (!pending || !this.armed()) return;
    this.activity();
    switch (action.type) {
      case "cancel":
      case "deny":
        this.userCancel();
        return;
      case "submit":
        this.submit();
        return;
      case "allow":
        if (pending.request.kind === "consent") this.finish("completed");
        return;
      case "identity":
        this.selectIdentity(action.index);
    }
  }

  /** Pointer or key activity on the prompt: the idle timeout starts over. */
  activity(): void {
    if (this.current) this.lastActivityMs = this.timers.now();
  }

  /**
   * The verification key. True when a prompt is up (its badge pulses); false tells the caller
   * that no request is open.
   */
  verify(): boolean {
    if (!this.current) return false;
    this.verifications++;
    this.activity();
    this.bump();
    return true;
  }

  /** The session locked or unlocked. Locking ends the visible prompt and holds the queue. */
  setLocked(locked: boolean): void {
    if (this.locked === locked) return;
    this.locked = locked;
    if (locked) {
      if (this.current) this.finish("locked");
    } else if (!this.current) this.advance();
  }

  /** Neither the shell's view nor the compositor's own painter could draw the prompt. */
  drawFailed(): void {
    if (this.current) this.finish("failed");
  }

  /** Null when no prompt is up. */
  entry(): SecurePromptEntry | null {
    const pending = this.current;
    if (!pending) return null;
    let length = 0;
    for (let index = 0; index < this.used; index++)
      if ((this.buffer[index]! & 0xc0) !== 0x80) length++;
    const { request } = pending;
    return {
      revision: this.viewRevision,
      id: pending.id,
      kind: request.kind,
      headline: request.headline,
      requester: request.requester,
      identities: request.identities,
      selected: this.selected,
      needsAdministrator: request.needsAdministrator,
      details: request.details,
      length,
      phase: this.phase,
      failures: this.failures,
      waiting: this.queue.length,
      verifications: this.verifications,
    };
  }

  /** Bytes currently typed (for smokes asserting the buffer is wiped). */
  typedBytes(): number {
    return this.used;
  }

  /** Something outside this machine that the view shows changed (caps lock, layout). */
  touch(): void {
    if (this.current) this.bump();
  }

  /** Every request ends as cancelled; nothing is shown again. */
  dispose(): void {
    this.disposed = true;
    for (const pending of this.queue.splice(0)) this.settle(pending, "cancelled");
    if (this.current) this.finish("cancelled");
    this.wipe();
  }

  private armed(): boolean {
    return this.timers.now() - this.shownAtMs >= SECURE_PROMPT_ARMING_MS;
  }

  private show(pending: Pending): void {
    pending.cancelWait?.();
    pending.cancelWait = null;
    this.current = pending;
    this.generation++;
    this.wipe();
    this.fresh.clear();
    this.phase = "entry";
    this.failures = 0;
    this.verifications = 0;
    this.selected = pending.request.selected;
    this.shownAtMs = this.lastActivityMs = this.timers.now();
    this.armIdle(SECURE_PROMPT_IDLE_MS);
    this.announce(true);
    this.bump();
  }

  /** Escape, Cancel or Deny: the requester's cool-down starts. */
  private userCancel(): void {
    const pending = this.current;
    if (!pending) return;
    this.noteCancel(pending);
    this.finish("cancelled");
  }

  private selectIdentity(index: number): void {
    const pending = this.current;
    if (!pending || pending.request.kind !== "password" || this.phase === "checking") return;
    if (index < 0 || index >= pending.request.identities.length || index === this.selected) return;
    // What was typed was meant for the other account.
    this.wipe();
    this.selected = index;
    this.phase = "entry";
    this.bump();
  }

  /** Check what was typed. The typed bytes are wiped now; the copy handed out is wiped after. */
  private submit(): void {
    const pending = this.current;
    if (!pending || pending.request.kind !== "password") return;
    if (this.phase === "checking" || this.used === 0) return;
    const identity = pending.request.identities[this.selected]!;
    const check = pending.request.check;
    const secret = this.buffer.slice(0, this.used);
    this.wipe();
    if (!check) {
      secret.fill(0);
      this.phase = "unavailable";
      this.bump();
      return;
    }
    const generation = this.generation;
    this.phase = "checking";
    this.bump();
    let verdict: Promise<SecurePromptVerdict>;
    try {
      verdict = check(identity, secret);
    } catch {
      verdict = Promise.resolve("unavailable");
    }
    void Promise.resolve(verdict)
      .catch((): SecurePromptVerdict => "unavailable")
      .then((result) => {
        secret.fill(0);
        // Cancelled, timed out or locked meanwhile: this answer belongs to a finished prompt.
        if (generation !== this.generation || this.current !== pending) return;
        this.activity();
        switch (result) {
          case "accepted":
            this.finish("completed", identity);
            return;
          case "rejected":
            this.failures++;
            this.phase = "wrong";
            break;
          case "throttled":
            this.phase = "throttled";
            break;
          default:
            this.phase = "unavailable";
        }
        this.bump();
      });
  }

  /** End the visible prompt with `outcome` and show whoever is next. */
  private finish(outcome: SecurePromptOutcome, identity?: SecurePromptIdentity): void {
    const pending = this.current;
    if (!pending) return;
    this.current = null;
    this.generation++;
    this.wipe();
    this.fresh.clear();
    this.phase = "entry";
    this.cancelIdle?.();
    this.cancelIdle = null;
    this.advance();
    this.settle(pending, outcome, identity);
    this.bump();
  }

  /** Show the next waiting request, unless locked. One still cooling down is refused unseen. */
  private advance(): void {
    while (!this.locked && !this.disposed && !this.current) {
      const next = this.queue.shift();
      if (!next) break;
      if (this.coolingDown(next.request)) {
        // The cancel that started the cool-down answered this one too.
        this.noteCancel(next);
        this.settle(next, "refused");
        continue;
      }
      this.show(next);
    }
    if (!this.current) this.announce(false);
  }

  /** A waiting request leaves the queue; the visible one closes without a message. */
  private withdraw(pending: Pending, outcome: "cancelled" | "timed-out"): void {
    if (pending.settled) return;
    if (pending === this.current) {
      this.finish(outcome);
      return;
    }
    const index = this.queue.indexOf(pending);
    if (index >= 0) this.queue.splice(index, 1);
    this.settle(pending, outcome);
    this.bump();
  }

  private settle(
    pending: Pending,
    outcome: SecurePromptOutcome,
    identity?: SecurePromptIdentity,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    pending.cancelWait?.();
    pending.cancelWait = null;
    pending.resolve(identity ? { outcome, identity } : { outcome });
  }

  private announce(visible: boolean): void {
    if (this.announced === visible) return;
    this.announced = visible;
    this.options.shown?.(visible);
  }

  /** Refused unseen: its action is in the short cool-down, or its requester is paused. */
  private coolingDown(request: SecurePromptRequest): boolean {
    const now = this.timers.now();
    const key = request.coolDownKey;
    const until = key !== undefined ? this.coolDowns.get(key) : undefined;
    if (until !== undefined) {
      if (now < until) return true;
      this.coolDowns.delete(key!);
    }
    const requester = floodKey(request);
    const flood = requester !== undefined ? this.floods.get(requester) : undefined;
    if (!flood) return false;
    if (now < flood.until) return true;
    if (flood.cancels.every((at) => now - at > SECURE_PROMPT_FLOOD_WINDOW_MS))
      this.floods.delete(requester!);
    return false;
  }

  private noteCancel(pending: Pending): void {
    const { request } = pending;
    const requester = floodKey(request);
    if (requester === undefined) return;
    const now = this.timers.now();
    let flood = this.floods.get(requester);
    if (!flood) {
      flood = { cancels: [], until: 0 };
      remember(this.floods, requester, flood);
    }
    // Already paused: the flood was reported once.
    if (now < flood.until) return;
    flood.cancels = flood.cancels.filter((at) => now - at <= SECURE_PROMPT_FLOOD_WINDOW_MS);
    flood.cancels.push(now);
    if (flood.cancels.length >= SECURE_PROMPT_FLOOD_CANCELS) {
      flood.cancels = [];
      flood.until = now + SECURE_PROMPT_FLOOD_COOL_DOWN_MS;
      try {
        this.options.flood?.(request.requester);
      } catch {
        /* a failing notification never changes the cool-down */
      }
    } else if (request.coolDownKey !== undefined)
      remember(this.coolDowns, request.coolDownKey, now + SECURE_PROMPT_COOL_DOWN_MS);
  }

  /** One timer measures idleness from the last activity, re-armed when it fires early. */
  private armIdle(delayMs: number): void {
    this.cancelIdle?.();
    const generation = this.generation;
    this.cancelIdle = this.timers.schedule(delayMs, () => {
      this.cancelIdle = null;
      if (generation !== this.generation || !this.current) return;
      const left = this.lastActivityMs + SECURE_PROMPT_IDLE_MS - this.timers.now();
      if (left > 0) this.armIdle(left);
      else this.finish("timed-out");
    });
  }

  private wipe(): void {
    this.buffer.fill(0);
    this.used = 0;
  }

  private bump(): void {
    this.viewRevision++;
    this.options.changed?.();
  }
}

/** Who a flood is counted against: the requester, else the executable and action. */
function floodKey(request: SecurePromptRequest): string | undefined {
  return request.requesterKey ?? request.coolDownKey;
}

/** Bounded: the oldest key goes first. */
function remember<Value>(map: Map<string, Value>, key: string, value: Value): void {
  if (!map.has(key) && map.size >= MAX_COOL_DOWN_KEYS) map.delete(map.keys().next().value!);
  map.set(key, value);
}

/** No C0 controls or DEL: Enter, Tab, Escape and Ctrl+letter never become answer bytes. */
function printable(text: Uint8Array): boolean {
  for (const byte of text) if (byte < 0x20 || byte === 0x7f) return false;
  return true;
}

/** Controls, line breaks and bidirectional overrides: none of them belongs in a prompt. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

function plain(text: unknown, limit: number): string {
  const cleaned = String(text ?? "")
    .replace(UNSAFE_TEXT, " ")
    .trim();
  const characters = Array.from(cleaned);
  return characters.length > limit ? characters.slice(0, limit).join("") : cleaned;
}

/**
 * The request as the prompt keeps it. Requesters bound and strip their text already; this is the
 * second fence, so nothing unbounded or with control characters can reach the view. Null when
 * the request cannot be answered at all (a password prompt with nobody to sign).
 */
function sanitize(request: SecurePromptRequest): SecurePromptRequest | null {
  const kind = request.kind === "consent" ? "consent" : "password";
  const identities =
    kind === "password"
      ? request.identities.slice(0, SECURE_PROMPT_MAX_IDENTITIES).map((identity) => ({
          account: identity.account,
          displayName: plain(identity.displayName, 80) || plain(identity.account, 80),
        }))
      : [];
  if (kind === "password" && identities.length === 0) return null;
  const selected =
    Number.isInteger(request.selected) &&
    request.selected >= 0 &&
    request.selected < identities.length
      ? request.selected
      : 0;
  const requester = request.requester;
  return {
    kind,
    headline: plain(request.headline, 200),
    requester: requester
      ? {
          name: plain(requester.name, 80),
          ...(requester.pid !== undefined ? { pid: requester.pid } : {}),
          ...(requester.via !== undefined ? { via: plain(requester.via, 80) } : {}),
          x11: requester.x11 === true,
        }
      : null,
    identities,
    selected,
    needsAdministrator: request.needsAdministrator === true,
    details: request.details.slice(0, MAX_DETAILS).map((detail) => ({
      label: plain(detail.label, 40),
      value: plain(detail.value, 200),
    })),
    ...(request.coolDownKey !== undefined ? { coolDownKey: String(request.coolDownKey) } : {}),
    ...(request.requesterKey !== undefined ? { requesterKey: String(request.requesterKey) } : {}),
    ...(kind === "password" && request.check ? { check: request.check } : {}),
  };
}
