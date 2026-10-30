/** `org.moire.Index` on the session bus: a thin JSON adapter over the service. */
import { DbusRemoteError, type DbusMethodContext, type SessionBus } from "@moire/dbus";
import {
  INDEX_INTERFACE,
  INDEX_PATH,
  indexErrorName,
  parseIndexQuery,
  type IndexBackend,
} from "@moire/system-management/index-status";

/** `Changed` is coalesced: during a crawl the index changes every batch. */
const CHANGED_SIGNAL_INTERVAL_MS = 500;
/** Bounds on what a caller may ask for in one reply. */
const MAX_PER_GROUP = 200;
const MAX_RECENT = 200;
const MAX_ARGUMENT = 64 * 1024;

function argumentsFor(context: DbusMethodContext, signature: string): unknown[] {
  if ((context.message.signature ?? "") !== signature)
    throw new DbusRemoteError(indexErrorName("invalid"), "Unexpected arguments");
  return context.body;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_ARGUMENT)
    throw new DbusRemoteError(indexErrorName("invalid"), "Invalid text argument");
  return value;
}

function scopePath(value: unknown): string {
  const scope = text(value);
  if (scope && !scope.startsWith("/"))
    throw new DbusRemoteError(indexErrorName("invalid"), "Scope must be an absolute folder");
  return scope;
}

function bounded(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    throw new DbusRemoteError(indexErrorName("invalid"), "Invalid limit");
  return Math.min(value, max);
}

/** Service failures become the interface's named errors, so clients can tell them apart. */
async function answer(run: () => Promise<unknown> | unknown): Promise<{ body: unknown[] }> {
  try {
    const value = await run();
    return { body: value === undefined ? [] : [JSON.stringify(value)] };
  } catch (error) {
    if (error instanceof DbusRemoteError) throw error;
    if (error instanceof Error && error.name === "IndexDisabledError")
      throw new DbusRemoteError(indexErrorName("disabled"), error.message);
    if (error instanceof RangeError || error instanceof SyntaxError)
      throw new DbusRemoteError(indexErrorName("invalid"), error.message);
    throw new DbusRemoteError(
      indexErrorName("failed"),
      error instanceof Error ? error.message : "Index failure",
    );
  }
}

export function attachIndexInterface(bus: SessionBus, backend: IndexBackend): () => void {
  let timer: NodeJS.Timeout | null = null;
  let lastSent = 0;
  const emit = () => {
    timer = null;
    lastSent = performance.now();
    try {
      bus.emitSignal({
        path: INDEX_PATH,
        interface: INDEX_INTERFACE,
        member: "Changed",
        signature: "s",
        body: [JSON.stringify(backend.status())],
      });
    } catch {
      // The bus is gone; the disconnect handler retires the service.
    }
  };
  const unsubscribe = backend.subscribe(() => {
    if (timer) return;
    const wait = Math.max(0, CHANGED_SIGNAL_INTERVAL_MS - (performance.now() - lastSent));
    timer = setTimeout(emit, wait);
  });
  const unexport = bus.exportObject(INDEX_PATH, {
    name: INDEX_INTERFACE,
    methods: {
      Search: {
        inSignature: "ssu",
        outSignature: "s",
        handler: (context) => {
          const [query, scope, perGroup] = argumentsFor(context, "ssu");
          return answer(() => {
            let parsed;
            try {
              parsed = parseIndexQuery(JSON.parse(text(query)));
            } catch (error) {
              throw new RangeError(error instanceof Error ? error.message : "Invalid query");
            }
            return backend.search(parsed, scopePath(scope), bounded(perGroup, MAX_PER_GROUP));
          });
        },
      },
      Recent: {
        inSignature: "u",
        outSignature: "s",
        handler: (context) => {
          const [limit] = argumentsFor(context, "u");
          return answer(() => backend.recent(bounded(limit, MAX_RECENT)));
        },
      },
      KindCounts: {
        inSignature: "s",
        outSignature: "s",
        handler: (context) => {
          const [scope] = argumentsFor(context, "s");
          return answer(() => backend.kindCounts(scopePath(scope)));
        },
      },
      Status: {
        inSignature: "",
        outSignature: "s",
        handler: (context) => {
          argumentsFor(context, "");
          return answer(() => backend.status());
        },
      },
      Reindex: {
        inSignature: "s",
        outSignature: "",
        handler: async (context) => {
          const [root] = argumentsFor(context, "s");
          await answer(() => backend.reindex(scopePath(root)));
          return {};
        },
      },
    },
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
    unexport();
  };
}
