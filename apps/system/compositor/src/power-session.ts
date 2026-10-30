/**
 * The session's power behaviour: the idle controller fed by input, idle inhibitors and the
 * power prefs; the power, sleep and suspend keys; the lid; logind's sleep and lock signals; and
 * org.moire.Idle1, which Settings reads.
 *
 * Sleep blocking: nothing stops a lid close or a chosen Suspend by default. Any app may hold a
 * suspend inhibitor (Idle1.Inhibit, the portal's Inhibit); it always holds off the idle suspend
 * timer, and it holds off the lid-close suspend only for an app on the user's allowlist. The
 * decision is made here, where the lid is already handled, so no block-mode logind sleep
 * inhibitor is ever taken and polkit grants none (docs/portals.md, "Sleep blocking").
 *
 * Locking: the compositor's lock screen plugs in through `lock` (show it; resolves once a locked
 * frame is on screen), `unlock` (logind's Unlock) and `setLocked` (every lock and unlock, from
 * any trigger). With a lock provider the session holds a sleep delay inhibitor, released only
 * after the lock is on screen. Without one, every lock step is skipped and reported unsupported.
 */
import {
  IdleController,
  type IdleLockReason,
  type IdleOutputs,
  type IdlePowerSource,
  type IdleTimers,
} from "@moire/core";
import type { DbusDisposer, SessionBus } from "@moire/dbus";
import { loadSettings, type PowerSettings } from "@moire/prefs";
import type { DesktopStatusState } from "@moire/system-management/desktop-status";
import {
  IDLE_INTERFACE,
  IDLE_PATH,
  filePowerSettingsStore,
  type IdleStatus,
  type SleepBlockerRequest,
} from "@moire/system-management/power-settings";
import { audioPlaybackActive } from "./audio-activity";
import {
  connectLogindPower,
  type InhibitorHold,
  type InhibitorOptions,
  type LogindEvents,
  type LogindPower,
} from "./logind-power";
import type { AppIdentity, CallerIdentifier } from "./sleep-blockers";

/** org.freedesktop.portal.Inhibit's flags, as the portal backend forwards them to Idle1.Inhibit. */
export const INHIBIT_LOGOUT = 1;
export const INHIBIT_USER_SWITCH = 2;
export const INHIBIT_SUSPEND = 4;
export const INHIBIT_IDLE = 8;
const INHIBIT_ALL = INHIBIT_LOGOUT | INHIBIT_USER_SWITCH | INHIBIT_SUSPEND | INHIBIT_IDLE;
const MAX_INHIBITORS_PER_CALLER = 64;
const MAX_INHIBITORS = 256;
/** Apps remembered as having asked to keep the computer awake, for Settings to offer. */
const MAX_SLEEP_REQUESTERS = 32;

type AppInhibitor = {
  sender: string;
  /** The name the caller gave: shown, never trusted. */
  appId: string;
  flags: number;
  reason: string;
  /** Who the caller is, for suspend inhibitors; null when it could not be identified. */
  app: AppIdentity | null;
};

/** One app that asked for a suspend inhibitor this session, keyed by identity. */
type SleepRequester = { app: AppIdentity | null; name: string; order: number };

/** A lid-close suspend held off by allowed apps, kept until the lid opens so it can be reported. */
type LidHold = { since: number; endedAt: number | null; apps: Set<string> };

const KEY_POWER = 116;
const KEY_SLEEP = 142;
const KEY_SUSPEND = 205;

/** The user-requested power actions (logind Suspend, Reboot and PowerOff). */
export type PowerAction = "suspend" | "reboot" | "power-off";

/** The compositor surface this module needs; CompositorServer satisfies it. */
export type PowerSessionServer = {
  onUserActivity(listener: () => void): () => void;
  setSystemKeyHandler(handler: ((code: number, value: number) => boolean) | null): void;
  idleInhibitorReasons(): string[];
  readonly idleInhibitors: { onChanged(listener: () => void): () => void };
  readonly outputPower: IdleOutputs;
  getDisplayOutputs(): readonly unknown[];
};

