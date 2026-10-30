/**
 * Typed client for the session's file index (`apps/system/index-service`). The service speaks
 * JSON strings over `org.moire.Index`; this module validates every reply before callers see it.
 * `createLocalIndexClient` adapts an in-process backend for smokes and tools that embed the index.
 */
import { DbusRemoteError, SessionBus } from "@moire/dbus";
import {
  parseIndexStatus,
  parseKindCounts,
  parseRecentFiles,
  parseSearchResult,
  type IndexQuery,
  type IndexSearchResult,
  type IndexStatus,
  type KindCounts,
  type RecentFile,
} from "./index-query";

export * from "./index-query";

export const INDEX_BUS = "org.moire.Index";
export const INDEX_PATH = "/org/moire/Index";
export const INDEX_INTERFACE = "org.moire.Index";

/** Search's `scope` is an absolute folder, or this for every indexed root. */
export const EVERYWHERE = "";

export type IndexCallOptions = { signal?: AbortSignal };

/** What the service implements and the client exposes; the D-Bus layer is a thin adapter. */
export type IndexBackend = {
  search(
    query: IndexQuery,
    scope: string,
    perGroup: number,
    options?: IndexCallOptions,
  ): Promise<IndexSearchResult>;
  recent(limit: number): Promise<RecentFile[]>;
  kindCounts(scope: string): Promise<KindCounts>;
  status(): IndexStatus;
  /** Walk `root` (or every root for `EVERYWHERE`) again and re-read its text. */
  reindex(root: string): Promise<void>;
  /** Called after the index or its status changes. */
  subscribe(listener: () => void): () => void;
};

export type IndexClientState =
  | { kind: "connecting" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; status: IndexStatus };

export type IndexClient = {
  readonly state: IndexClientState;
  /** Called with the current state now, then after each change. */
  subscribe(listener: (state: IndexClientState) => void): () => void;
  search(
    query: IndexQuery,
    scope: string,
    perGroup: number,
    options?: IndexCallOptions,
  ): Promise<IndexSearchResult>;
  recent(limit: number): Promise<RecentFile[]>;
  kindCounts(scope: string): Promise<KindCounts>;
  reindex(root: string): Promise<void>;
  dispose(): Promise<void>;
};

/** Ready and enabled: searches will be answered from the index rather than refused. */
export function indexSearchable(state: IndexClientState): boolean {
  return state.kind === "ready" && state.status.state !== "disabled";
}

export type IndexErrorCode = "disabled" | "invalid" | "unavailable" | "failed";
export class IndexClientError extends Error {
  constructor(
    readonly code: IndexErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IndexClientError";
  }
}
export function indexErrorName(code: IndexErrorCode): string {
  return `${INDEX_INTERFACE}.Error.${code}`;
}

function remoteFailure(error: unknown): IndexClientError {
  if (error instanceof IndexClientError) return error;
  if (error instanceof DbusRemoteError) {
    for (const code of ["disabled", "invalid", "unavailable", "failed"] as const)
      if (error.errorName === indexErrorName(code))
        return new IndexClientError(code, error.message);
  }
  return new IndexClientError("unavailable", "The file index did not answer.");
}

const READ_TIMEOUT_MS = 3000;
/** A search over a large index may take longer than a status read, but never hold Files up. */
const SEARCH_TIMEOUT_MS = 5000;
const REINDEX_TIMEOUT_MS = 10000;

