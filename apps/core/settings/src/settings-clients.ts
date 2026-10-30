/**
 * The system settings services (date and time, accounts, input, power) as Settings follows them:
 * their live state, and a way to run a change that resolves to the service's own sentence when
 * it fails.
 */
import { useEffect, useRef, useState } from "react";
import type { SettingsResult } from "@moire/system-management/time-settings";

type Observable<State> = {
  readonly state: State;
  subscribe(listener: (state: State) => void): () => void;
};

/** A client's state, following its changes; null when the service isn't connected. */
export function useClientState<State>(client: Observable<State> | null): State | null {
  const [state, setState] = useState<State | null>(client?.state ?? null);
  useEffect(() => {
    if (!client) {
      setState(null);
      return;
    }
    return client.subscribe(setState);
  }, [client]);
  return state;
}

/** The ready status out of a settings service state, or null. */
export function readyStatus<Status>(
  state: { kind: string; status?: Status } | null,
): Status | null {
  return state?.kind === "ready" ? (state.status ?? null) : null;
}

/** Run settings-service changes one name at a time, keeping which one is running. */
export function useSettingsCalls() {
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return {
    busy,
    async run<T>(name: string, call: () => Promise<SettingsResult<T>>): Promise<SettingsResult<T>> {
      setBusy(name);
      try {
        return await call();
      } finally {
        if (mounted.current) setBusy((current) => (current === name ? null : current));
      }
    },
  };
}

export type SettingsCalls = ReturnType<typeof useSettingsCalls>;
