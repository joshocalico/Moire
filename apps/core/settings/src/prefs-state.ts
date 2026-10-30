/**
 * Preferences as Settings edits them: each change writes `settings.json`, applies what it
 * affects (the active theme file the shell and apps watch, GTK), and is journalled so
 * Overview can list it and Undo can put the old value back.
 */
import { useEffect, useRef, useState } from "react";
import { setUiScaleFactor } from "@moire/ui";
import {
  applyGtkAppearance,
  updateSettings,
  writeActiveTheme,
  type MoireSettings,
} from "@moire/prefs";
import { errorText } from "@moire/app-tools";
import type { SidebarPageId } from "./catalog";
import {
  loadJournal,
  newEntryId,
  recordChange,
  saveJournal,
  withoutEntry,
  type JournalEntry,
  type JournalKey,
} from "./history";

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

/** Fields whose change rewrites the active theme (colours, wallpaper). */
const THEME_KEYS: readonly (keyof MoireSettings)[] = ["dark", "themeFamily", "accent", "wallpaper"];

/** Write fields and apply them to the host; the latest file wins over a stale snapshot. */
export function writePrefs(patch: Partial<MoireSettings>): Outcome<MoireSettings> {
  try {
    const next = updateSettings(patch);
    if (THEME_KEYS.some((key) => key in patch)) writeActiveTheme(next);
    if ("dark" in patch || "uiScale" in patch) applyGtkAppearance(next.dark, next.uiScale);
    return { ok: true, value: next };
  } catch (error) {
    return { ok: false, message: `Couldn't save settings: ${errorText(error)}` };
  }
}

export type Change = { label: string; page: SidebarPageId };

/** The journal: newest first, saved after every change, with failures as a message. */
export function useJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>(loadJournal);
  const [error, setError] = useState<string | null>(null);
  const commit = (next: JournalEntry[]) => {
    setEntries(next);
    const saved = saveJournal(next);
    setError(saved.ok ? null : saved.message);
  };
  return {
    entries,
    error,
    record(items: readonly { key: JournalKey; from: unknown; to: unknown }[], change: Change) {
      commit(
        items.reduce(
          (journal, item) =>
            recordChange(journal, { ...item, ...change }, Date.now(), newEntryId()),
          entries,
        ),
      );
    },
    remove(id: string) {
      commit(withoutEntry(entries, id));
    },
  };
}

export type Journal = ReturnType<typeof useJournal>;

/** Delay before an interface-size drag is saved, so dragging doesn't write every step. */
const SCALE_SAVE_MS = 120;

export function usePrefs(
  initial: MoireSettings,
  journal: Journal,
  saveReducedMotion?: (value: boolean) => Promise<void>,
) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [motionSaving, setMotionSaving] = useState(false);
  const scaleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleFrom = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      if (scaleTimer.current) clearTimeout(scaleTimer.current);
    },
    [],
  );

  /** Write a patch; journal it unless it is an undo. */
  const apply = (patch: Partial<MoireSettings>, change: Change | null, from = values) => {
    const result = writePrefs(patch);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setError(null);
    setValues(result.value);
    if (patch.uiScale != null) setUiScaleFactor(result.value.uiScale);
    if (change)
      journal.record(
        (Object.keys(patch) as (keyof MoireSettings)[]).map((key) => ({
          key,
          from: from[key],
          to: result.value[key],
        })),
        change,
      );
    return true;
  };

  return {
    values,
    error,
    motionSaving,
    set: (patch: Partial<MoireSettings>, change: Change) => apply(patch, change),
    /** Put a journalled value back without journalling the undo itself. */
    restore: (patch: Partial<MoireSettings>) => apply(patch, null),
    /** Follow an interface-size drag live and save it once the drag rests. */
    setScaleLive(scale: number, page: SidebarPageId) {
      scaleFrom.current ??= values.uiScale;
      setValues((current) => ({ ...current, uiScale: scale }));
      setUiScaleFactor(scale);
      if (scaleTimer.current) clearTimeout(scaleTimer.current);
      scaleTimer.current = setTimeout(() => {
        const from = { ...values, uiScale: scaleFrom.current ?? values.uiScale };
        scaleFrom.current = null;
        apply(
          { uiScale: scale },
          { label: `Interface size set to ${Math.round(scale * 100)}%`, page },
          from,
        );
      }, SCALE_SAVE_MS);
    },
    /** Reduced motion goes through the session so open apps follow it at once. */
    setReducedMotion(value: boolean, page: SidebarPageId) {
      if (motionSaving) return;
      const from = values.reducedMotion;
      const label = value ? "Reduce motion turned on" : "Reduce motion turned off";
      if (!saveReducedMotion) {
        apply({ reducedMotion: value }, { label, page });
        return;
      }
      setMotionSaving(true);
      void saveReducedMotion(value)
        .then(() => {
          if (!mounted.current) return;
          setError(null);
          setValues((current) => ({ ...current, reducedMotion: value }));
          journal.record([{ key: "reducedMotion", from, to: value }], { label, page });
        })
        .catch((reason: unknown) => {
          if (mounted.current)
            setError(`Couldn't save the motion preference: ${errorText(reason)}`);
        })
        .finally(() => {
          if (mounted.current) setMotionSaving(false);
        });
    },
  };
}

export type Prefs = ReturnType<typeof usePrefs>;