export type PowerSessionOptions = {
  server: PowerSessionServer;
  settings: { load(): PowerSettings; watch?(listener: () => void): () => void };
  powerSource?: IdlePowerSource;
  /** Show the lock screen; resolves true once a locked frame is on screen. */
  lock?: (reason: IdleLockReason) => Promise<boolean>;
  /** logind's Unlock signal for this session. */
  unlock?: () => void;
  /** Take a logind inhibitor; defaults to the connected logind's. */
  holdInhibitor?: (options: InhibitorOptions) => InhibitorHold;
  audioActive?: () => boolean;
  reducedMotion?: () => boolean;
  /** Open the session's power menu for the "ask" power button action; false when there is none. */
  askPowerAction?: () => boolean;
  /** Name the sender of an Idle1.Inhibit call; without it no app can be told apart or allowed. */
  identifyCaller?: CallerIdentifier;
  /** Tell the user something after the fact (a desktop notification). */
  notify?: (summary: string, body: string) => void;
  /** Wall-clock milliseconds, for how long the lid was held. */
  now?: () => number;
  timers?: IdleTimers;
  log?: (message: string) => void;
};

function callerName(sender: string | undefined): string {
  if (!sender || !/^:[0-9]+\.[0-9]+$/.test(sender)) throw new Error("Invalid caller");
  return sender;
}

/** On battery only when UPower says so; anything unknown counts as mains power. */
export function powerSourceOf(state: DesktopStatusState): IdlePowerSource {
  return state.kind === "ready" &&
    state.snapshot.battery.kind === "ready" &&
    state.snapshot.battery.onBattery
    ? "battery"
    : "ac";
}

/** Running down a battery UPower calls critical: no app keeps the computer awake past this. */
export function batteryCriticalOf(state: DesktopStatusState): boolean {
  if (state.kind !== "ready" || state.snapshot.battery.kind !== "ready") return false;
  const { onBattery, warningLevel } = state.snapshot.battery;
  return onBattery && (warningLevel === "critical" || warningLevel === "action");
}

function printable(value: string, limit: number): string {
  return [...value]
    .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
    .join("")
    .slice(0, limit);
}

/** "under a minute", "12 minutes", "2 hours". */
function heldFor(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `${hours} hours`;
}

export class PowerSession {
  readonly controller: IdleController;
  private settings: PowerSettings;
  private logind: LogindPower | null = null;
  private handleHold: InhibitorHold | null = null;
  private sleepHold: InhibitorHold | null = null;
  /** Inhibitors apps hold through Idle1.Inhibit (the portal backend's Inhibit), by cookie. */
  private readonly appInhibitors = new Map<number, AppInhibitor>();
  private readonly callerWatches = new Map<string, Promise<DbusDisposer | null>>();
  private nextCookie = 1;
  private readonly sleepRequesters = new Map<string, SleepRequester>();
  private requestOrder = 0;
  private lidClosed = false;
  private lidHold: LidHold | null = null;
  private batteryCritical = false;
  private readonly now: () => number;
  private bus: SessionBus | null = null;
  private unexport: (() => void) | null = null;
  private revision = 0;
  private published = "";
  private lastError: string | null = null;
  /** The input that just arrived woke a dark screen; a power key press then only wakes. */
  private wokeScreen = false;
  private disposed = false;
  private readonly cleanups: (() => void)[] = [];
  private readonly log: (message: string) => void;

  /** Pass these to connectLogindPower. */
  readonly logindEvents: LogindEvents = {
    prepareForSleep: (sleeping) => void this.prepareForSleep(sleeping),
    sessionLock: (lock) => {
      if (lock) this.controller.requestLock();
      else this.options.unlock?.();
    },
    lid: (closed) => this.lidChanged(closed),
  };

