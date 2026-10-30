/**
 * Launcher pins: desktop entry ids (`org.moire.Files.desktop`) the launcher lists first, in the
 * user's order. Pure functions over the list; `launcher-settings.ts` reads and writes it.
 */

/** Enough for a full first screen of the launcher; a hand-edited file can't cost more. */
export const MAX_LAUNCHER_PINS = 32;
const MAX_ID_LENGTH = 255;

function validId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && !/[\0/]/.test(id);
}

/** External JSON narrowed to unique, valid ids, first occurrence wins, capped. */
export function normalizeLauncherPins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(validId);
  return [...new Set(ids)].slice(0, MAX_LAUNCHER_PINS);
}

export function isLauncherPinned(pins: readonly string[], id: string): boolean {
  return pins.includes(id);
}

/** Pin `id` last; already pinned or full leaves the list as it is. */
export function pinLauncherApp(pins: readonly string[], id: string): string[] {
  if (!validId(id) || pins.includes(id) || pins.length >= MAX_LAUNCHER_PINS) return [...pins];
  return [...pins, id];
}

export function unpinLauncherApp(pins: readonly string[], id: string): string[] {
  return pins.filter((pin) => pin !== id);
}

/** Pin or unpin, whichever `id` isn't. */
export function toggleLauncherPin(pins: readonly string[], id: string): string[] {
  return pins.includes(id) ? unpinLauncherApp(pins, id) : pinLauncherApp(pins, id);
}

/** Move a pin `by` places (−1 earlier, +1 later), stopping at either end. */
export function moveLauncherPin(pins: readonly string[], id: string, by: number): string[] {
  const from = pins.indexOf(id);
  if (from < 0) return [...pins];
  const to = Math.max(0, Math.min(pins.length - 1, from + Math.trunc(by)));
  const next = pins.filter((pin) => pin !== id);
  next.splice(to, 0, id);
  return next;
}

/**
 * The launcher's order: installed pinned apps in pin order, then every other app in its own
 * order. Pins for apps that aren't installed are skipped, not dropped from the prefs, so an app
 * that comes back keeps its place.
 */
export function orderLauncherApps<App extends { id: string }>(
  apps: readonly App[],
  pins: readonly string[],
): App[] {
  if (!pins.length) return [...apps];
  const byId = new Map(apps.map((app) => [app.id, app]));
  const pinned = pins.flatMap((id) => byId.get(id) ?? []);
  const rest = apps.filter((app) => !pins.includes(app.id));
  return [...pinned, ...rest];
}
