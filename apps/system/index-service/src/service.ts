/**
 * The index service: settings decide whether it runs; a serial job queue runs walks, watcher
 * batches and text extraction one at a time, so no two passes ever race on the same folder.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readOpenedFiles } from "@moire/file-operations";
import { loadSettings } from "@moire/prefs";
import {
  EVERYWHERE,
  isInside,
  type IndexBackend,
  type IndexQuery,
  type IndexSearchResult,
  type IndexState,
  type IndexStatus,
  type KindCounts,
  type RecentFile,
} from "@moire/system-management/index-status";
import { activityGate, systemActivity, type ActivitySource, type PauseReason } from "./activity";
import {
  exclusionRules,
  readTags,
  readUserConfig,
  type ExclusionRules,
  type IndexEnvironment,
} from "./config";
import { extractText } from "./content";
import { reconcileDirectory, walk, type CrawlContext, type CrawlProgress } from "./crawler";
import { countKinds, searchIndex } from "./query";
import { recentFiles } from "./recent";
import {
  RECONCILE_INTERVAL_MS,
  UNWATCHED_RECONCILE_INTERVAL_MS,
  scheduleReconcile,
  type ReconcileSchedule,
} from "./reconcile";
import { deleteIndexDatabase, openIndexDatabase } from "./schema";
import { IndexStore } from "./store";
import { watchRoots, type WatchHandle, type WatchOptions } from "./watcher";

/**
 * What Settings › Search edits (in `settings.json`). `index.json` adds to both lists for people
 * who prefer a hand-edited file; Settings shows its entries but never rewrites it.
 */
export type IndexSettings = {
  enabled: boolean;
  excludes: readonly string[];
  /** Extra roots, such as removable drives turned on per drive. */
  includes?: readonly string[];
};

export type IndexServiceOptions = {
  env: IndexEnvironment;
  readSettings?: () => IndexSettings;
  activity?: ActivitySource;
  now?: () => number;
  /** Live updates; smokes that drive changes by hand turn this off. */
  watch?: boolean;
  watchTiming?: Pick<WatchOptions, "debounceMs" | "maxWaitMs">;
  /** React to edits of settings, `index.json`, the tag catalog and recent lists on disk. */
  watchConfig?: boolean;
};

/** Text extraction batch: small, since each file may be up to 1 MB. */
const TEXT_BATCH = 16;
/** Above this many changed folders in one watcher batch, a full reconcile is cheaper. */
const MAX_WATCH_FOLDERS = 256;
/** Status counts are an aggregate over the whole index; recount at most this often. */
const COUNTS_TTL_MS = 1000;
const CONFIG_DEBOUNCE_MS = 500;
const LAST_CRAWL_KEY = "last_crawl";

function settingsFromPrefs(): IndexSettings {
  const settings = loadSettings();
  return {
    enabled: settings.indexingEnabled,
    excludes: settings.indexExcludes,
    includes: settings.indexIncludes,
  };
}

type Session = {
  db: DatabaseSync;
  store: IndexStore;
  rules: ExclusionRules;
  roots: string[];
  abort: AbortController;
  progress: CrawlProgress;
  watcher: WatchHandle | null;
  reconcile: ReconcileSchedule | null;
  /** The signature of the settings this session was opened with. */
  signature: string;
};

