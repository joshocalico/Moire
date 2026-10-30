/** Names, option parsing and the caller checks shared by every portal interface. */
import {
  DbusRemoteError,
  type DbusInterface,
  type DbusMethodContext,
  type DbusVariant,
  type SessionBus,
} from "@moire/dbus";

export const PORTAL_NAME = "org.freedesktop.impl.portal.desktop.moire";
export const PORTAL_PATH = "/org/freedesktop/portal/desktop";
export const FRONTEND_NAME = "org.freedesktop.portal.Desktop";
export const REQUEST = "org.freedesktop.impl.portal.Request";
export const SESSION = "org.freedesktop.impl.portal.Session";
const REQUEST_PREFIX = "/org/freedesktop/portal/desktop/request/";
const SESSION_PREFIX = "/org/freedesktop/portal/desktop/session/";

/** Portal response codes: success, cancelled by the user, ended some other way. */
export const RESPONSE_SUCCESS = 0;
export const RESPONSE_CANCELLED = 1;
export const RESPONSE_OTHER = 2;
export type PortalResponse = 0 | 1 | 2;

export type PortalOptions = Record<string, DbusVariant>;

/** An `a{sv}` option, only when it has the expected type; anything else is the fallback. */
export function option<T>(
  options: PortalOptions | undefined,
  key: string,
  signature: string,
  fallback: T,
): T {
  const entry = options?.[key];
  return entry && entry.signature === signature ? (entry.value as T) : fallback;
}

/** Text from an untrusted caller: bounded, no control characters. */
export function plainText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .slice(0, limit);
}

export function accessDenied(detail: string): DbusRemoteError {
  return new DbusRemoteError("org.freedesktop.DBus.Error.AccessDenied", detail);
}

export function sender(context: DbusMethodContext): string {
  const name = context.message.sender;
  if (!name || !/^:[0-9]+\.[0-9]+$/.test(name)) throw accessDenied("Unauthenticated caller");
  return name;
}

export type CallerGuard = (context: DbusMethodContext) => void;

/**
 * The backend interfaces take the calling app's id as an argument, which is only trustworthy
 * from xdg-desktop-portal: it derives the id from the caller's bus credentials (cgroup, Flatpak
 * or Snap metadata). So `org.freedesktop.impl.portal.*` answers the current owner of the
 * frontend's name and nobody else. Sandboxed apps cannot reach the backend name at all; this
 * also stops a host process from borrowing another app's identity.
 */
export async function frontendGuard(bus: SessionBus): Promise<CallerGuard> {
  let owner: string | null = null;
  await bus.watchName(FRONTEND_NAME, (next) => {
    owner = next;
  });
  return (context) => {
    if (owner === null || context.message.sender !== owner)
      throw accessDenied("Only xdg-desktop-portal may call the portal backend");
  };
}

/** Apply the caller check to every method of a backend interface. */
export function guarded(guard: CallerGuard, descriptor: DbusInterface): DbusInterface {
  return {
    name: descriptor.name,
    methods: Object.fromEntries(
      Object.entries(descriptor.methods).map(([name, method]) => [
        name,
        {
          ...method,
          handler: (context: DbusMethodContext) => {
            guard(context);
            return method.handler(context);
          },
        },
      ]),
    ),
  };
}

function handlePath(value: unknown, prefix: string, kind: string): string {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    !value.startsWith(prefix) ||
    !/^\/[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*$/.test(value)
  )
    throw new DbusRemoteError("org.freedesktop.DBus.Error.InvalidArgs", `Invalid ${kind} handle`);
  return value;
}

/**
 * Export the Request object for one call. The handle must sit under the portal's request tree
 * (never over another exported object), and only the caller that made the request can Close it.
 */
export function exportRequest(
  bus: SessionBus,
  context: DbusMethodContext,
  handle: unknown,
  close: () => void,
): () => void {
  const path = handlePath(handle, REQUEST_PREFIX, "request");
  const owner = sender(context);
  return bus.exportObject(path, {
    name: REQUEST,
    methods: {
      Close: {
        inSignature: "",
        outSignature: "",
        handler: (closing) => {
          if (closing.message.sender !== owner) throw accessDenied("Not this request's caller");
          close();
          return {};
        },
      },
    },
  });
}

/** The same for a Session object (Inhibit's monitor). */
export function exportSession(
  bus: SessionBus,
  context: DbusMethodContext,
  handle: unknown,
  close: () => void,
): { path: string; remove: () => void } {
  const path = handlePath(handle, SESSION_PREFIX, "session");
  const owner = sender(context);
  const remove = bus.exportObject(path, {
    name: SESSION,
    methods: {
      Close: {
        inSignature: "",
        outSignature: "",
        handler: (closing) => {
          if (closing.message.sender !== owner) throw accessDenied("Not this session's caller");
          close();
          return {};
        },
      },
    },
  });
  return { path, remove };
}
