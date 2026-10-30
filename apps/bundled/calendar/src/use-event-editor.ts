/** The open event draft and the "save before leaving?" flow around it. */
import { useEffect, useRef, useState } from "react";
import {
  draftChanged,
  eventFromDraft,
  type CalendarEvent,
  type DraftKey,
  type DraftState,
  type EventDraft,
} from "./model";

/** What the user was doing when an unsaved draft stopped them: closing the window or the editor. */
export type LeaveIntent = "window" | "editor";
export type EditorState =
  | { kind: "closed" }
  | {
      kind: "open";
      draft: DraftState;
      leaving: LeaveIntent | null;
      error: string;
    };

const CLOSED: EditorState = { kind: "closed" };

export function useEventEditor(options: {
  /** Save the event; `null` when it was not saved (the store shows why). `closeNow` is false while cleanup is pending. */
  commit: (event: CalendarEvent) => { closeNow: boolean } | null;
  onStatus: (message: string) => void;
  onClose?: () => void;
  onCloseGuard?: (guard: () => boolean) => void;
}) {
  const [state, setState] = useState<EditorState>(CLOSED);
  // The close guard runs outside React's render cycle and must see the latest draft.
  const current = useRef(state);
  const update = (next: EditorState) => {
    current.current = next;
    setState(next);
  };
  const dirty = () => current.current.kind === "open" && draftChanged(current.current.draft);

  useEffect(() => {
    options.onCloseGuard?.(() => {
      const open = current.current;
      if (open.kind !== "open" || !draftChanged(open.draft)) return true;
      update({ ...open, leaving: "window" });
      return false;
    });
  }, [options.onCloseGuard]);

  const begin = (value: EventDraft) => {
    if (dirty()) {
      options.onStatus("Save or cancel the current event before opening another draft.");
      return;
    }
    update({
      kind: "open",
      draft: { value, original: value },
      leaving: null,
      error: "",
    });
  };

  const change = <K extends DraftKey>(key: K, value: EventDraft[K]) => {
    const open = current.current;
    if (open.kind !== "open") return;
    update({
      ...open,
      draft: { ...open.draft, value: { ...open.draft.value, [key]: value } },
      error: "",
    });
  };

  const leave = (intent: LeaveIntent) => {
    const open = current.current;
    if (open.kind === "open" && draftChanged(open.draft)) {
      update({ ...open, leaving: intent });
      return;
    }
    update(CLOSED);
    if (intent === "window") options.onClose?.();
  };

  const save = () => {
    const open = current.current;
    if (open.kind !== "open") return;
    let event: CalendarEvent;
    try {
      event = eventFromDraft(open.draft.value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onStatus(message);
      update({ ...open, error: message });
      return;
    }
    const saved = options.commit(event);
    if (!saved) return;
    update(CLOSED);
    if (open.leaving === "window" && saved.closeNow) options.onClose?.();
  };

  const discard = () => {
    const open = current.current;
    update(CLOSED);
    if (open.kind === "open" && open.leaving === "window") options.onClose?.();
  };

  const stay = () => {
    const open = current.current;
    if (open.kind === "open") update({ ...open, leaving: null });
  };

  return { state, begin, change, leave, save, discard, stay };
}
