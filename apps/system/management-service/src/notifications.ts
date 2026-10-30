import { SessionBus, type DbusInterface, type DbusMethodContext } from "@moire/dbus";
import { DEFAULT_NOTIFICATION_RULE, notificationAppKey, type NotificationRule } from "@moire/prefs";

export const NOTIFICATIONS_BUS = "org.freedesktop.Notifications";
export const NOTIFICATIONS_PATH = "/org/freedesktop/Notifications";
export const NOTIFICATIONS_INTERFACE = NOTIFICATIONS_BUS;

/** Desktop Notifications 1.3. Images, markup, sound and persistence are not advertised. */
export const NOTIFICATION_LIMITS = Object.freeze({
  active: 128,
  history: 64,
  actions: 16,
  hints: 32,
  bodyBytes: 4096,
  imageBytes: 256 * 1024,
});

export type NotificationAction = Readonly<{ key: string; label: string }>;
export type NotificationEntry = Readonly<{
  id: number;
  revision: number;
  sender: string;
  appName: string;
  summary: string;
  body: string;
  actions: readonly NotificationAction[];
  urgency: 0 | 1 | 2;
  category: string;
  desktopEntry: string;
  /** The rule key: the desktop entry, else the app name. */
  appId: string;
  /** The app's rule allows a banner and sound; Do not disturb is applied separately. */
  banner: boolean;
  sound: boolean;
  /** Kept in history once closed. */
  history: boolean;
  createdAt: number;
  expiresAt: number | null;
}>;
export type NotificationCloseReason = 1 | 2 | 3 | 4;
export type ClosedNotification = Readonly<{
  notification: NotificationEntry;
  closedAt: number;
  reason: NotificationCloseReason;
}>;
export type NotificationSnapshot = Readonly<{
  active: readonly NotificationEntry[];
  history: readonly ClosedNotification[];
  doNotDisturb: boolean;
}>;
export type NotificationScheduler = {
  now(): number;
  schedule(delayMs: number, callback: () => void): () => void;
};
export type NotificationControls = {
  dismiss(): boolean;
  invokeAction(key: string): boolean;
};
export type NotificationOptions = {
  scheduler?: NotificationScheduler;
  defaultTimeoutMs?: number;
  onChange?: (snapshot: NotificationSnapshot) => void;
  /** Supply only when the presenter implements actual action controls. */
  present?: (notification: NotificationEntry, controls: NotificationControls) => void;
  onError?: (error: unknown) => void;
  /** The user's rule for an app id, read at each arrival so Settings changes apply at once. */
  rule?: (appId: string) => NotificationRule;
  /**
   * Play the alert for a new notification whose app rule has Sound on, outside Do not disturb,
   * unless the sender passed `suppress-sound`. Replacements are silent.
   */
  sound?: (notification: NotificationEntry) => void;
};
export type NotificationTransport = {
  watchSender(
    sender: string,
    changed: (owner: string | null) => void,
  ): Promise<() => Promise<void>>;
  emitSignal: SessionBus["emitSignal"];
};

const scheduler: NotificationScheduler = {
  now: Date.now,
  schedule(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

function text(value: unknown, name: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maximum ||
    value.includes("\0")
  )
    throw new Error(`Invalid notification ${name}`);
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("");
}

function uint32(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error(`Invalid notification ${name}`);
  return value;
}

function producer(context: DbusMethodContext): string {
  const sender = context.message.sender;
  if (!sender || sender.length > 255 || !/^:[\w-]+(?:\.[\w-]+)+$/.test(sender))
    throw new Error("Notification requires an authenticated unique bus sender");
  return sender;
}

function plainBody(value: unknown): string {
  return text(value, "body", NOTIFICATION_LIMITS.bodyBytes)
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => {
      switch (entity) {
        case "amp":
          return "&";
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "quot":
          return '"';
        default:
          return "'";
      }
    });
}

