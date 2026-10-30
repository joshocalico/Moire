/** Importing an .ics file chosen in the file chooser, and the report shown afterwards. */
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import { rememberRecentFile } from "@moire/app-tools";
import { APP_ID, readIcsFile } from "./events";
import { IcsError, type IcsImport } from "./ics";
import { mergeImported, type CalendarEvent } from "./model";
import type { ImportReport } from "./views/dialogs";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function reportOf(name: string, result: IcsImport, added: number, updated: number): ImportReport {
  const parts = [
    added ? `added ${plural(added, "event")}` : "",
    updated ? `updated ${plural(updated, "event")} imported before` : "",
  ].filter(Boolean);
  const imported = added + updated;
  return {
    title: imported ? `Imported ${plural(imported, "event")}` : "Nothing imported",
    summary: imported
      ? `From ${name}: ${parts.join(" and ")}.`
      : `None of the events in ${name} could be imported.`,
    details: [
      ...result.skipped.map((note) => `Skipped “${note.title}”: ${note.reason}.`),
      ...result.adjusted.map((note) => `“${note.title}”: ${note.reason}.`),
    ],
  };
}

export function useIcsImport(options: {
  zone: string;
  persist: (
    update: (current: readonly CalendarEvent[]) => CalendarEvent[],
    message: string,
  ) => unknown;
  onStatus: (message: string) => void;
}) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const importFile = async (file: string) => {
    const name = path.basename(file);
    options.onStatus(`Importing ${name}…`);
    let result: IcsImport;
    try {
      result = await readIcsFile(file, options.zone);
    } catch (error) {
      if (!mounted.current) return;
      const message = error instanceof IcsError ? error.message : String(error);
      options.onStatus(`Could not import ${name}: ${message}`);
      setReport({
        title: "Could not import",
        summary: `${name}: ${message}`,
        details: [],
      });
      return;
    }
    if (!mounted.current) return;
    let counts = { added: 0, updated: 0 };
    if (result.events.length) {
      const saved = options.persist(
        (current) => {
          const merged = mergeImported(current, result.events);
          counts = merged;
          return merged.events;
        },
        `Imported ${plural(result.events.length, "event")} from ${name}`,
      );
      // A failed save already shows its own prompt; there is nothing to report on top.
      if (!saved) return;
      rememberRecentFile(APP_ID, file);
    } else options.onStatus(`No events imported from ${name}`);
    // A clean import is confirmed by the status line; a report is for what needs reading.
    if (result.events.length && !result.skipped.length && !result.adjusted.length) return;
    setReport(reportOf(name, result, counts.added, counts.updated));
  };

  return { report, importFile, dismissReport: () => setReport(null) };
}
