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

/** How long the system's "password requests are paused" stays beside the control. */
const REFUSED_MS = 8_000;

/**
 * Run settings-service changes one name at a time, keeping which one is running, and which one
 * the system's password prompt last turned away unseen (`refused`), with its sentence, for a
 * short while.
 */
export function useSettingsCalls() {
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ name: string; message: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(null), REFUSED_MS);
    return () => clearTimeout(timer);
  }, [refused]);
  return {
    busy,
    /** The sentence for `name` if its last run was refused without a prompt; else null. */
    refused: (name: string) => (refused?.name === name ? refused.message : null),
    async run<T>(name: string, call: () => Promise<SettingsResult<T>>): Promise<SettingsResult<T>> {
      setBusy(name);
      setRefused(null);
      try {
        const result = await call();
        if (mounted.current && !result.ok && result.code === "refused")
          setRefused({ name, message: result.message });
        return result;
      } finally {
        if (mounted.current) setBusy((current) => (current === name ? null : current));
      }
    },
  };
}

export type SettingsCalls = ReturnType<typeof useSettingsCalls>;
