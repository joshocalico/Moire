/**
 * org.freedesktop.impl.portal.Notification, bridged to Moire's notification server
 * (org.freedesktop.Notifications, hosted by the management service). A portal notification
 * becomes an ordinary desktop notification, so it follows the same per-app rules, Do not
 * disturb, banners and tray history as any other; its buttons come back as ActionInvoked.
 */
import { variant, type DbusVariant, type SessionBus } from "@moire/dbus";
import {
  PORTAL_PATH,
  guarded,
  option,
  plainText,
  type CallerGuard,
  type PortalOptions,
} from "./common";

export const NOTIFICATION = "org.freedesktop.impl.portal.Notification";
const SERVER = "org.freedesktop.Notifications";
const SERVER_PATH = "/org/freedesktop/Notifications";
const DEFAULT_ACTION = "default";
const MAX_TRACKED = 256;
const MAX_BUTTONS = 8;

type TrackedAction = { action: string; target?: DbusVariant };
type Tracked = {
  appId: string;
  id: string;
  /** The server's id once Notify answered; 0 while the first Notify is in flight. */
  serverId: number;
  actions: Map<string, TrackedAction>;
  removed: boolean;
  /** Add, replace and remove for one notification run in order. */
  queue: Promise<void>;
};

export type NotifyRequest = {
  summary: string;
  body: string;
  /** Flat [key, label, ...] as org.freedesktop.Notifications.Notify takes them. */
  actions: string[];
  hints: Record<string, DbusVariant>;
  targets: Map<string, TrackedAction>;
};

const URGENCY: Record<string, number> = { low: 0, normal: 1, high: 1, urgent: 2 };

/** Translate the portal's notification dictionary into a Notify call. Pure, for the smoke. */
export function notifyRequest(appId: string, notification: PortalOptions): NotifyRequest {
  const targets = new Map<string, TrackedAction>();
  const actions: string[] = [];
  const defaultAction = plainText(option(notification, "default-action", "s", ""), 256);
  if (defaultAction) {
    targets.set(DEFAULT_ACTION, {
      action: defaultAction,
      target: notification["default-action-target"],
    });
    actions.push(DEFAULT_ACTION, "Open");
  }
  const buttons = option<unknown[]>(notification, "buttons", "aa{sv}", []);
  for (const raw of buttons.slice(0, MAX_BUTTONS)) {
    const button = raw as PortalOptions;
    const label = plainText(option(button, "label", "s", ""), 256);
    const action = plainText(option(button, "action", "s", ""), 256);
    if (!label || !action) continue;
    const key = `button${targets.size}`;
    targets.set(key, { action, target: button.target });
    actions.push(key, label);
  }
  const hints: Record<string, DbusVariant> = {
    urgency: variant("y", URGENCY[option(notification, "priority", "s", "normal")] ?? 1),
  };
  // The rule key and tray grouping follow the desktop entry, which for a portal app is its id.
  if (/^[A-Za-z0-9_.-]{1,255}$/.test(appId)) hints["desktop-entry"] = variant("s", appId);
  const category = option(notification, "category", "s", "");
  if (/^[a-z0-9.-]{1,64}$/.test(category)) hints.category = variant("s", category);
  return {
    summary: plainText(option(notification, "title", "s", ""), 512),
    // The server strips markup, so a markup body degrades to its text.
    body: plainText(
      option(notification, "body", "s", "") || option(notification, "markup-body", "s", ""),
      4096,
    ),
    actions,
    hints,
    targets,
  };
}

export async function attachNotification(
  bus: SessionBus,
  guard: CallerGuard,
  options: { appName?: (appId: string) => string } = {},
): Promise<{ dispose(): Promise<void> }> {
  const tracked = new Map<string, Tracked>();
  const key = (appId: string, id: string) => `${appId}\n${id}`;
  const byServerId = (serverId: number) =>
    [...tracked.values()].find((entry) => entry.serverId === serverId && serverId !== 0);
  const server = (member: string, signature: string, body: unknown[]) =>
    bus.call({
      destination: SERVER,
      path: SERVER_PATH,
      interface: SERVER,
      member,
      signature,
      body,
    });

  const invoked = await bus.subscribeSignal(
    { sender: SERVER, path: SERVER_PATH, interface: SERVER, member: "ActionInvoked" },
    (message) => {
      if (message.signature !== "us") return;
      const entry = byServerId(Number(message.body?.[0]));
      const chosen = entry?.actions.get(String(message.body?.[1]));
      if (!entry || !chosen) return;
      bus.emitSignal({
        path: PORTAL_PATH,
        interface: NOTIFICATION,
        member: "ActionInvoked",
        signature: "sssav",
        body: [entry.appId, entry.id, chosen.action, chosen.target ? [chosen.target] : []],
      });
    },
  );
  const closed = await bus.subscribeSignal(
    { sender: SERVER, path: SERVER_PATH, interface: SERVER, member: "NotificationClosed" },
    (message) => {
      if (message.signature !== "uu") return;
      const entry = byServerId(Number(message.body?.[0]));
      if (entry && tracked.get(key(entry.appId, entry.id)) === entry)
        tracked.delete(key(entry.appId, entry.id));
    },
  );

  const add = (appId: string, id: string, notification: PortalOptions): Promise<void> => {
    const request = notifyRequest(appId, notification);
    let entry = tracked.get(key(appId, id));
    if (!entry) {
      if (tracked.size >= MAX_TRACKED) throw new Error("Too many portal notifications");
      entry = {
        appId,
        id,
        serverId: 0,
        actions: new Map(),
        removed: false,
        queue: Promise.resolve(),
      };
      tracked.set(key(appId, id), entry);
    }
    const target = entry;
    const run = target.queue.then(async () => {
      if (target.removed) return;
      try {
        const reply = await server("Notify", "susssasa{sv}i", [
          options.appName?.(appId) || appId || "Application",
          target.serverId,
          "",
          request.summary,
          request.body,
          request.actions,
          request.hints,
          -1,
        ]);
        target.serverId = Number(reply.body?.[0] ?? 0);
        target.actions = request.targets;
      } catch (error) {
        if (target.serverId === 0 && tracked.get(key(appId, id)) === target)
          tracked.delete(key(appId, id));
        throw error;
      }
    });
    target.queue = run.catch(() => {});
    return run;
  };
  const remove = (appId: string, id: string): void => {
    const entry = tracked.get(key(appId, id));
    if (!entry) return;
    entry.removed = true;
    tracked.delete(key(appId, id));
    void entry.queue.then(() => {
      if (entry.serverId !== 0)
        return server("CloseNotification", "u", [entry.serverId]).catch(() => {});
      return undefined;
    });
  };

  const unexport = bus.exportObject(
    PORTAL_PATH,
    guarded(guard, {
      name: NOTIFICATION,
      methods: {
        AddNotification: {
          inSignature: "ssa{sv}",
          outSignature: "",
          handler: async ({ body }) => {
            await add(
              plainText(body[0], 255),
              plainText(body[1], 255),
              (body[2] ?? {}) as PortalOptions,
            );
            return {};
          },
        },
        RemoveNotification: {
          inSignature: "ss",
          outSignature: "",
          handler: ({ body }) => {
            remove(plainText(body[0], 255), plainText(body[1], 255));
            return {};
          },
        },
      },
    }),
  );
  return {
    async dispose() {
      unexport();
      await Promise.allSettled([invoked(), closed()]);
    },
  };
}