  constructor(private readonly options: PowerSessionOptions) {
    this.log = options.log ?? ((message) => console.log(`[power] ${message}`));
    this.now = options.now ?? Date.now;
    this.settings = options.settings.load();
    const { server } = options;
    this.controller = new IdleController({
      settings: this.settings,
      source: options.powerSource ?? "ac",
      outputs: server.outputPower,
      displayInhibitors: () => [
        ...server.idleInhibitorReasons(),
        ...this.appInhibitorReasons(INHIBIT_IDLE),
      ],
      suspendInhibitors: () => [
        ...(options.audioActive?.() ? ["audio"] : []),
        ...(this.batteryCritical ? [] : this.appInhibitorReasons(INHIBIT_SUSPEND)),
      ],
      reducedMotion: options.reducedMotion,
      timers: options.timers,
      hooks: {
        ...(options.lock ? { lock: options.lock } : {}),
        suspend: () => this.suspend("idle"),
        idleHint: (idle) => {
          void this.logind?.setIdleHint(idle).catch(() => {});
        },
        changed: () => this.publish(),
        failed: (action, error) => this.fail(action, error),
      },
    });
    this.cleanups.push(
      server.onUserActivity(() => {
        this.wokeScreen = this.controller.status().phase === "off";
        this.controller.activity();
      }),
      server.idleInhibitors.onChanged(() => this.controller.inhibitorsChanged()),
    );
    server.setSystemKeyHandler((code, value) => this.systemKey(code, value));
    this.cleanups.push(() => server.setSystemKeyHandler(null));
    const unwatch = options.settings.watch?.(() => {
      const next = options.settings.load();
      if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
      this.settings = next;
      this.controller.setSettings(next);
      this.syncSleepInhibitor();
      // The allowlist or the lid action may have changed under a held lid.
      this.reconsiderLid();
      this.publish();
    });
    if (unwatch) this.cleanups.push(unwatch);
  }

  /** logind and UPower arrive after startup (or never, outside a logind session). */
  setLogind(logind: LogindPower | null): void {
    if (this.disposed) {
      void logind?.dispose();
      return;
    }
    this.logind = logind;
    this.handleHold?.release();
    this.handleHold = null;
    const holdInhibitor = this.inhibitorHolder();
    if (logind && holdInhibitor) {
      // Lid handling moves to Moire only when there is a lid; the keys always do, since the
      // compositor's exclusive grab already keeps them from logind.
      const what = [
        "handle-power-key",
        "handle-suspend-key",
        ...(logind.lid.present ? ["handle-lid-switch"] : []),
      ].join(":");
      const hold = holdInhibitor({
        what,
        why: "Moire applies the power button and lid settings",
        mode: "block",
        onLost: () => {
          this.log("logind handling inhibitor lost; logind handles the lid again");
          this.publish();
        },
      });
      this.handleHold = hold;
      void hold.ready.then((held) => {
        if (!held && this.handleHold === hold)
          this.log("logind refused the handling inhibitor; the lid stays with logind");
        this.publish();
      });
    }
    this.syncSleepInhibitor();
    this.syncAppInhibitors();
    this.publish();
  }

  /**
   * An app (directly, or through the portal backend) asks the session not to go idle, suspend,
   * log out or switch user. Idle and suspend take effect in the idle policy; a suspend inhibitor
   * also holds off the lid-close suspend when `app` is on the user's allowlist. Logout and user
   * switch are recorded for the shell's logout flow to list. Returns the cookie for uninhibit.
   */
  inhibit(
    sender: string,
    appId: string,
    flags: number,
    reason: string,
    app: AppIdentity | null = null,
  ): number {
    if (this.disposed) throw new Error("The session is stopping");
    if (!Number.isInteger(flags) || flags <= 0 || (flags & ~INHIBIT_ALL) !== 0)
      throw new Error("Invalid inhibit flags");
    const held = [...this.appInhibitors.values()];
    if (
      held.length >= MAX_INHIBITORS ||
      held.filter((entry) => entry.sender === sender).length >= MAX_INHIBITORS_PER_CALLER
    )
      throw new Error("Too many inhibitors");
    while (this.appInhibitors.has(this.nextCookie))
      this.nextCookie = this.nextCookie >= 0xffff_fffe ? 1 : this.nextCookie + 1;
    const cookie = this.nextCookie++;
    const entry: AppInhibitor = {
      sender,
      appId: printable(appId, 128),
      flags,
      reason: printable(reason, 256),
      app: app && { ...app, name: printable(app.name, 128) || "app" },
    };
    this.appInhibitors.set(cookie, entry);
    if (flags & INHIBIT_SUSPEND) this.rememberSleepRequester(entry);
    this.watchCaller(sender);
    this.syncAppInhibitors();
    return cookie;
  }

