/**
 * Installed apps and the default app for each kind of file, read from the desktop entries and
 * `mimeapps.list` the way Files opens things, and written back with the same database.
 */
import { useEffect, useRef, useState } from "react";
import {
  loadMimeAssociationDatabase,
  type DesktopEntry,
  type MimeAssociationDatabase,
} from "@moire/app-discovery";
import { errorText } from "@moire/app-tools";
import type { Outcome } from "./prefs-state";

/** Kinds of thing with a default app, and the MIME types each one sets. */
export const DEFAULT_KINDS = [
  { id: "web", mimes: ["x-scheme-handler/http", "x-scheme-handler/https", "text/html"] },
  { id: "mail", mimes: ["x-scheme-handler/mailto"] },
  { id: "text", mimes: ["text/plain"] },
  { id: "images", mimes: ["image/png", "image/jpeg", "image/gif", "image/webp"] },
  { id: "music", mimes: ["audio/mpeg", "audio/flac", "audio/ogg"] },
  { id: "video", mimes: ["video/mp4", "video/webm", "video/x-matroska"] },
  { id: "pdf", mimes: ["application/pdf"] },
  { id: "archives", mimes: ["application/zip", "application/x-tar", "application/gzip"] },
] as const;
export type DefaultKind = (typeof DEFAULT_KINDS)[number]["id"];

export type AppsBackend = {
  /** Installed apps shown in menus, by name. */
  applications(): readonly DesktopEntry[];
  /** Apps that can open this MIME type, the current default first. */
  candidates(mime: string): readonly DesktopEntry[];
  setDefault(mimes: readonly string[], desktopId: string): void;
};

export function systemAppsBackend(): AppsBackend {
  let database: MimeAssociationDatabase | null = null;
  const open = () => (database ??= loadMimeAssociationDatabase());
  return {
    applications: () => open().applications,
    candidates: (mime) => open().applicationsForMime(mime),
    setDefault(mimes, desktopId) {
      for (const mime of mimes) open().setDefaultApplication(mime, desktopId);
    },
  };
}

export type AppsCatalog =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      apps: readonly DesktopEntry[];
      /** Apps for each kind, the default first; empty when nothing installed handles it. */
      choices: Readonly<Record<DefaultKind, readonly DesktopEntry[]>>;
    };

function readCatalog(backend: AppsBackend): AppsCatalog {
  try {
    const choices = Object.fromEntries(
      DEFAULT_KINDS.map((kind) => [kind.id, backend.candidates(kind.mimes[0])]),
    ) as Record<DefaultKind, readonly DesktopEntry[]>;
    const apps = [...backend.applications()].sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "ready", apps, choices };
  } catch (error) {
    return { kind: "error", message: `Couldn't read installed apps: ${errorText(error)}` };
  }
}

/** Read lazily after the first frame: discovery walks every applications folder. */
export function useApps(backend: AppsBackend) {
  const [catalog, setCatalog] = useState<AppsCatalog>({ kind: "loading" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timer = setTimeout(() => {
      if (mounted.current) setCatalog(readCatalog(backend));
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [backend]);
  return {
    catalog,
    setDefault(kind: DefaultKind, desktopId: string): Outcome<null> {
      const mimes = DEFAULT_KINDS.find((entry) => entry.id === kind)!.mimes;
      try {
        backend.setDefault(mimes, desktopId);
        setCatalog(readCatalog(backend));
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, message: `Couldn't change the default app: ${errorText(error)}` };
      }
    },
  };
}

export type Apps = ReturnType<typeof useApps>;
