/** View preferences: loaded once per window, saved after every change. */
import { useEffect, useState } from "react";
import { operationError } from "@moire/file-operations";
import {
  defaultPreferences,
  loadViewPreferences,
  saveViewPreferences,
  type FilesPreferences,
} from "./filesystem";

export function usePreferences(onError: (message: string) => void) {
  const [preferences, setPreferences] = useState<FilesPreferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadViewPreferences().then((value) => {
      setPreferences(value);
      setReady(true);
    });
  }, []);
  useEffect(() => {
    // Saving the defaults before the stored values load would overwrite them.
    if (ready)
      void saveViewPreferences(preferences).catch((error) => onError(operationError(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences, ready]);
  const change = (update: Partial<FilesPreferences>) =>
    setPreferences((current) => ({ ...current, ...update }));
  return [preferences, change] as const;
}