  /** Only the caller that took an inhibitor can drop it. */
  uninhibit(sender: string, cookie: number): boolean {
    if (this.appInhibitors.get(cookie)?.sender !== sender) return false;
    this.appInhibitors.delete(cookie);
    this.unwatchCallerIfIdle(sender);
    this.syncAppInhibitors();
    return true;
  }

  appInhibitorList(): readonly Readonly<AppInhibitor>[] {
    return [...this.appInhibitors.values()];
  }

  private appInhibitorReasons(flag: number): string[] {
    return [...this.appInhibitors.values()]
      .filter((entry) => entry.flags & flag)
      .map((entry) =>
        [entry.app?.name ?? (entry.appId || "app"), entry.reason].filter(Boolean).join(": "),
      );
  }

  private static requesterKey(entry: AppInhibitor): string {
    return entry.app ? entry.app.id : `unidentified:${entry.appId}`;
  }

  /** Settings offers a switch for every app that asked; the oldest idle ones make room. */
  private rememberSleepRequester(entry: AppInhibitor): void {
    const key = PowerSession.requesterKey(entry);
    this.sleepRequesters.delete(key);
    this.sleepRequesters.set(key, {
      app: entry.app,
      name: entry.app?.name ?? (entry.appId || "An app"),
      order: ++this.requestOrder,
    });
    const holding = new Set(this.suspendInhibitors().map(PowerSession.requesterKey));
    for (const stale of this.sleepRequesters.keys()) {
      if (this.sleepRequesters.size <= MAX_SLEEP_REQUESTERS) break;
      if (!holding.has(stale)) this.sleepRequesters.delete(stale);
    }
  }

  private suspendInhibitors(): AppInhibitor[] {
    return [...this.appInhibitors.values()].filter((entry) => entry.flags & INHIBIT_SUSPEND);
  }

  private allowed(app: AppIdentity | null): boolean {
    return !!app && this.settings.sleepBlockers.some((grant) => grant.id === app.id);
  }

  /** Names of the allowed apps holding a suspend inhibitor; none once the battery is critical. */
  private sleepBlockers(): string[] {
    if (this.batteryCritical) return [];
    return [
      ...new Set(
        this.suspendInhibitors()
          .filter((entry) => this.allowed(entry.app))
          .map((entry) => entry.app!.name),
      ),
    ];
  }

  private sleepRequests(): SleepBlockerRequest[] {
    const holding = new Set(this.suspendInhibitors().map(PowerSession.requesterKey));
    return [...this.sleepRequesters.entries()]
      .map(([key, requester]) => ({ key, requester, holding: holding.has(key) }))
      .sort(
        (a, b) => Number(b.holding) - Number(a.holding) || b.requester.order - a.requester.order,
      )
      .map(({ requester, holding: held }) => ({
        id: requester.app?.id ?? null,
        name: requester.name,
        x11: requester.app?.x11 ?? false,
        allowed: this.allowed(requester.app),
        holding: held,
      }));
  }

  /** A caller that leaves the bus (a crashed portal backend) releases everything it held. */
  private watchCaller(sender: string): void {
    const bus = this.bus;
    if (!bus || this.callerWatches.has(sender)) return;
    this.callerWatches.set(
      sender,
      bus
        .watchName(sender, (owner) => {
          if (owner !== null) return;
          let dropped = false;
          for (const [cookie, entry] of this.appInhibitors)
            if (entry.sender === sender) dropped = this.appInhibitors.delete(cookie) || dropped;
          this.unwatchCallerIfIdle(sender);
          if (dropped) this.syncAppInhibitors();
        })
        .catch(() => null),
    );
  }

