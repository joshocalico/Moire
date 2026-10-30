/** The effects behind Weather: requests with cancellation, cache writes, units and the clock. */
import { useEffect, useRef, useState } from "react";
import { errorText, loadAppSettings, saveAppSettings } from "@moire/app-tools";
import {
  APP_ID,
  failureOf,
  initialState,
  needsRefresh,
  parseUnits,
  reduce,
  selectedForecast,
  type Action,
  type Failure,
  type Units,
  type WeatherState,
} from "./model";
import type { Place, WeatherCache, WeatherClient } from "./weather";

export type WeatherBackend = {
  client: Pick<WeatherClient, "forecast" | "search">;
  cache: Pick<WeatherCache, "read" | "write">;
};

function storageFailure(what: string, error: unknown): Failure {
  return { kind: "storage", message: `${what}: ${errorText(error)}` };
}

export function useWeather(backend: WeatherBackend) {
  const [state, setState] = useState<WeatherState>(() => {
    try {
      return initialState(backend.cache.read());
    } catch (error) {
      return initialState([], storageFailure("Saved places could not be read", error));
    }
  });
  const stateRef = useRef(state);
  const forecastRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);

  /** Apply a transition, saving the places synchronously so the cache never lags the screen. */
  const dispatch = (action: Action) => {
    const previous = stateRef.current;
    let next = reduce(previous, action);
    if (next.entries !== previous.entries) {
      try {
        backend.cache.write(next.entries);
      } catch (error) {
        next = reduce(next, {
          type: "notice",
          failure: storageFailure("Saved places could not be written", error),
        });
      }
    }
    stateRef.current = next;
    setState(next);
  };

  /** Abandon the forecast in flight; a late answer to it must not be saved. */
  const cancelForecast = () => {
    forecastRequest.current?.abort();
    forecastRequest.current = null;
  };

  const open = async (place: Place, force: boolean) => {
    cancelForecast();
    if (stateRef.current.selected?.id !== place.id || stateRef.current.search.kind !== "idle")
      dispatch({ type: "select", place });
    if (!force && !needsRefresh(selectedForecast(stateRef.current), Date.now())) return;
    const request = new AbortController();
    forecastRequest.current = request;
    dispatch({ type: "load-started" });
    try {
      const forecast = await backend.client.forecast(place, request.signal);
      if (forecastRequest.current !== request) return;
      dispatch({ type: "load-finished", place, forecast });
    } catch (error) {
      if (forecastRequest.current !== request) return;
      dispatch({ type: "load-failed", failure: failureOf(error) });
    } finally {
      if (forecastRequest.current === request) forecastRequest.current = null;
    }
  };

  const search = async (query: string) => {
    searchRequest.current?.abort();
    const request = new AbortController();
    searchRequest.current = request;
    dispatch({ type: "search-started" });
    try {
      const places = await backend.client.search(query, request.signal);
      if (searchRequest.current === request) dispatch({ type: "search-finished", places });
    } catch (error) {
      if (searchRequest.current === request)
        dispatch({ type: "search-failed", failure: failureOf(error) });
    }
  };

  const remove = (place: Place) => {
    const wasSelected = stateRef.current.selected?.id === place.id;
    if (wasSelected) cancelForecast();
    dispatch({ type: "remove", id: place.id });
    const next = stateRef.current.selected;
    if (wasSelected && next) void open(next, false);
  };

  const clear = () => {
    cancelForecast();
    dispatch({ type: "clear" });
  };

  useEffect(() => {
    const first = stateRef.current.selected;
    if (first) void open(first, false);
    return () => {
      cancelForecast();
      searchRequest.current?.abort();
      searchRequest.current = null;
    };
  }, []);

  return {
    state,
    open: (place: Place) => void open(place, false),
    refresh: () => {
      const place = stateRef.current.selected;
      if (place) void open(place, true);
    },
    search: (query: string) => void search(query),
    remove,
    clear,
    notify: (failure: Failure) => dispatch({ type: "notice", failure }),
  };
}

/** Display units, kept in the app's settings; a failed save is reported, not lost silently. */
export function useUnits(onError: (failure: Failure) => void): [Units, (units: Units) => void] {
  const [units, setUnits] = useState(() => loadAppSettings(APP_ID, parseUnits));
  const change = (next: Units) => {
    setUnits(next);
    try {
      saveAppSettings(APP_ID, next);
    } catch (error) {
      onError(storageFailure("Units could not be saved", error));
    }
  };
  return [units, change];
}

/** The current time, refreshed each minute so "updated … ago" lines stay true. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
