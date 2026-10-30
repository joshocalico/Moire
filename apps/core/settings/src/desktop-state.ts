/**
 * The desktop controls' live state (Wi‑Fi, Bluetooth, battery, sound, notifications), the same
 * snapshot Quick Settings shows, and a way to run one of its actions with the failure kept as a
 * message for the page that asked.
 */
import { useEffect, useRef, useState } from "react";
import { errorText } from "@moire/app-tools";
import type {
  DesktopStatusClient,
  DesktopStatusSnapshot,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import type { DesktopStatusSource } from "./services";

export function useDesktopStatus(source: DesktopStatusSource | null) {
  const [state, setState] = useState<DesktopStatusState | null>(source?.client.state ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => (source ? source.subscribe(setState) : undefined), [source]);
  const snapshot: DesktopStatusSnapshot | null = state?.kind === "ready" ? state.snapshot : null;
  return {
    state,
    snapshot,
    owner: state?.kind === "ready" ? state.owner : null,
    client: source?.client ?? null,
    /** The action running now, by name, so its control can say so. */
    busy,
    /**
     * Run an action; resolves to a failure message, or null when it worked. `name` marks the
     * action busy until it settles.
     */
    async run(
      name: string,
      action: (client: DesktopStatusClient) => Promise<unknown>,
    ): Promise<string | null> {
      const client = source?.client;
      if (!client) return "Desktop controls aren't running";
      setBusy(name);
      try {
        await action(client);
        return null;
      } catch (error) {
        return errorText(error);
      } finally {
        if (mounted.current) setBusy((current) => (current === name ? null : current));
      }
    },
  };
}

export type DesktopStatus = ReturnType<typeof useDesktopStatus>;