  private unwatchCallerIfIdle(sender: string): void {
    if ([...this.appInhibitors.values()].some((entry) => entry.sender === sender)) return;
    const watch = this.callerWatches.get(sender);
    this.callerWatches.delete(sender);
    void watch?.then((dispose) => dispose?.()).catch(() => {});
  }

  private syncAppInhibitors(): void {
    if (this.disposed) return;
    this.controller.inhibitorsChanged();
    this.reconsiderLid();
    this.publish();
  }

  setPowerSource(source: IdlePowerSource): void {
    this.controller.setPowerSource(source);
  }

  /** A critically low battery outranks every app: held-off suspends go ahead. */
  setBatteryCritical(critical: boolean): void {
    if (this.disposed || critical === this.batteryCritical) return;
    this.batteryCritical = critical;
    if (critical) this.log("battery critical: apps no longer keep the computer awake");
    this.controller.inhibitorsChanged();
    this.reconsiderLid();
    this.publish();
  }

  /**
   * Suspend, restart or power off on the user's request (the lock screen's power menu, Quick
   * Settings). Suspend takes the same path as every other suspend, so "lock on suspend" locks
   * first: logind's PrepareForSleep reaches prepareForSleep() while the delay inhibitor holds.
   * No app inhibitor is consulted: the person choosing Suspend outranks any app, allowed or not.
   */
  requestPowerAction(action: PowerAction, reason: string): void {
    if (!this.disposed) this.act(action, reason);
  }

  /** The lock provider reports every lock and unlock; logind's LockedHint follows. */
  setLocked(locked: boolean): void {
    if (this.disposed) return;
    this.controller.setLocked(locked);
    void this.logind?.setLockedHint(locked).catch(() => {});
  }

  /** Export org.moire.Idle1 on the compositor's session-bus connection. */
  exportStatus(bus: SessionBus): void {
    this.unexport?.();
    this.bus = bus;
    this.unexport = bus.exportObject(IDLE_PATH, {
      name: IDLE_INTERFACE,
      methods: {
        GetStatus: {
          inSignature: "",
          outSignature: "s",
          handler: () => ({ body: [this.snapshot()] }),
        },
        Inhibit: {
          inSignature: "sus",
          outSignature: "u",
          handler: async ({ message, body }) => {
            const sender = callerName(message.sender);
            const appId = String(body[0] ?? "");
            const flags = Number(body[1]);
            // Only a suspend inhibitor is ever weighed against the allowlist.
            const app =
              Number.isInteger(flags) && flags & INHIBIT_SUSPEND
                ? await this.identify(bus, sender, appId)
                : null;
            return { body: [this.inhibit(sender, appId, flags, String(body[2] ?? ""), app)] };
          },
        },
        Uninhibit: {
          inSignature: "u",
          outSignature: "",
          handler: ({ message, body }) => {
            if (!this.uninhibit(callerName(message.sender), Number(body[0])))
              throw new Error("No such inhibitor for this caller");
            return {};
          },
        },
        ListInhibitors: {
          inSignature: "",
          outSignature: "a(sus)",
          handler: () => ({
            body: [
              this.appInhibitorList().map((entry) => [entry.appId, entry.flags, entry.reason]),
            ],
          }),
        },
      },
    });
  }

