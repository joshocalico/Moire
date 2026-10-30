/**
 * org.freedesktop.impl.portal.Inhibit. The compositor owns idle handling (dim, screen off, lock,
 * idle suspend) and the lid, so an inhibit is forwarded to its org.moire.Idle1: idle keeps the
 * display awake, suspend holds off the idle suspend, logout and user switch are recorded for the
 * logout flow. The compositor releases everything this process held if it leaves the bus.
 *
 * A suspend inhibit never stops a lid close on its own: the compositor honours it there only for
 * an app the user allowed in Settings › Power. It recognises this backend by its bus name and
 * takes the frontend's app id, forwarded untouched, as the app's identity; an empty id (a host
 * app the frontend could not attribute) can never be allowed. So the request always succeeds,
 * and what it achieves is the user's choice (docs/portals.md, "Sleep blocking").
 */
import { variant, type SessionBus } from "@moire/dbus";
import {
  PORTAL_PATH,
  RESPONSE_SUCCESS,
  exportRequest,
  exportSession,
  guarded,
  option,
  plainText,
  type CallerGuard,
  type PortalOptions,
} from "./common";

export const INHIBIT = "org.freedesktop.impl.portal.Inhibit";
const COMPOSITOR = "org.moire.Display1";
const IDLE_PATH = "/org/moire/Idle1";
const IDLE = "org.moire.Idle1";
const LOCK_PATH = "/org/moire/Lock1";
const LOCK = "org.moire.Lock1";
const ALL_FLAGS = 1 | 2 | 4 | 8;
const SESSION_RUNNING = 1;
const MAX_MONITORS = 64;

export async function attachInhibit(
  bus: SessionBus,
  guard: CallerGuard,
): Promise<{ dispose(): Promise<void> }> {
  const idle = (member: string, signature: string, body: unknown[]) =>
    bus.call({
      destination: COMPOSITOR,
      path: IDLE_PATH,
      interface: IDLE,
      member,
      signature,
      body,
    });
  const monitors = new Map<string, () => void>();
  let locked = false;
  const stateChanged = (session: string) =>
    bus.emitSignal({
      path: PORTAL_PATH,
      interface: INHIBIT,
      member: "StateChanged",
      signature: "oa{sv}",
      body: [
        session,
        {
          "screensaver-active": variant("b", locked),
          // Moire's logout does not ask apps first, so a session is only ever "running".
          "session-state": variant("u", SESSION_RUNNING),
        },
      ],
    });
  const lockWatch = await bus.subscribeSignal(
    { sender: COMPOSITOR, path: LOCK_PATH, interface: LOCK, member: "LockedChanged" },
    (message) => {
      if (message.signature !== "b") return;
      locked = message.body?.[0] === true;
      for (const session of monitors.keys()) stateChanged(session);
    },
  );
  const readLocked = async () => {
    try {
      const reply = await bus.call(
        { destination: COMPOSITOR, path: LOCK_PATH, interface: LOCK, member: "GetLocked" },
        { timeoutMs: 2000 },
      );
      locked = reply.body?.[0] === true;
    } catch {
      // No lock screen in this session.
    }
  };

  const unexport = bus.exportObject(
    PORTAL_PATH,
    guarded(guard, {
      name: INHIBIT,
      methods: {
        Inhibit: {
          inSignature: "ossua{sv}",
          outSignature: "",
          handler: async (context) => {
            const [handle, appId, , flags, options] = context.body as [
              string,
              string,
              string,
              number,
              PortalOptions,
            ];
            if (!Number.isInteger(flags) || flags <= 0 || (flags & ~ALL_FLAGS) !== 0)
              throw new Error("Invalid inhibit flags");
            // The inhibitor lasts as long as its Request object; Close is how an app lets go.
            let cookie: number | null = null;
            let closed = false;
            const release = () => {
              if (cookie === null) return;
              const held = cookie;
              cookie = null;
              void idle("Uninhibit", "u", [held]).catch(() => {});
            };
            const remove = exportRequest(bus, context, handle, () => {
              closed = true;
              remove();
              release();
            });
            try {
              // The app id goes as the frontend gave it: the compositor's allowlist keys on it.
              const reply = await idle("Inhibit", "sus", [
                plainText(appId, 128),
                flags,
                plainText(option(options, "reason", "s", ""), 256),
              ]);
              cookie = Number(reply.body?.[0]);
              if (closed) release();
            } catch (error) {
              remove();
              throw error;
            }
            return {};
          },
        },
        CreateMonitor: {
          inSignature: "ooss",
          outSignature: "u",
          handler: async (context) => {
            if (monitors.size >= MAX_MONITORS) throw new Error("Too many inhibit monitors");
            const session = exportSession(bus, context, context.body[1], () => {
              monitors.get(session.path)?.();
            });
            monitors.set(session.path, () => {
              monitors.delete(session.path);
              session.remove();
            });
            await readLocked();
            // The first state follows the reply, as clients expect.
            setTimeout(() => {
              if (monitors.has(session.path)) stateChanged(session.path);
            }, 0);
            return { body: [RESPONSE_SUCCESS] };
          },
        },
        QueryEndResponse: {
          inSignature: "o",
          outSignature: "",
          handler: () => ({}),
        },
      },
    }),
  );
  return {
    async dispose() {
      unexport();
      for (const close of [...monitors.values()]) close();
      await lockWatch().catch(() => {});
    },
  };
}
