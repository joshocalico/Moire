/**
 * An item to select once it is listed: a launch argument, a revealed or newly created item. Its
 * Properties open too when asked (`--properties`).
 */
import { useEffect, useRef } from "react";

export type PendingSelection = { path: string; properties: boolean };

export function useReveal(options: {
  initial: PendingSelection | null;
  loading: boolean;
  keys: readonly string[];
  select(key: string): void;
  showProperties(): void;
}) {
  const pending = useRef<PendingSelection | null>(options.initial);
  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || options.loading || !options.keys.includes(wanted.path)) return;
    pending.current = null;
    options.select(wanted.path);
    if (wanted.properties) options.showProperties();
  });
  return pending;
}