  private async identify(
    bus: SessionBus,
    sender: string,
    appId: string,
  ): Promise<AppIdentity | null> {
    try {
      return (await this.options.identifyCaller?.(bus, sender, appId)) ?? null;
    } catch (error) {
      this.log(
        `could not identify ${sender}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  status(): IdleStatus {
    const s = this.controller.status();
    const lidPresent = !!this.logind?.lid.present;
    return {
      state: s.state,
      phase: s.phase,
      locked: s.locked,
      powerSource: s.powerSource,
      inhibitors: { display: [...s.inhibitors.display], suspend: [...s.inhibitors.suspend] },
      capabilities: {
        screenOff: s.screenOffSupported,
        lock: s.lockSupported,
        suspend: !!this.logind?.canSuspend,
        powerOff: !!this.logind?.canPowerOff,
        reboot: !!this.logind?.canReboot,
        lidPresent,
        lidAction: lidPresent && !!this.handleHold?.held,
        powerButton: true,
      },
      sleepBlocking: {
        requests: this.sleepRequests(),
        lidHeld: this.lidHold !== null && this.lidHold.endedAt === null,
      },
      lastError: this.lastError,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.controller.dispose();
    this.handleHold?.release();
    this.sleepHold?.release();
    this.appInhibitors.clear();
    for (const watch of this.callerWatches.values())
      void watch.then((dispose) => dispose?.()).catch(() => {});
    this.callerWatches.clear();
    this.unexport?.();
    // Never leave the screen dark or dimmed behind a stopping session.
    await this.options.server.outputPower.setPowered(true).catch(() => false);
    this.options.server.outputPower.setDim(0, 0);
    await this.logind?.dispose().catch(() => {});
  }

  private snapshot(): string {
    return JSON.stringify({ revision: this.revision, status: this.status() });
  }

  private publish(): void {
    if (this.disposed) return;
    const status = JSON.stringify(this.status());
    if (status === this.published) return;
    this.published = status;
    this.revision++;
    this.bus?.emitSignal({
      path: IDLE_PATH,
      interface: IDLE_INTERFACE,
      member: "Changed",
      signature: "s",
      body: [this.snapshot()],
    });
  }

  private fail(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = `${action}: ${message}`.slice(0, 1024);
    this.log(`${action} failed: ${message}`);
    this.publish();
  }

  private async suspend(reason: string): Promise<void> {
    if (!this.logind) throw new Error("logind is unavailable");
    this.log(`suspending (${reason})`);
    await this.logind.suspend();
  }

  private act(action: PowerAction, reason: string): void {
    const run = (async () => {
      if (action === "suspend") return this.suspend(reason);
      if (!this.logind) throw new Error("logind is unavailable");
      this.log(`${action === "reboot" ? "restarting" : "powering off"} (${reason})`);
      return action === "reboot" ? this.logind.reboot() : this.logind.powerOff();
    })();
    void run.catch((error: unknown) => this.fail(action, error));
  }

  /** Power, sleep and suspend keys. Every edge is consumed so apps never see half a press. */
  private systemKey(code: number, value: number): boolean {
    if (value !== 1) return true;
    if (this.wokeScreen) {
      this.wokeScreen = false;
      return true;
    }
    if (code === KEY_SLEEP || code === KEY_SUSPEND) {
      this.act("suspend", "sleep key");
      return true;
    }
    if (code !== KEY_POWER) return false;
    switch (this.settings.powerButtonAction) {
      case "suspend":
        this.act("suspend", "power key");
        break;
      case "power-off":
        this.act("power-off", "power key");
        break;
      case "ask":
        if (!this.options.askPowerAction?.()) this.log("power key: no power menu to ask with");
        break;
      case "nothing":
        break;
    }
    return true;
  }

  private lidChanged(closed: boolean): void {
    this.lidClosed = closed;
    if (!closed) {
      const hold = this.lidHold;
      this.lidHold = null;
      if (hold) this.reportLidHold(hold);
      this.publish();
      this.controller.activity();
      return;
    }
    this.applyLidAction();
    this.publish();
  }

  /**
   * The lid-close action, when the lid closes and again when what held a suspend off changes.
   * Only suspend can be held off, and only by apps the user allowed; "Shut down" is not a sleep.
   */
  private applyLidAction(): void {
    // Without the inhibitor logind acts on the lid itself; acting too would double up.
    if (!this.handleHold?.held) return;
    // Docked: an external display keeps the session in use.
    if (this.options.server.getDisplayOutputs().length > 1) return;
    const action = this.settings.lidCloseAction;
    if (action === "power-off") this.act("power-off", "lid closed");
    if (action !== "suspend") return;
    const blockers = this.sleepBlockers();
    if (blockers.length > 0) {
      if (!this.lidHold) {
        this.log(`lid closed: kept awake by ${blockers.join(", ")}`);
        this.lidHold = { since: this.now(), endedAt: null, apps: new Set() };
        // Nobody is watching a closed laptop: lock it as a suspend would have.
        if (this.settings.lockOnSuspend) this.controller.requestLock();
      }
      for (const name of blockers) this.lidHold.apps.add(name);
      return;
    }
    if (!this.lidHold) return this.act("suspend", "lid closed");
    this.lidHold.endedAt = this.now();
    this.act(
      "suspend",
      this.batteryCritical ? "lid closed, battery critical" : "lid closed, no longer kept awake",
    );
  }

  /** A suspend is being held off under a closed lid: check whether it still should be. */
  private reconsiderLid(): void {
    if (this.lidClosed && this.lidHold && this.lidHold.endedAt === null) this.applyLidAction();
  }

  /** The lid is open again: say what kept the computer awake while nobody could see it. */
  private reportLidHold(hold: LidHold): void {
    const apps = [...hold.apps];
    const who =
      apps.length > 2
        ? `${apps.slice(0, 2).join(", ")} and ${apps.length - 2} more`
        : apps.join(" and ");
    const duration = heldFor((hold.endedAt ?? this.now()) - hold.since);
    this.log(`lid opened: ${who} kept the computer awake for ${duration}`);
    this.options.notify?.(
      "Kept awake with the lid closed",
      `${who} kept this computer awake for ${duration}. Change which apps can in Settings › Power.`,
    );
  }

  private inhibitorHolder(): ((options: InhibitorOptions) => InhibitorHold) | null {
    const logind = this.logind;
    return this.options.holdInhibitor ?? (logind ? (options) => logind.inhibit(options) : null);
  }

  /** A sleep delay inhibitor gives the lock screen time to appear; only worth holding with one. */
  private syncSleepInhibitor(): void {
    const holdInhibitor = this.inhibitorHolder();
    const want =
      !!this.logind &&
      !!holdInhibitor &&
      this.controller.status().lockSupported &&
      this.settings.lockOnSuspend;
    if (want && !this.sleepHold) {
      this.sleepHold = holdInhibitor!({
        what: "sleep",
        why: "Moire locks the screen before sleeping",
        mode: "delay",
      });
    } else if (!want && this.sleepHold) {
      this.sleepHold.release();
      this.sleepHold = null;
    }
  }

  private async prepareForSleep(sleeping: boolean): Promise<void> {
    if (!sleeping) {
      this.controller.resumed();
      this.syncSleepInhibitor();
      return;
    }
    await this.controller.prepareForSleep();
    // Locked (or nothing to lock): let the system sleep now rather than at logind's timeout.
    this.sleepHold?.release();
    this.sleepHold = null;
  }
}

/** The installed session: prefs on disk, logind and UPower on the system bus. */
export function startPowerSession(
  server: PowerSessionServer,
  options: Pick<
    PowerSessionOptions,
    "askPowerAction" | "lock" | "unlock" | "identifyCaller" | "notify"
  > = {},
): PowerSession {
  const session = new PowerSession({
    server,
    settings: filePowerSettingsStore,
    audioActive: () => audioPlaybackActive(),
    reducedMotion: () => loadSettings().reducedMotion,
    askPowerAction: options.askPowerAction,
    identifyCaller: options.identifyCaller,
    notify: options.notify,
    lock: options.lock,
    unlock: options.unlock,
  });
  void connectLogindPower({ events: session.logindEvents })
    .then((logind) => {
      session.setLogind(logind);
      console.log(
        `[power] logind session=${logind.session ?? "none"} suspend=${logind.canSuspend} ` +
          `poweroff=${logind.canPowerOff} reboot=${logind.canReboot} lid=${logind.lid.present}`,
      );
    })
    .catch((error: unknown) => {
      session.setLogind(null);
      console.warn("[power] logind unavailable:", error instanceof Error ? error.message : error);
    });
  return session;
}