export class IndexService implements IndexBackend {
  private session: Session | null = null;
  private state: IndexState = "starting";
  private message = "Starting";
  private revision = 1;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private counts: { at: number; value: ReturnType<IndexStore["counts"]> } | null = null;
  private configWatchers: fs.FSWatcher[] = [];
  private configTimer: NodeJS.Timeout | null = null;
  private applying: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly options: IndexServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    await this.applySettings();
    if (this.options.watchConfig) this.watchConfiguration();
  }

  async stop(): Promise<void> {
    for (const watcher of this.configWatchers.splice(0)) watcher.close();
    if (this.configTimer) clearTimeout(this.configTimer);
    await this.closeSession();
    this.listeners.clear();
  }

  /** Re-read settings and `index.json`; open, reopen or delete the index to match. */
  applySettings(): Promise<void> {
    this.applying = this.applying
      .then(() => this.apply())
      .catch((error: unknown) => {
        this.setState("error", error instanceof Error ? error.message : String(error));
      });
    return this.applying;
  }

  /** Resolves once every queued walk, watcher batch and extraction has finished. */
  async idle(): Promise<void> {
    await this.applying;
    for (;;) {
      const queued = this.queue;
      await queued;
      if (queued === this.queue) return;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  status(): IndexStatus {
    const session = this.session;
    let counts = { files: 0, folders: 0, withText: 0, pendingText: 0 };
    if (session) {
      if (!this.counts || this.now() - this.counts.at > COUNTS_TTL_MS)
        this.counts = { at: this.now(), value: session.store.counts() };
      counts = this.counts.value;
    }
    const lastCrawl = session?.store.meta(LAST_CRAWL_KEY);
    return {
      state: this.state,
      message: this.message,
      revision: this.revision,
      roots: session?.roots ?? [],
      ...counts,
      crawl: session ? { ...session.progress } : { directories: 0, entries: 0, queued: 0 },
      watching: session?.watcher?.mode ?? (session ? "reconcile" : "off"),
      lastCrawlAt: lastCrawl ? Number(lastCrawl) : null,
    };
  }

  async search(query: IndexQuery, scope: string, perGroup: number): Promise<IndexSearchResult> {
    const session = this.requireSession();
    return searchIndex(session.store, query, scope, perGroup, this.now());
  }

  async kindCounts(scope: string): Promise<KindCounts> {
    return countKinds(this.requireSession().store, scope);
  }

  /** Works with indexing off too: apps' own recent lists need no index. */
  async recent(limit: number): Promise<RecentFile[]> {
    const opened = await readOpenedFiles(this.options.env.recentDirectory);
    return recentFiles(this.session?.store ?? null, opened, limit, this.now());
  }

  async reindex(root: string): Promise<void> {
    const session = this.requireSession();
    const resolved = root === EVERYWHERE ? null : path.resolve(root);
    if (resolved && !session.roots.some((item) => item === resolved || isInside(resolved, item)))
      throw new RangeError(`${root} is not inside an indexed folder`);
    this.enqueue(session, async (context) => {
      session.store.requeueText(resolved);
      await walk(context, resolved ? [resolved] : session.roots);
    });
  }

  private requireSession(): Session {
    if (!this.session) throw new IndexDisabledError();
    return this.session;
  }

  private async apply(): Promise<void> {
    const settings = (this.options.readSettings ?? settingsFromPrefs)();
    if (!settings.enabled) {
      await this.closeSession();
      deleteIndexDatabase(this.options.env.database);
      this.setState("disabled", "Indexing is off");
      return;
    }
    const user = await readUserConfig(this.options.env);
    const roots = [
      this.options.env.home,
      ...[...(settings.includes ?? []), ...user.include].filter((root) => fs.existsSync(root)),
    ].filter((root, index, all) => all.indexOf(root) === index);
    const excludes = [...settings.excludes, ...user.exclude];
    const signature = JSON.stringify({ roots, excludes });
    if (this.session?.signature === signature) return;
    await this.closeSession();
    const { db } = openIndexDatabase(this.options.env.database);
    const store = new IndexStore(db);
    const session: Session = {
      db,
      store,
      rules: exclusionRules(this.options.env, excludes),
      roots,
      abort: new AbortController(),
      progress: { directories: 0, entries: 0, queued: 0 },
      watcher: null,
      reconcile: null,
      signature,
    };
    this.session = session;
    this.counts = null;
    store.replaceTags(await readTags(this.options.env));
    this.setState("crawling", "Indexing your files");
    // Roots removed from the settings (a drive turned off) leave the index with the walk below.
    this.enqueue(session, async (context) => {
      store.transaction(() => {
        for (const row of store.prepare("SELECT DISTINCT dir FROM files").all()) {
          const dir = String(row.dir);
          if (!roots.some((root) => dir === root || isInside(dir, root))) store.removeBelow(dir);
        }
      });
      await walk(context, roots);
      store.setMeta(LAST_CRAWL_KEY, String(this.now()));
      this.startWatching(session);
    });
  }

  private startWatching(session: Session): void {
    if (session.abort.signal.aborted || session.watcher) return;
    const fallback = () => {
      session.reconcile?.stop();
      session.reconcile = scheduleReconcile(UNWATCHED_RECONCILE_INTERVAL_MS, () =>
        this.fullPass(session),
      );
      this.changed();
    };
    if (this.options.watch === false) {
      session.watcher = { mode: "reconcile", close() {} };
      session.reconcile = scheduleReconcile(UNWATCHED_RECONCILE_INTERVAL_MS, () =>
        this.fullPass(session),
      );
      return;
    }
    session.watcher = watchRoots(session.roots, {
      rules: session.rules,
      ...this.options.watchTiming,
      onChanges: (paths) =>
        this.enqueue(session, (context) => this.applyChanges(session, context, paths)),
      onFailure: () => {
        session.watcher = { mode: "reconcile", close() {} };
        fallback();
      },
    });
    if (session.watcher.mode === "reconcile") fallback();
    else session.reconcile = scheduleReconcile(RECONCILE_INTERVAL_MS, () => this.fullPass(session));
  }

  private fullPass(session: Session): Promise<void> {
    return new Promise((resolve, reject) =>
      this.enqueue(
        session,
        async (context) => {
          await walk(context, session.roots);
          session.store.setMeta(LAST_CRAWL_KEY, String(this.now()));
        },
        { resolve, reject },
      ),
    );
  }

  /** Reconcile each changed path's folder, then walk folders that appeared (created or renamed). */
  private async applyChanges(
    session: Session,
    context: CrawlContext,
    paths: ReadonlySet<string>,
  ): Promise<void> {
    const folders = new Set<string>();
    for (const file of paths) {
      if (session.roots.includes(file)) {
        folders.add(file);
        continue;
      }
      folders.add(path.dirname(file));
      // A folder's own event can mean its listing changed.
      if (session.store.has(file)) folders.add(file);
    }
    if (folders.size > MAX_WATCH_FOLDERS) return walk(context, session.roots);
    const added: string[] = [];
    for (const folder of folders) {
      if (!session.roots.some((root) => folder === root || isInside(folder, root))) continue;
      const outcome = await reconcileDirectory(context, folder);
      if (outcome.kind === "read") added.push(...outcome.added);
    }
    if (added.length) await walk(context, added);
  }

  private enqueue(
    session: Session,
    job: (context: CrawlContext) => Promise<void>,
    settle?: { resolve(): void; reject(error: unknown): void },
  ): void {
    const signal = session.abort.signal;
    const gate = activityGate(this.options.activity ?? systemActivity, (reason) =>
      this.paused(reason),
    );
    const context: CrawlContext = {
      store: session.store,
      rules: session.rules,
      gate,
      signal,
      progress: session.progress,
      onChange: () => this.changed(),
    };
    this.queue = this.queue.then(async () => {
      if (signal.aborted) return settle?.resolve();
      session.progress.directories = 0;
      session.progress.entries = 0;
      try {
        await job(context);
        await this.extractPendingText(session, context);
        if (!signal.aborted) this.setState("ready", "Up to date");
        settle?.resolve();
      } catch (error) {
        if (signal.aborted) return settle?.resolve();
        this.setState("error", error instanceof Error ? error.message : String(error));
        settle?.reject(error);
      }
    });
  }

  private async extractPendingText(session: Session, context: CrawlContext): Promise<void> {
    for (;;) {
      const batch = session.store.pendingText(TEXT_BATCH);
      if (!batch.length) return;
      for (const item of batch) {
        const { body, taken } = await extractText(item.path, item.name);
        context.signal.throwIfAborted();
        session.store.storeText(item, body, taken);
      }
      this.changed();
      await context.gate.pass(context.signal);
    }
  }

  private paused(reason: PauseReason): void {
    if (reason)
      this.setState(
        "paused",
        reason === "battery"
          ? "Paused while the battery is low"
          : "Paused while the system is busy",
      );
    else this.setState("crawling", "Indexing your files");
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    session.abort.abort();
    session.watcher?.close();
    session.reconcile?.stop();
    await this.queue;
    session.db.close();
    this.counts = null;
  }

  private setState(state: IndexState, message: string): void {
    if (state === this.state && message === this.message) return;
    this.state = state;
    this.message = message;
    this.changed();
  }

  private changed(): void {
    this.revision++;
    this.counts = null;
    for (const listener of this.listeners) listener();
  }

  private watchConfiguration(): void {
    const env = this.options.env;
    const reapply = () => {
      if (this.configTimer) clearTimeout(this.configTimer);
      this.configTimer = setTimeout(() => {
        const session = this.session;
        void this.applySettings().then(async () => {
          // Same settings: the tag catalog may still have changed.
          if (session && session === this.session) {
            session.store.replaceTags(await readTags(env));
            this.changed();
          }
        });
      }, CONFIG_DEBOUNCE_MS);
    };
    const watchDirectory = (directory: string, onChange: () => void) => {
      try {
        fs.mkdirSync(directory, { recursive: true });
        this.configWatchers.push(fs.watch(directory, { persistent: false }, onChange));
      } catch {
        // Without a watch, changes apply at the next start; nothing else depends on it.
      }
    };
    watchDirectory(path.dirname(env.configFile), reapply);
    watchDirectory(env.recentDirectory, () => this.changed());
  }
}

export class IndexDisabledError extends Error {
  constructor() {
    super("Indexing is off");
    this.name = "IndexDisabledError";
  }
}
