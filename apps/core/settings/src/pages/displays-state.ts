/** Displays' state: modes and layout from the compositor, with its keep-or-revert trials. */
import { useEffect, useRef, useState } from "react";
import {
  displayModeLabel,
  parseDisplayMode,
  resolutionForMode,
  type ConnectedOutput,
  type DisplayController,
  type DisplayState,
  type ParsedDisplayMode,
} from "#settings/display-service";

type PendingTrial = { deadlineMs: number };
const TRIAL_MS = 15_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Display state, polling and the keep/revert trial protocol. */
export function useDisplaySettings(display: DisplayController | null) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const refreshRequired = useRef(false);
  const trial = useRef<"mode" | "layout" | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [mode, setMode] = useState(display?.current ?? "");
  const [modes, setModes] = useState(display?.modes ?? []);
  const [preferred, setPreferred] = useState(display?.preferred ?? "");
  const [name, setName] = useState(display?.name ?? "Display");
  const [outputs, setOutputs] = useState(display?.outputs ?? []);
  const [selectedOutputId, setSelectedOutputId] = useState(
    display?.outputs.find((output) => output.primary)?.id ?? display?.outputs[0]?.id ?? "",
  );
  const [pendingLayout, setPendingLayout] = useState<PendingTrial | null>(null);
  const [selectedResolution, setSelectedResolution] = useState(
    resolutionForMode(display?.current ?? ""),
  );
  const [pendingMode, setPendingMode] = useState<PendingTrial | null>(null);
  const [countdown, setCountdown] = useState(0);

  const apply = (next: DisplayState) => {
    setModes(next.modes);
    setPreferred(next.preferred);
    setName(next.name || "Display");
    setOutputs(next.outputs);
    setMode(next.current);
    setSelectedResolution(resolutionForMode(next.current));
  };

  const run = async (
    note: string,
    request: () => Promise<boolean>,
    accepted: () => void | Promise<void>,
  ) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setStatus(note);
    try {
      if (!(await request())) throw new Error("Display service rejected the request");
      if (mounted.current) await accepted();
    } catch (error) {
      if (mounted.current) {
        setStatus(`${note.replace(/…$/, "")} failed: ${message(error)}`);
        setSelectedResolution(resolutionForMode(mode));
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // The compositor owns automatic rollback. Verify its actual state rather
  // than claiming the previous layout is active when the timer expires.
  const refreshExpiredTrial = () => {
    if (!display || operation.current) return false;
    refreshRequired.current = true;
    void run(
      "Checking display rollback…",
      async () => {
        const next = await display.getState();
        if (mounted.current) apply(next);
        return true;
      },
      () => {
        refreshRequired.current = false;
        trial.current = null;
        setPendingMode(null);
        setPendingLayout(null);
        setStatus("Display trial expired · current settings refreshed");
      },
    );
    return true;
  };

  useEffect(() => {
    const pending = pendingMode ?? pendingLayout;
    if (!pending) return;
    let checked = false;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((pending.deadlineMs - Date.now()) / 1000));
      setCountdown(remaining);
      if (!remaining && !checked) checked = refreshExpiredTrial();
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [pendingMode, pendingLayout]);

  useEffect(() => {
    if (!display) return;
    let disposed = false;
    let refreshing = false;
    const timer = setInterval(() => {
      if (refreshing || operation.current) return;
      if (trial.current) {
        if (refreshRequired.current) refreshExpiredTrial();
        return;
      }
      refreshing = true;
      const idle = () => !disposed && !operation.current && !trial.current;
      void display
        .getState()
        .then((next) => {
          if (idle()) apply(next);
        })
        .catch((error: unknown) => {
          if (idle()) setStatus(`Display service unavailable: ${message(error)}`);
        })
        .finally(() => {
          refreshing = false;
        });
    }, 2_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [display]);

  const parsedModes = modes
    .map(parseDisplayMode)
    .filter((entry): entry is ParsedDisplayMode => entry != null);

  const requestMode = (modeId: string) => {
    if (!display || modeId === mode || trial.current || operation.current) return;
    void run(
      "Changing display mode…",
      () => display.setMode(modeId),
      () => {
        trial.current = "mode";
        setMode(modeId);
        setSelectedResolution(resolutionForMode(modeId));
        setPendingMode({ deadlineMs: Date.now() + TRIAL_MS });
        setStatus("");
      },
    );
  };

  const requestResolution = (resolution: string) => {
    const candidates = parsedModes
      .filter((entry) => entry.resolution === resolution)
      .sort((a, b) => {
        if (a.id === preferred) return -1;
        if (b.id === preferred) return 1;
        return b.refreshMilliHz - a.refreshMilliHz;
      });
    if (candidates[0]) requestMode(candidates[0].id);
  };

  const confirmMode = () => {
    if (!display || !pendingMode) return;
    void run("Keeping display mode…", display.confirmMode, () => {
      trial.current = null;
      setPendingMode(null);
      setStatus(`Kept ${displayModeLabel(mode)}`);
    });
  };

  const revertMode = () => {
    if (!display || !pendingMode) return;
    void run("Reverting display mode…", display.revertMode, async () => {
      refreshRequired.current = true;
      const next = await display.getState();
      if (!mounted.current) return;
      apply(next);
      refreshRequired.current = false;
      trial.current = null;
      setPendingMode(null);
      setStatus(`Reverted to ${displayModeLabel(next.current)}`);
    });
  };

  const requestLayout = (next: ConnectedOutput[]) => {
    if (!display || trial.current || operation.current) return;
    const normalized = next.map((output) => {
      const parsed = parseDisplayMode(output.mode);
      return parsed
        ? {
            ...output,
            width: Math.max(1, Math.round((parsed.width * 120) / output.scale120)),
            height: Math.max(1, Math.round((parsed.height * 120) / output.scale120)),
          }
        : output;
    });
    void run(
      "Applying display arrangement…",
      () => display.setLayout(normalized),
      () => {
        trial.current = "layout";
        setOutputs(normalized);
        setPendingLayout({ deadlineMs: Date.now() + TRIAL_MS });
        setStatus("");
      },
    );
  };

  const confirmLayout = () => {
    if (!display || !pendingLayout) return;
    void run("Keeping display arrangement…", display.confirmLayout, () => {
      trial.current = null;
      setPendingLayout(null);
      setStatus("Display arrangement saved");
    });
  };

  const revertLayout = () => {
    if (!display || !pendingLayout) return;
    void run("Reverting display arrangement…", display.revertLayout, async () => {
      refreshRequired.current = true;
      const next = await display.getState();
      if (!mounted.current) return;
      apply(next);
      refreshRequired.current = false;
      trial.current = null;
      setPendingLayout(null);
      setStatus("Display arrangement reverted");
    });
  };

  return {
    available: display != null,
    status,
    busy,
    locked: busy || pendingMode != null || pendingLayout != null,
    mode,
    preferred,
    name,
    outputs,
    parsedModes,
    selectedOutputId,
    setSelectedOutputId,
    selectedResolution,
    pendingMode,
    pendingLayout,
    countdown,
    requestMode,
    requestResolution,
    confirmMode,
    revertMode,
    requestLayout,
    confirmLayout,
    revertLayout,
  };
}

export type DisplaySettings = ReturnType<typeof useDisplaySettings>;

export function displaySummary(state: DisplaySettings): string {
  if (state.outputs.length > 1)
    return `${state.outputs.length} displays · ${state.outputs.map((output) => output.name).join(" + ")}`;
  return state.available ? state.name : "Display service unavailable";
}