function hints(value: unknown): {
  urgency: 0 | 1 | 2;
  category: string;
  desktopEntry: string;
  suppressSound: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Map)
    throw new Error("Invalid notification hints");
  const entries = Object.entries(value);
  if (entries.length > NOTIFICATION_LIMITS.hints) throw new Error("Too many notification hints");
  let urgency: 0 | 1 | 2 = 1;
  let category = "",
    desktopEntry = "",
    suppressSound = false;
  for (const [key, variant] of entries) {
    text(key, "hint key", 128);
    if (
      !variant ||
      typeof variant !== "object" ||
      !("signature" in variant) ||
      !("value" in variant)
    )
      throw new Error("Invalid notification hint variant");
    const signature = text(variant.signature, "hint signature", 255);
    if (key === "urgency") {
      if (signature !== "y" || (variant.value !== 0 && variant.value !== 1 && variant.value !== 2))
        throw new Error("Invalid notification urgency");
      urgency = variant.value;
    } else if (key === "category" || key === "desktop-entry") {
      if (signature !== "s") throw new Error(`Invalid notification ${key}`);
      const parsed = text(variant.value, key, 256);
      if (key === "category") category = parsed;
      else desktopEntry = parsed;
    } else if (key === "suppress-sound") {
      if (signature !== "b" || typeof variant.value !== "boolean")
        throw new Error("Invalid notification suppress-sound");
      suppressSound = variant.value;
    } else if (key === "image-data" || key === "image_data" || key === "icon_data") {
      // Unsupported image hints are never retained or dereferenced. Bound their decoded byte payload.
      if (signature !== "(iiibiiay)" || !Array.isArray(variant.value) || variant.value.length !== 7)
        throw new Error("Invalid notification image data");
      const bytes: unknown = variant.value[6];
      if (
        (!Array.isArray(bytes) && !(bytes instanceof Uint8Array)) ||
        bytes.length > NOTIFICATION_LIMITS.imageBytes
      )
        throw new Error("Notification image data exceeds supported input limits");
    } else if (signature === "s") {
      text(variant.value, "hint text", 1024);
    }
    // Unknown hints are ignored, not forwarded to rendering or used for file/network access.
  }
  return { urgency, category, desktopEntry, suppressSound };
}

function parseNotify(context: DbusMethodContext) {
  if (context.message.signature !== "susssasa{sv}i") throw new Error("Invalid Notify signature");
  if (context.body.length !== 8) throw new Error("Notify requires eight arguments");
  const [appName, replacesId, appIcon, summary, body, rawActions, rawHints, timeout] = context.body;
  text(appIcon, "app icon", 512); // No icon-path loading in this service.
  if (
    !Array.isArray(rawActions) ||
    rawActions.length % 2 !== 0 ||
    rawActions.length > NOTIFICATION_LIMITS.actions * 2
  )
    throw new Error("Invalid notification actions");
  const actions: NotificationAction[] = [];
  const keys = new Set<string>();
  for (let index = 0; index < rawActions.length; index += 2) {
    const key = text(rawActions[index], "action key", 128);
    const label = text(rawActions[index + 1], "action label", 256);
    if (!key || keys.has(key)) throw new Error("Duplicate or empty notification action key");
    keys.add(key);
    actions.push(Object.freeze({ key, label }));
  }
  if (
    typeof timeout !== "number" ||
    !Number.isInteger(timeout) ||
    timeout < -1 ||
    timeout > 0x7fff_ffff
  )
    throw new Error("Invalid notification timeout");
  return {
    sender: producer(context),
    appName: text(appName, "app name", 128),
    replacesId: uint32(replacesId, "replacement ID"),
    summary: text(summary, "summary", 512),
    body: plainBody(body),
    actions: Object.freeze(actions),
    ...hints(rawHints),
    timeout,
  };
}

type SenderLease = {
  owner: string | null;
  reservations: number;
  subscription: Promise<() => Promise<void>>;
};
type ActiveNotification = { entry: NotificationEntry; cancel: () => void };