/** Observe the index service on a bus the caller owns. */
export async function observeIndexStatus(bus: SessionBus): Promise<IndexClient> {
  let state: IndexClientState = { kind: "connecting" };
  let generation = 0;
  let disposed = false;
  let owner: string | null = null;
  let removeSignal: (() => Promise<void>) | null = null;
  const listeners = new Set<(state: IndexClientState) => void>();
  const publish = (next: IndexClientState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener(next);
  };
  const accept = (json: unknown, ticket: number) => {
    if (ticket !== generation) return;
    const status = parseIndexStatus(JSON.parse(String(json)));
    if (state.kind === "ready" && status.revision < state.status.revision) return;
    publish({ kind: "ready", status });
  };
  const call = async (
    member: string,
    signature: string,
    body: unknown[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    if (disposed || !owner)
      throw new IndexClientError("unavailable", "The file index is not running.");
    try {
      const reply = await bus.call(
        {
          destination: owner,
          path: INDEX_PATH,
          interface: INDEX_INTERFACE,
          member,
          signature,
          body,
        },
        { timeoutMs, signal },
      );
      return reply.body?.[0];
    } catch (error) {
      if (signal?.aborted) throw error;
      throw remoteFailure(error);
    }
  };
  const json = async (
    member: string,
    signature: string,
    body: unknown[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const value = await call(member, signature, body, timeoutMs, signal);
    try {
      return JSON.parse(String(value));
    } catch {
      throw new IndexClientError("invalid", "The file index sent an unreadable reply.");
    }
  };
  const removeOwner = await bus.watchName(
    INDEX_BUS,
    (next) => {
      const ticket = ++generation;
      owner = next;
      const previous = removeSignal;
      removeSignal = null;
      void previous?.().catch(() => {});
      if (!next) {
        publish({ kind: "unavailable", message: "The file index is not running." });
        return;
      }
      publish({ kind: "connecting" });
      void (async () => {
        const remove = await bus.subscribeSignal(
          { sender: next, path: INDEX_PATH, interface: INDEX_INTERFACE, member: "Changed" },
          (message) => {
            try {
              accept(message.body?.[0], ticket);
            } catch {
              publish({ kind: "unavailable", message: "The file index sent an invalid status." });
            }
          },
          { timeoutMs: READ_TIMEOUT_MS },
        );
        if (ticket !== generation || disposed) return void (await remove());
        removeSignal = remove;
        accept(await call("Status", "", [], READ_TIMEOUT_MS), ticket);
      })().catch(() => {
        if (ticket === generation)
          publish({ kind: "unavailable", message: "The file index did not answer." });
      });
    },
    { timeoutMs: READ_TIMEOUT_MS },
  );
  const parsed = <T>(parse: (value: unknown) => T, value: unknown): T => {
    try {
      return parse(value);
    } catch {
      throw new IndexClientError("invalid", "The file index sent an invalid reply.");
    }
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async search(query, scope, perGroup, options = {}) {
      const value = await json(
        "Search",
        "ssu",
        [JSON.stringify(query), scope, perGroup],
        SEARCH_TIMEOUT_MS,
        options.signal,
      );
      return parsed(parseSearchResult, value);
    },
    async recent(limit) {
      return parsed(parseRecentFiles, await json("Recent", "u", [limit], READ_TIMEOUT_MS));
    },
    async kindCounts(scope) {
      return parsed(parseKindCounts, await json("KindCounts", "s", [scope], READ_TIMEOUT_MS));
    },
    async reindex(root) {
      await call("Reindex", "s", [root], REINDEX_TIMEOUT_MS);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      listeners.clear();
      await Promise.allSettled([removeOwner(), removeSignal?.()]);
    },
  };
}

/** A client that owns its own session-bus connection. */
export async function connectIndexStatus(): Promise<IndexClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeIndexStatus(bus);
    return {
      get state() {
        return client.state;
      },
      subscribe: client.subscribe,
      search: client.search,
      recent: client.recent,
      kindCounts: client.kindCounts,
      reindex: client.reindex,
      dispose: () => client.dispose().finally(() => bus.close()),
    };
  } catch (error) {
    bus.close();
    throw error;
  }
}

/** The same client shape over an in-process backend: no bus, same validation of results. */
export function createLocalIndexClient(backend: IndexBackend): IndexClient {
  let state: IndexClientState = { kind: "ready", status: backend.status() };
  const listeners = new Set<(state: IndexClientState) => void>();
  const unsubscribe = backend.subscribe(() => {
    state = { kind: "ready", status: backend.status() };
    for (const listener of listeners) listener(state);
  });
  // Round-trip through JSON so local callers meet exactly what the bus would deliver.
  const wire = <T>(parse: (value: unknown) => T, value: unknown) =>
    parse(JSON.parse(JSON.stringify(value)));
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async search(query, scope, perGroup, options) {
      return wire(parseSearchResult, await backend.search(query, scope, perGroup, options));
    },
    async recent(limit) {
      return wire(parseRecentFiles, await backend.recent(limit));
    },
    async kindCounts(scope) {
      return wire(parseKindCounts, await backend.kindCounts(scope));
    },
    reindex: (root) => backend.reindex(root),
    async dispose() {
      unsubscribe();
      listeners.clear();
    },
  };
}
