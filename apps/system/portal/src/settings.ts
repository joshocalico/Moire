/**
 * org.freedesktop.impl.portal.Settings: Moire's appearance settings as `org.freedesktop.appearance`.
 *
 *   color-scheme   u    1 prefer dark, 2 prefer light (Moire always has one or the other)
 *   accent-color   (ddd) sRGB in 0..1: the person's accent, else the theme style's own
 *   contrast       u    0; Moire has no increased-contrast setting yet
 *   reduced-motion u    1 when Settings > Accessibility > Reduce motion is on, else 0
 *
 * Values come from ~/.config/moire/settings.json, the file Settings and the appearance schedule
 * write, so a change made anywhere reaches portal clients as SettingChanged.
 */
import fs from "node:fs";
import { DbusRemoteError, variant, type DbusVariant, type SessionBus } from "@moire/dbus";
import { configDir, loadSettings, themeForSettings, type MoireSettings } from "@moire/prefs";
import { PORTAL_PATH, guarded, type CallerGuard } from "./common";

export const SETTINGS = "org.freedesktop.impl.portal.Settings";
export const APPEARANCE = "org.freedesktop.appearance";

export type Appearance = Record<string, DbusVariant>;

/** `#rrggbb` as the portal's (ddd); out-of-range values mean "no accent" to clients. */
function accentTuple(color: string | undefined): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color ?? "");
  if (!match) return [-1, -1, -1];
  return [match[1]!, match[2]!, match[3]!].map((hex) => parseInt(hex, 16) / 255) as [
    number,
    number,
    number,
  ];
}

export function appearanceOf(settings: MoireSettings): Appearance {
  let accent = settings.accent ?? undefined;
  if (!accent) {
    try {
      accent = themeForSettings(settings).tokens.accent;
    } catch {
      accent = undefined;
    }
  }
  return {
    "color-scheme": variant("u", settings.dark ? 1 : 2),
    "accent-color": variant("(ddd)", accentTuple(accent)),
    contrast: variant("u", 0),
    "reduced-motion": variant("u", settings.reducedMotion ? 1 : 0),
  };
}

/** The spec's namespace patterns: an exact name, or a prefix ending in `*`; none means all. */
function namespaceMatches(patterns: readonly string[], namespace: string): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((pattern) =>
    pattern === ""
      ? true
      : pattern.endsWith("*")
        ? namespace.startsWith(pattern.slice(0, -1))
        : pattern === namespace,
  );
}

export type SettingsPortalOptions = {
  read?: () => Appearance;
  /** The fallback poll for filesystems where watching is unavailable. */
  pollMs?: number;
};

export function attachSettings(
  bus: SessionBus,
  guard: CallerGuard,
  options: SettingsPortalOptions = {},
): { refresh(): void; dispose(): void } {
  const read = options.read ?? (() => appearanceOf(loadSettings()));
  let current = read();
  const refresh = () => {
    let next: Appearance;
    try {
      next = read();
    } catch {
      return;
    }
    const previous = current;
    current = next;
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue;
      bus.emitSignal({
        path: PORTAL_PATH,
        interface: SETTINGS,
        member: "SettingChanged",
        signature: "ssv",
        body: [APPEARANCE, key, value],
      });
    }
  };
  const unexport = bus.exportObject(
    PORTAL_PATH,
    guarded(guard, {
      name: SETTINGS,
      methods: {
        ReadAll: {
          inSignature: "as",
          outSignature: "a{sa{sv}}",
          handler: ({ body }) => {
            const patterns = Array.isArray(body[0]) ? (body[0] as unknown[]).map(String) : [];
            refresh();
            return {
              body: [namespaceMatches(patterns, APPEARANCE) ? { [APPEARANCE]: current } : {}],
            };
          },
        },
        Read: {
          inSignature: "ss",
          outSignature: "v",
          handler: ({ body }) => {
            refresh();
            const value = body[0] === APPEARANCE ? current[String(body[1])] : undefined;
            if (!value)
              throw new DbusRemoteError(
                "org.freedesktop.portal.Error.NotFound",
                "Requested setting not found",
              );
            return { body: [value] };
          },
        },
      },
    }),
  );

  // Settings replaces the file by rename, so watch its directory; the poll covers the rest.
  let watcher: fs.FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    watcher = fs.watch(configDir(), () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(refresh, 50);
    });
    watcher.on("error", () => {});
  } catch {
    watcher = null;
  }
  const poll = setInterval(refresh, options.pollMs ?? 2000);
  return {
    refresh,
    dispose() {
      unexport();
      watcher?.close();
      if (debounce) clearTimeout(debounce);
      clearInterval(poll);
    },
  };
}