export function createNotificationService(
  transport: NotificationTransport,
  options: NotificationOptions = {},
) {
  const time = options.scheduler ?? scheduler;
  const defaultTimeout = options.defaultTimeoutMs ?? 5000;
  if (!Number.isInteger(defaultTimeout) || defaultTimeout < 1 || defaultTimeout > 0x7fff_ffff)
    throw new Error("Invalid default notification timeout");
  const active = new Map<number, ActiveNotification>();
  const history: ClosedNotification[] = [];
  const senders = new Map<string, SenderLease>();
  const listeners = new Set<(snapshot: NotificationSnapshot) => void>();
  if (options.onChange) listeners.add(options.onChange);
  let nextId = 1,
    revision = 0,
    doNotDisturb = false,
    disposed = false;
  let disposal: Promise<void> | null = null;
  const retirements = new Set<Promise<void>>();

  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else process.emitWarning(error instanceof Error ? error : String(error));
  };
  const snapshot = (): NotificationSnapshot =>
    Object.freeze({
      active: Object.freeze([...active.values()].map(({ entry }) => entry)),
      history: Object.freeze([...history]),
      doNotDisturb,
    });
  const changed = () => {
    const current = snapshot();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch (error) {
        report(error);
      }
    }
  };
  function retireSender(sender: string) {
    const lease = senders.get(sender);
    if (
      !lease ||
      lease.reservations ||
      [...active.values()].some(({ entry }) => entry.sender === sender)
    )
      return;
    senders.delete(sender);
    const retirement = lease.subscription.then((unsubscribe) => unsubscribe()).catch(report);
    retirements.add(retirement);
    void retirement.finally(() => retirements.delete(retirement));
  }
  function close(
    id: number,
    reason: NotificationCloseReason,
    expectedRevision?: number,
    emit = true,
  ): boolean {
    const current = active.get(id);
    if (!current || (expectedRevision !== undefined && current.entry.revision !== expectedRevision))
      return false;
    active.delete(id); // Invalidate ID/actions before any observer or closed signal runs.
    current.cancel();
    if (current.entry.history) {
      history.unshift(
        Object.freeze({
          notification: Object.freeze({ ...current.entry, actions: Object.freeze([]) }),
          closedAt: time.now(),
          reason,
        }),
      );
      history.length = Math.min(history.length, NOTIFICATION_LIMITS.history);
    }
    retireSender(current.entry.sender);
    if (emit && !disposed) {
      try {
        transport.emitSignal({
          destination: current.entry.sender,
          path: NOTIFICATIONS_PATH,
          interface: NOTIFICATIONS_INTERFACE,
          member: "NotificationClosed",
          signature: "uu",
          body: [id, reason],
        });
      } catch (error) {
        report(error);
      }
    }
    changed();
    return true;
  }
  async function reserveSender(sender: string): Promise<SenderLease> {
    let lease = senders.get(sender);
    if (!lease) {
      if (senders.size + retirements.size >= NOTIFICATION_LIMITS.active)
        throw new Error("Too many notification producers");
      const created: SenderLease = {
        owner: null,
        reservations: 0,
        subscription: Promise.resolve(async () => {}),
      };
      senders.set(sender, created);
      created.subscription = transport.watchSender(sender, (owner) => {
        if (disposed || senders.get(sender) !== created) return;
        created.owner = owner;
        if (owner !== sender) {
          for (const { entry } of active.values())
            if (entry.sender === sender) close(entry.id, 4, undefined, false);
        }
      });
      lease = created;
    }
    lease.reservations++;
    try {
      await lease.subscription;
      if (disposed || lease.owner !== sender)
        throw new Error("Notification producer is no longer connected");
      return lease;
    } catch (error) {
      lease.reservations--;
      retireSender(sender);
      throw error;
    }
  }
  function allocateId(): number {
    while (active.has(nextId)) nextId = nextId === 0xffff_ffff ? 1 : nextId + 1;
    const id = nextId;
    nextId = nextId === 0xffff_ffff ? 1 : nextId + 1;
    return id;
  }
  const readRule = (appId: string): NotificationRule => {
    try {
      return options.rule?.(appId) ?? DEFAULT_NOTIFICATION_RULE;
    } catch (error) {
      report(error);
      return DEFAULT_NOTIFICATION_RULE;
    }
  };
  /**
   * An app the user turned off: the sender still gets an id, as the spec requires, and is told
   * at once that it closed (reason 2, dismissed by the user), so it can drop its own state. A
   * replacement closes the sender's earlier notification too.
   */
  function refuse(sender: string, replacesId: number): number {
    const prior = active.get(replacesId);
    if (prior?.entry.sender === sender) {
      close(replacesId, 2);
      return replacesId;
    }
    const id = allocateId();
    try {
      transport.emitSignal({
        destination: sender,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member: "NotificationClosed",
        signature: "uu",
        body: [id, 2],
      });
    } catch (error) {
      report(error);
    }
    return id;
  }
  function invokeAction(id: number, key: string, expectedRevision: number): boolean {
    const current = active.get(id);
    if (
      disposed ||
      !options.present ||
      !current ||
      current.entry.revision !== expectedRevision ||
      senders.get(current.entry.sender)?.owner !== current.entry.sender ||
      !current.entry.actions.some((action) => action.key === key)
    )
      return false;
    transport.emitSignal({
      destination: current.entry.sender,
      path: NOTIFICATIONS_PATH,
      interface: NOTIFICATIONS_INTERFACE,
      member: "ActionInvoked",
      signature: "us",
      body: [id, key],
    });
    close(id, 2, expectedRevision);
    return true;
  }
  async function notify(context: DbusMethodContext): Promise<number> {
    if (disposed) throw new Error("Notification service is disposed");
    const parsed = parseNotify(context);
    const appId = notificationAppKey(parsed.desktopEntry, parsed.appName);
    const rule = readRule(appId);
    const lease = await reserveSender(parsed.sender);
    try {
      if (!rule.allow) return refuse(parsed.sender, parsed.replacesId);
      const replaced = active.get(parsed.replacesId);
      const prior = replaced?.entry.sender === parsed.sender ? replaced : undefined;
      if (!prior && active.size >= NOTIFICATION_LIMITS.active)
        throw new Error("Too many active notifications");
      const id = prior?.entry.id ?? allocateId();
      const timeout =
        parsed.urgency === 2 || parsed.timeout === 0
          ? 0
          : parsed.timeout === -1
            ? defaultTimeout
            : parsed.timeout;
      const now = time.now();
      const entry: NotificationEntry = Object.freeze({
        id,
        revision: ++revision,
        sender: parsed.sender,
        appName: parsed.appName,
        summary: parsed.summary,
        body: parsed.body,
        actions: options.present ? parsed.actions : Object.freeze([]),
        urgency: parsed.urgency,
        category: parsed.category,
        desktopEntry: parsed.desktopEntry,
        appId,
        banner: rule.banners,
        sound: rule.sound,
        history: rule.history,
        createdAt: now,
        expiresAt: timeout === 0 ? null : now + timeout,
      });
      const cancel =
        timeout === 0
          ? () => {}
          : time.schedule(timeout, () => {
              if (!disposed) close(id, 1, entry.revision);
            });
      prior?.cancel();
      active.set(id, { entry, cancel });
      changed();
      if (
        !prior &&
        !doNotDisturb &&
        entry.sound &&
        !parsed.suppressSound &&
        !disposed &&
        options.sound
      ) {
        try {
          options.sound(entry);
        } catch (error) {
          report(error);
        }
      }
      if (
        !doNotDisturb &&
        entry.banner &&
        !disposed &&
        active.get(id)?.entry === entry &&
        options.present
      ) {
        try {
          options.present(entry, {
            dismiss: () => close(id, 2, entry.revision),
            invokeAction: (key) => invokeAction(id, key, entry.revision),
          });
        } catch (error) {
          report(error);
        }
      }
      return id;
    } finally {
      lease.reservations--;
      retireSender(parsed.sender);
    }
  }
  const descriptor: DbusInterface = {
    name: NOTIFICATIONS_INTERFACE,
    methods: {
      GetCapabilities: {
        inSignature: "",
        outSignature: "as",
        handler: ({ body }) => {
          if (disposed) throw new Error("Notification service is disposed");
          if (body.length) throw new Error("GetCapabilities takes no arguments");
          return { body: [options.present ? ["body", "actions"] : ["body"]] };
        },
      },
      GetServerInformation: {
        inSignature: "",
        outSignature: "ssss",
        handler: ({ body }) => {
          if (disposed) throw new Error("Notification service is disposed");
          if (body.length) throw new Error("GetServerInformation takes no arguments");
          return { body: ["Moire", "Moire", "0.0.0", "1.3"] };
        },
      },
      Notify: {
        inSignature: "susssasa{sv}i",
        outSignature: "u",
        handler: async (context) => ({ body: [await notify(context)] }),
      },
      CloseNotification: {
        inSignature: "u",
        outSignature: "",
        handler: (context) => {
          if (disposed) throw new Error("Notification service is disposed");
          if (context.message.signature !== "u")
            throw new Error("Invalid CloseNotification signature");
          if (context.body.length !== 1) throw new Error("CloseNotification requires one ID");
          const id = uint32(context.body[0], "ID"),
            sender = producer(context);
          if (active.get(id)?.entry.sender !== sender)
            throw new Error("Notification no longer exists for this producer");
          close(id, 3);
          return {};
        },
      },
    },
  };
  return {
    descriptor,
    snapshot,
    subscribe(listener: (current: NotificationSnapshot) => void) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dismiss: (id: number, expectedRevision?: number) => !disposed && close(id, 2, expectedRevision),
    invokeAction,
    setDoNotDisturb(value: boolean) {
      if (disposed || doNotDisturb === value) return;
      doNotDisturb = value;
      changed();
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      disposed = true;
      for (const current of active.values()) current.cancel();
      active.clear();
      changed();
      listeners.clear();
      const subscriptions = [...senders.values()].map((lease) =>
        lease.subscription.then((unsubscribe) => unsubscribe()).catch(report),
      );
      senders.clear();
      disposal = Promise.all([...retirements, ...subscriptions]).then(() => {});
      return disposal;
    },
  };
}

/** Root owns invocation and presentation binding. This helper never closes its borrowed session bus. */
export async function attachNotificationService(
  bus: SessionBus,
  options: NotificationOptions = {},
) {
  const service = createNotificationService(
    {
      watchSender: (sender, changed) => bus.watchName(sender, changed),
      emitSignal: (signal) => bus.emitSignal(signal),
    },
    options,
  );
  const result = await bus.requestName(NOTIFICATIONS_BUS, 4); // DO_NOT_QUEUE; never replace another server.
  if (result !== 1) {
    await service.dispose();
    throw new Error("Another session notification server already owns the name");
  }
  const unexport = bus.exportObject(NOTIFICATIONS_PATH, service.descriptor);
  let connected = true;
  const disconnect = bus.onDisconnect(() => {
    connected = false;
    unexport();
    void service.dispose();
  });
  let detached: Promise<void> | null = null;
  return {
    ...service,
    dispose(): Promise<void> {
      if (detached) return detached;
      unexport();
      disconnect();
      detached = service.dispose().then(async () => {
        if (!connected) return;
        await bus.call({
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "ReleaseName",
          signature: "s",
          body: [NOTIFICATIONS_BUS],
        });
      });
      return detached;
    },
  };
}
