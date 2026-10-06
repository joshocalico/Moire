/**
 * Moire Settings — out-of-process @moire/ui app with real prefs apply.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, useState, useEffect, useRef, type ReactNode } from "react";
import {
  Application,
  Window,
  Column,
  Row,
  Label,
  Button,
  Toggle,
  Separator,
  Tabs,
  Slider,
  ProgressBar,
  ScrollArea,
  Surface,
  PropertyList,
  OverlayHost,
  Select,
  SegmentedControl,
  usePalette,
  setUiScaleFactor,
  getUiScaleFactor,
  DisplayArrangement,
  type DisplayArrangementItem,
  type WindowSize,
} from "@moire/ui";
import {
  applySettings,
  updateSettings,
  loadSettings,
  readSystemVolume,
  type MoireSettings,
  type WallpaperSettings,
} from "@moire/prefs";
import { SessionBus } from "@moire/dbus";
import { THEME_FAMILIES, THEME_FAMILY_LABELS, parseThemeFamily } from "@moire/theme";

type DisplayController = DisplayState & {
  getState: () => Promise<DisplayState>;
  setMode: (modeId: string) => Promise<boolean>;
  confirmMode: () => Promise<boolean>;
  revertMode: () => Promise<boolean>;
  setLayout: (outputs: ConnectedOutput[]) => Promise<boolean>;
  confirmLayout: () => Promise<boolean>;
  revertLayout: () => Promise<boolean>;
};

type DisplayState = {
  modes: string[];
  current: string;
  preferred: string;
  name: string;
  widthMm: number;
  heightMm: number;
  outputs: ConnectedOutput[];
};

type ConnectedOutput = {
  id: string;
  name: string;
  make: string;
  model: string;
  serial: string;
  mode: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale120: number;
  primary: boolean;
};

type ParsedDisplayMode = {
  id: string;
  width: number;
  height: number;
  refreshMilliHz: number;
  resolution: string;
};

type PendingDisplayMode = {
  previous: string;
  target: string;
  deadlineMs: number;
};

/** Appearance / Sound body height so parent Yoga gets a real flex slot (nested
 *  Columns without height collapse to 0 and overlap siblings). */
const BODY_MIN_H = 380;

export function SettingsApp(
  props: WindowSize & {
    onQuit: () => void;
    initial: MoireSettings;
    reducedMotion?: boolean;
    onReducedMotionChange?: (value: boolean) => Promise<void>;
    display: DisplayController | null;
  },
): ReactNode {
  const pal = usePalette();
  const [tab, setTab] = useState(
    Math.max(0, Math.min(3, Number(process.env.MOIRE_SETTINGS_TAB ?? 0))),
  );
  const [dark, setDark] = useState(props.initial.dark);
  const [themeFamily, setThemeFamily] = useState(props.initial.themeFamily);
  const [notifs, setNotifs] = useState(props.initial.notifications);
  const [volume, setVolume] = useState(props.initial.volume);
  const [scale, setScale] = useState(sliderFromUiScale(props.initial.uiScale));
  const [showDesktopIcons, setShowDesktopIcons] = useState(props.initial.showDesktopIcons);
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(props.initial.wallpaper);
  const [status, setStatus] = useState("");
  const [motionSaving, setMotionSaving] = useState(false);
  const [displayStatus, setDisplayStatus] = useState("");
  const [displayBusy, setDisplayBusy] = useState(false);
  const displayOperation = useRef(false);
  const displayRefreshRequired = useRef(false);
  const displayTrial = useRef<"mode" | "layout" | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [displayMode, setDisplayMode] = useState(props.display?.current ?? "");
  const [displayModes, setDisplayModes] = useState(props.display?.modes ?? []);
  const [displayPreferred, setDisplayPreferred] = useState(props.display?.preferred ?? "");
  const [displayName, setDisplayName] = useState(props.display?.name ?? "Display");
  const [connectedOutputs, setConnectedOutputs] = useState(props.display?.outputs ?? []);
  const [selectedOutputId, setSelectedOutputId] = useState(
    props.display?.outputs.find((output) => output.primary)?.id ??
      props.display?.outputs[0]?.id ??
      "",
  );
  const [pendingDisplayLayout, setPendingDisplayLayout] = useState<{
    previous: ConnectedOutput[];
    deadlineMs: number;
  } | null>(null);
  const [selectedResolution, setSelectedResolution] = useState(
    resolutionForMode(props.display?.current ?? ""),
  );
  const [pendingDisplayMode, setPendingDisplayMode] = useState<PendingDisplayMode | null>(null);
  const [displayCountdown, setDisplayCountdown] = useState(0);
  const volumeReady = useRef(false);
  const ui = getUiScaleFactor();
  const pad = Math.round(16 * ui);
  const innerW = Math.max(1, props.width - pad * 2);
  const bodyH = Math.max(1, props.height - pad * 2);
  const bodyMin = Math.round(BODY_MIN_H * ui);
  const labelH = Math.round(20 * ui);
  const titleH = Math.round(28 * ui);
  const tabH = Math.round(32 * ui);
  const footH = Math.round(40 * ui);
  const btnH = Math.round(36 * ui);
  const sliderH = Math.round(24 * ui);

  const push = (patch: Partial<MoireSettings>, note?: string) => {
    const next = updateSettings(patch);
    if (patch.dark != null) setDark(patch.dark);
    if (patch.themeFamily != null) setThemeFamily(patch.themeFamily);
    if (patch.notifications != null) setNotifs(patch.notifications);
    if (patch.volume != null) setVolume(patch.volume);
    if (patch.uiScale != null) setScale(sliderFromUiScale(patch.uiScale));
    if (patch.showDesktopIcons != null) setShowDesktopIcons(patch.showDesktopIcons);
    if ("wallpaper" in patch) setWallpaper(patch.wallpaper ?? null);
    const result = applySettings(next);
    setUiScaleFactor(next.uiScale);
    setStatus(
      note ??
        (result.volume.ok ? `Saved · ${result.theme.name}` : `Saved · ${result.volume.detail}`),
    );
  };

  const scaleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setScaleLive = (v: number) => {
    setScale(v);
    setUiScaleFactor(uiScaleFromSlider(v));
    if (scaleTimer.current) clearTimeout(scaleTimer.current);
    scaleTimer.current = setTimeout(() => {
      push(
        { uiScale: uiScaleFromSlider(v) },
        `UI scale ${Math.round(uiScaleFromSlider(v) * 100)}%`,
      );
    }, 120);
  };

  useEffect(
    () => () => {
      if (scaleTimer.current) clearTimeout(scaleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2200);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    if (!volumeReady.current) {
      volumeReady.current = true;
      return;
    }
    const t = setTimeout(() => {
      push({ volume }, `Volume ${Math.round(volume * 100)}%`);
    }, 80);
    return () => clearTimeout(t);
  }, [volume]);

  const updateDisplayState = (next: DisplayState) => {
    setDisplayModes(next.modes);
    setDisplayPreferred(next.preferred);
    setDisplayName(next.name || "Display");
    setConnectedOutputs(next.outputs);
    setDisplayMode(next.current);
    setSelectedResolution(resolutionForMode(next.current));
  };

  const runDisplayOperation = async (
    note: string,
    operation: () => Promise<boolean>,
    accepted: () => void | Promise<void>,
  ) => {
    if (displayOperation.current) return;
    displayOperation.current = true;
    setDisplayBusy(true);
    setDisplayStatus(note);
    try {
      if (!(await operation())) throw new Error("Display service rejected the request");
      if (mounted.current) await accepted();
    } catch (error) {
      if (mounted.current) {
        setDisplayStatus(
          `${note.replace(/…$/, "")} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        setSelectedResolution(resolutionForMode(displayMode));
      }
    } finally {
      displayOperation.current = false;
      if (mounted.current) setDisplayBusy(false);
    }
  };

  // The compositor owns automatic rollback. Verify its actual state rather
  // than claiming the previous layout is active when the timer expires.
  const refreshExpiredTrial = () => {
    const display = props.display;
    if (!display || displayOperation.current) return false;
    displayRefreshRequired.current = true;
    void runDisplayOperation(
      "Checking display rollback…",
      async () => {
        const next = await display.getState();
        if (mounted.current) updateDisplayState(next);
        return true;
      },
      () => {
        displayRefreshRequired.current = false;
        displayTrial.current = null;
        setPendingDisplayMode(null);
        setPendingDisplayLayout(null);
        setDisplayStatus("Display trial expired · current settings refreshed");
      },
    );
    return true;
  };

  useEffect(() => {
    const trial = pendingDisplayMode ?? pendingDisplayLayout;
    if (!trial) return;
    let checked = false;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((trial.deadlineMs - Date.now()) / 1000));
      setDisplayCountdown(remaining);
      if (!remaining && !checked) checked = refreshExpiredTrial();
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [pendingDisplayMode, pendingDisplayLayout]);

  useEffect(() => {
    const display = props.display;
    if (!display) return;
    let disposed = false;
    let refreshing = false;
    const timer = setInterval(() => {
      if (refreshing || displayOperation.current) return;
      if (displayTrial.current) {
        if (displayRefreshRequired.current) refreshExpiredTrial();
        return;
      }
      refreshing = true;
      void display
        .getState()
        .then((next) => {
          if (!disposed && !displayOperation.current && !displayTrial.current)
            updateDisplayState(next);
        })
        .catch((error: unknown) => {
          if (!disposed && !displayOperation.current && !displayTrial.current)
            setDisplayStatus(
              `Display service unavailable: ${error instanceof Error ? error.message : String(error)}`,
            );
        })
        .finally(() => {
          refreshing = false;
        });
    }, 2_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [props.display]);

  const displayLocked = displayBusy || pendingDisplayMode != null || pendingDisplayLayout != null;

  const parsedModes = displayModes
    .map(parseDisplayMode)
    .filter((mode): mode is ParsedDisplayMode => mode != null);
  const resolutions = [...new Set(parsedModes.map((mode) => mode.resolution))].sort((a, b) => {
    if (a === resolutionForMode(displayMode)) return -1;
    if (b === resolutionForMode(displayMode)) return 1;
    const am = parsedModes.find((mode) => mode.resolution === a)!;
    const bm = parsedModes.find((mode) => mode.resolution === b)!;
    return bm.width * bm.height - am.width * am.height;
  });
  const refreshModes = parsedModes.filter((mode) => mode.resolution === selectedResolution);
  const arrangementItems: DisplayArrangementItem[] = connectedOutputs.map((output) => ({
    id: output.id,
    label: output.model || output.name,
    x: output.x,
    y: output.y,
    width: output.width,
    height: output.height,
    primary: output.primary,
  }));
  const selectedOutput =
    connectedOutputs.find((output) => output.id === selectedOutputId) ?? connectedOutputs[0];
  const resolutionControlH = btnH;
  const displaySectionCount =
    1 +
    (connectedOutputs.length > 0 ? 1 : 0) +
    (connectedOutputs.length > 1 ? 1 : 0) +
    (selectedOutput ? 1 : 0) +
    (pendingDisplayLayout ? 1 : 0) +
    1 +
    1 +
    (props.display ? 2 : 0) +
    (props.display ? 1 : 0);
  const displayContentH =
    labelH +
    (connectedOutputs.length > 0 ? Math.round(132 * ui) : 0) +
    (connectedOutputs.length > 1 ? btnH : 0) +
    (selectedOutput ? btnH : 0) +
    (pendingDisplayLayout ? btnH : 0) +
    labelH +
    (props.display ? resolutionControlH : labelH) +
    (props.display ? Math.round(18 * ui) + btnH : 0) +
    (props.display ? (pendingDisplayMode ? Math.round(62 * ui) : Math.round(18 * ui)) : 0) +
    Math.max(0, displaySectionCount - 1) * Math.round(10 * ui);
  const stackedAppearance = innerW < 420;
  const appearanceLabelW = Math.min(Math.round(180 * ui), Math.round(innerW * 0.4));
  const appearanceControlW = Math.max(1, innerW - (stackedAppearance ? 24 : appearanceLabelW + 36));
  const appearanceRowH = Math.round((stackedAppearance ? 90 : 64) * ui);
  const appearanceContentH = appearanceRowH * 7 + 60;
  const scrollContentH =
    tab === 0 ? appearanceContentH : tab === 1 ? Math.max(bodyMin, displayContentH) : bodyMin;
  const scrollViewportH = Math.max(
    Math.round(72 * ui),
    bodyH - titleH - tabH - footH - 1 - Math.round(48 * ui),
  );

  const requestDisplayMode = (modeId: string) => {
    const display = props.display;
    if (!display || modeId === displayMode || displayTrial.current || displayOperation.current)
      return;
    const previous = displayMode;
    void runDisplayOperation(
      "Changing display mode…",
      () => display.setMode(modeId),
      () => {
        displayTrial.current = "mode";
        setDisplayMode(modeId);
        setSelectedResolution(resolutionForMode(modeId));
        setPendingDisplayMode({ previous, target: modeId, deadlineMs: Date.now() + 15_000 });
        setDisplayStatus("");
      },
    );
  };

  const requestResolution = (resolution: string) => {
    const candidates = parsedModes
      .filter((mode) => mode.resolution === resolution)
      .sort((a, b) => {
        if (a.id === displayPreferred) return -1;
        if (b.id === displayPreferred) return 1;
        return b.refreshMilliHz - a.refreshMilliHz;
      });
    if (candidates[0]) requestDisplayMode(candidates[0].id);
  };

  const confirmDisplayMode = () => {
    const display = props.display;
    if (!display || !pendingDisplayMode) return;
    void runDisplayOperation("Keeping display mode…", display.confirmMode, () => {
      displayTrial.current = null;
      setPendingDisplayMode(null);
      setDisplayStatus(`Kept ${displayModeLabel(displayMode)}`);
    });
  };

  const revertDisplayMode = () => {
    const display = props.display;
    if (!display || !pendingDisplayMode) return;
    void runDisplayOperation("Reverting display mode…", display.revertMode, async () => {
      displayRefreshRequired.current = true;
      const next = await display.getState();
      if (!mounted.current) return;
      updateDisplayState(next);
      displayRefreshRequired.current = false;
      displayTrial.current = null;
      setPendingDisplayMode(null);
      setDisplayStatus(`Reverted to ${displayModeLabel(next.current)}`);
    });
  };

  const requestDisplayLayout = (next: ConnectedOutput[]) => {
    const display = props.display;
    if (!display || displayTrial.current || displayOperation.current) return;
    const normalized = next.map((output) => {
      const mode = parseDisplayMode(output.mode);
      return mode
        ? {
            ...output,
            width: Math.max(1, Math.round((mode.width * 120) / output.scale120)),
            height: Math.max(1, Math.round((mode.height * 120) / output.scale120)),
          }
        : output;
    });
    const previous = connectedOutputs;
    void runDisplayOperation(
      "Applying display arrangement…",
      () => display.setLayout(normalized),
      () => {
        displayTrial.current = "layout";
        setConnectedOutputs(normalized);
        setPendingDisplayLayout({ previous, deadlineMs: Date.now() + 15_000 });
        setDisplayStatus("");
      },
    );
  };

  const confirmDisplayLayout = () => {
    const display = props.display;
    if (!display || !pendingDisplayLayout) return;
    void runDisplayOperation("Keeping display arrangement…", display.confirmLayout, () => {
      displayTrial.current = null;
      setPendingDisplayLayout(null);
      setDisplayStatus("Display arrangement saved");
    });
  };

  const revertDisplayLayout = () => {
    const display = props.display;
    if (!display || !pendingDisplayLayout) return;
    void runDisplayOperation("Reverting display arrangement…", display.revertLayout, async () => {
      displayRefreshRequired.current = true;
      const next = await display.getState();
      if (!mounted.current) return;
      updateDisplayState(next);
      displayRefreshRequired.current = false;
      displayTrial.current = null;
      setPendingDisplayLayout(null);
      setDisplayStatus("Display arrangement reverted");
    });
  };

  return createElement(
    OverlayHost,
    {
      width: props.width,
      height: props.height,
    },
    createElement(
      Surface,
      {
        x: 0,
        y: 0,
        width: props.width,
        height: props.height,
        fill: pal.panel,
      },
      createElement(
        Column,
        {
          x: 0,
          y: 0,
          width: props.width,
          height: bodyH + pad * 2,
          padding: pad,
          gap: Math.round(12 * ui),
        },
        createElement(Label, {
          text: "Settings",
          fontSize: 22,
          fontWeight: "medium",
          width: innerW,
          height: titleH,
        }),
        createElement(Tabs, {
          width: innerW,
          tabs: ["Appearance", "Displays", "Sound", "About"],
          active: tab,
          onChange: setTab,
          height: tabH,
        }),
        createElement(Separator, { width: innerW, height: 1 }),
        createElement(
          ScrollArea,
          {
            key: `settings-scroll-${tab}`,
            width: innerW,
            height: scrollViewportH,
            contentHeight: scrollContentH,
          },
          tab === 0
            ? createElement(PropertyList, {
                width: innerW,
                height: appearanceContentH,
                rowHeight: appearanceRowH,
                descriptionRowHeight: appearanceRowH,
                labelWidth: appearanceLabelW,
                stacked: stackedAppearance,
                scrollbar: false,
                sections: [
                  {
                    id: "style",
                    label: "Appearance",
                    items: [
                      {
                        id: "family",
                        label: "Desktop style",
                        description: "Applies to apps and window chrome",
                        value: createElement(Select, {
                          width: appearanceControlW,
                          height: btnH,
                          value: themeFamily,
                          viewportWidth: props.width,
                          viewportHeight: props.height,
                          options: THEME_FAMILIES.map((family) => ({
                            id: family,
                            label: THEME_FAMILY_LABELS[family],
                          })),
                          onChange: (value) => {
                            const family = parseThemeFamily(value);
                            push({ themeFamily: family }, `${THEME_FAMILY_LABELS[family]} applied`);
                          },
                        }),
                      },
                      {
                        id: "scheme",
                        label: "Color scheme",
                        description: "Choose light or dark surfaces",
                        value: createElement(SegmentedControl, {
                          width: appearanceControlW,
                          height: btnH,
                          value: dark ? "dark" : "light",
                          options: [
                            { id: "light", label: "Light" },
                            { id: "dark", label: "Dark" },
                          ],
                          onChange: (value) =>
                            push(
                              { dark: value === "dark" },
                              value === "dark" ? "Dark theme" : "Light theme",
                            ),
                        }),
                      },
                      {
                        id: "motion",
                        label: "Reduce motion",
                        description: "Saved for Moire apps",
                        value: createElement(Toggle, {
                          on: props.reducedMotion ?? props.initial.reducedMotion,
                          disabled: motionSaving || !props.onReducedMotionChange,
                          onChange: (value) => {
                            if (motionSaving || !props.onReducedMotionChange) return;
                            setMotionSaving(true);
                            void props
                              .onReducedMotionChange(value)
                              .then(() => setStatus("Motion preference saved"))
                              .catch((error: unknown) =>
                                setStatus(
                                  `Could not save motion preference: ${error instanceof Error ? error.message : String(error)}`,
                                ),
                              )
                              .finally(() => {
                                if (mounted.current) setMotionSaving(false);
                              });
                          },
                        }),
                      },
                      {
                        id: "scale",
                        label: "Interface size",
                        description: `${Math.round(uiScaleFromSlider(scale) * 100)}% scale`,
                        value: createElement(Slider, {
                          width: appearanceControlW,
                          height: sliderH,
                          value: scale,
                          onChange: setScaleLive,
                        }),
                      },
                    ],
                  },
                  {
                    id: "desktop",
                    label: "Desktop",
                    items: [
                      {
                        id: "wallpaper",
                        label: "Wallpaper",
                        description: "Theme default follows the desktop style",
                        value: createElement(Select, {
                          width: appearanceControlW,
                          height: btnH,
                          value: wallpaper?.mode ?? "default",
                          viewportWidth: props.width,
                          viewportHeight: props.height,
                          options: [
                            { id: "default", label: "Theme default" },
                            { id: "atmosphere", label: "Atmosphere" },
                            { id: "gradient", label: "Gradient" },
                            { id: "solid", label: "Solid color" },
                            ...(wallpaper?.mode === "image"
                              ? [{ id: "image", label: "Custom image" }]
                              : []),
                          ],
                          onChange: (value) => {
                            if (value === "default")
                              push({ wallpaper: null }, "Theme wallpaper restored");
                            else if (
                              value === "atmosphere" ||
                              value === "gradient" ||
                              value === "solid"
                            )
                              push({ wallpaper: { mode: value } }, `Wallpaper: ${value}`);
                          },
                        }),
                      },
                      {
                        id: "icons",
                        label: "Desktop icons",
                        description: "Show files and folders on the desktop",
                        value: createElement(Toggle, {
                          on: showDesktopIcons,
                          onChange: (on) =>
                            push(
                              { showDesktopIcons: on },
                              on ? "Desktop icons on" : "Desktop icons off",
                            ),
                        }),
                      },
                      {
                        id: "notifications",
                        label: "Notifications",
                        description: "Allow desktop notifications",
                        value: createElement(Toggle, {
                          on: notifs,
                          onChange: (on) =>
                            push(
                              { notifications: on },
                              on ? "Notifications on" : "Notifications off",
                            ),
                        }),
                      },
                    ],
                  },
                ],
              })
            : null,
          tab === 1
            ? createElement(
                Column,
                {
                  width: innerW,
                  height: scrollContentH,
                  minHeight: bodyMin,
                  gap: Math.round(10 * ui),
                },
                createElement(Label, {
                  text:
                    connectedOutputs.length > 1
                      ? `${connectedOutputs.length} displays · ${connectedOutputs.map((output) => output.name).join("  +  ")}`
                      : displayName,
                  color: pal.accent,
                  fontWeight: "medium",
                  width: innerW,
                  height: labelH,
                }),
                connectedOutputs.length > 0
                  ? createElement(DisplayArrangement, {
                      width: Math.min(Math.round(420 * ui), innerW),
                      height: Math.round(132 * ui),
                      items: arrangementItems,
                      selectedId: selectedOutputId,
                      onSelect: setSelectedOutputId,
                      onChange: displayLocked
                        ? undefined
                        : (items: DisplayArrangementItem[]) => {
                            const positions = new Map(items.map((item) => [item.id, item]));
                            requestDisplayLayout(
                              connectedOutputs.map((output) => {
                                const item = positions.get(output.id);
                                return item ? { ...output, x: item.x, y: item.y } : output;
                              }),
                            );
                          },
                    })
                  : null,
                connectedOutputs.length > 1
                  ? createElement(
                      Row,
                      { width: innerW, height: btnH, gap: Math.round(8 * ui) },
                      createElement(Button, {
                        width: Math.round(148 * ui),
                        height: btnH,
                        label: connectedOutputs.find((output) => output.id === selectedOutputId)
                          ?.primary
                          ? "Primary display"
                          : "Make primary",
                        variant: connectedOutputs.find((output) => output.id === selectedOutputId)
                          ?.primary
                          ? "primary"
                          : "secondary",
                        disabled: displayLocked,
                        onPress: () =>
                          requestDisplayLayout(
                            connectedOutputs.map((output) => ({
                              ...output,
                              primary: output.id === selectedOutputId,
                            })),
                          ),
                      }),
                      createElement(Label, {
                        text: "Drag displays to match their physical arrangement",
                        color: pal.muted,
                        width: Math.max(1, innerW - Math.round(160 * ui)),
                        height: labelH,
                      }),
                    )
                  : null,
                selectedOutput
                  ? createElement(
                      Row,
                      { width: innerW, height: btnH, gap: Math.round(6 * ui) },
                      createElement(Label, {
                        text: "Scale",
                        fontWeight: "medium",
                        width: Math.round(48 * ui),
                        height: labelH,
                      }),
                      createElement(SegmentedControl, {
                        width: Math.max(
                          1,
                          Math.min(Math.round(360 * ui), innerW - Math.round(54 * ui)),
                        ),
                        height: btnH,
                        options: [120, 150, 180, 210, 240].map((scale120) => ({
                          id: String(scale120),
                          label: `${Math.round((scale120 / 120) * 100)}%`,
                          disabled: displayLocked,
                        })),
                        value: String(selectedOutput.scale120),
                        onChange: (value) =>
                          requestDisplayLayout(
                            connectedOutputs.map((output) =>
                              output.id === selectedOutput.id
                                ? { ...output, scale120: Number(value) }
                                : output,
                            ),
                          ),
                      }),
                    )
                  : null,
                pendingDisplayLayout
                  ? createElement(
                      Row,
                      { width: innerW, height: btnH, gap: Math.round(8 * ui) },
                      createElement(Button, {
                        width: Math.round(104 * ui),
                        height: btnH,
                        label: "Keep",
                        variant: "primary",
                        disabled: displayBusy,
                        onPress: confirmDisplayLayout,
                      }),
                      createElement(Button, {
                        width: Math.round(104 * ui),
                        height: btnH,
                        label: "Revert",
                        variant: "secondary",
                        disabled: displayBusy,
                        onPress: revertDisplayLayout,
                      }),
                      createElement(Label, {
                        text: "Reverts automatically after 15 seconds",
                        color: pal.accent,
                        width: Math.max(1, innerW - Math.round(224 * ui)),
                        height: labelH,
                      }),
                    )
                  : null,
                createElement(Label, {
                  text: "Resolution",
                  fontWeight: "medium",
                  width: innerW,
                  height: labelH,
                }),
                props.display
                  ? createElement(Select, {
                      width: Math.min(Math.round(380 * ui), innerW),
                      height: resolutionControlH,
                      viewportWidth: props.width,
                      viewportHeight: props.height,
                      maxMenuHeight: Math.min(
                        Math.round(360 * ui),
                        props.height - Math.round(80 * ui),
                      ),
                      options: resolutions.map((resolution) => {
                        const current = resolution === resolutionForMode(displayMode);
                        const preferred = resolution === resolutionForMode(displayPreferred);
                        return {
                          id: resolution,
                          label: `${resolution.replace("x", " × ")}${current ? " · Current" : preferred ? " · Preferred" : ""}`,
                        };
                      }),
                      value: selectedResolution,
                      disabled: displayLocked,
                      onChange: requestResolution,
                    })
                  : createElement(Label, {
                      text: "Display service unavailable",
                      color: pal.muted,
                      width: innerW,
                      height: labelH,
                    }),
                props.display
                  ? createElement(Label, {
                      text: "Refresh rate",
                      fontWeight: "medium",
                      width: innerW,
                      height: Math.round(18 * ui),
                    })
                  : null,
                props.display
                  ? createElement(Select, {
                      width: Math.min(Math.round(220 * ui), innerW),
                      height: btnH,
                      viewportWidth: props.width,
                      viewportHeight: props.height,
                      options: refreshModes.map((mode) => ({
                        id: mode.id,
                        label: refreshLabel(mode.refreshMilliHz),
                      })),
                      value: refreshModes.some((mode) => mode.id === displayMode)
                        ? displayMode
                        : refreshModes[0]?.id,
                      disabled: displayLocked || refreshModes.length <= 1,
                      onChange: requestDisplayMode,
                    })
                  : null,
                pendingDisplayMode
                  ? createElement(
                      Column,
                      {
                        width: Math.min(Math.round(380 * ui), innerW),
                        height: Math.round(62 * ui),
                        gap: Math.round(6 * ui),
                      },
                      createElement(Label, {
                        text: `Keep this display mode? Reverting in ${displayCountdown}s`,
                        color: pal.accent,
                        width: innerW,
                        height: Math.round(18 * ui),
                        fontWeight: "medium",
                      }),
                      createElement(
                        Row,
                        {
                          width: Math.min(Math.round(380 * ui), innerW),
                          height: Math.round(32 * ui),
                          gap: Math.round(8 * ui),
                        },
                        createElement(Button, {
                          width: Math.round(112 * ui),
                          height: Math.round(32 * ui),
                          label: "Keep",
                          variant: "primary",
                          disabled: displayBusy,
                          onPress: confirmDisplayMode,
                        }),
                        createElement(Button, {
                          width: Math.round(112 * ui),
                          height: Math.round(32 * ui),
                          label: "Revert",
                          variant: "secondary",
                          disabled: displayBusy,
                          onPress: revertDisplayMode,
                        }),
                      ),
                    )
                  : createElement(Label, {
                      text: "A new mode reverts automatically unless you keep it.",
                      color: pal.muted,
                      width: innerW,
                      height: Math.round(18 * ui),
                      fontSize: 12,
                    }),
              )
            : null,
          tab === 2
            ? createElement(
                Column,
                {
                  width: innerW,
                  height: bodyMin,
                  minHeight: bodyMin,
                  gap: Math.round(12 * ui),
                },
                createElement(Label, {
                  text: `Volume  ${Math.round(volume * 100)}%`,
                  width: innerW,
                  height: labelH,
                }),
                createElement(Slider, {
                  width: Math.min(Math.round(360 * ui), innerW),
                  value: volume,
                  onChange: setVolume,
                  height: sliderH,
                }),
                createElement(ProgressBar, {
                  width: Math.min(Math.round(360 * ui), innerW),
                  value: volume,
                  height: Math.round(10 * ui),
                }),
                createElement(Label, {
                  text: "Uses wpctl/pactl when PipeWire/Pulse is available",
                  color: pal.muted,
                  width: innerW,
                  height: Math.round(18 * ui),
                  fontSize: 12,
                }),
              )
            : null,
          tab === 3
            ? createElement(
                Column,
                {
                  width: innerW,
                  height: bodyMin,
                  minHeight: bodyMin,
                  gap: Math.round(8 * ui),
                },
                createElement(Label, {
                  text: "Moire Desktop Environment",
                  fontWeight: "medium",
                  width: innerW,
                  height: Math.round(22 * ui),
                }),
                createElement(Label, {
                  text: "Prefs: ~/.config/moire/settings.json",
                  color: pal.muted,
                  width: innerW,
                  height: labelH,
                }),
                createElement(Label, {
                  text: "Theme + UI scale hot-reload Moire chrome",
                  color: pal.muted,
                  width: innerW,
                  height: labelH,
                }),
              )
            : null,
        ),
        createElement(
          Row,
          {
            width: innerW,
            height: footH,
            justify: "space-between",
            align: "center",
            gap: Math.round(8 * ui),
          },
          createElement(Label, {
            text: (tab === 1 ? displayStatus : "") || status || " ",
            color: pal.accent,
            width: Math.max(Math.round(120 * ui), innerW - Math.round(120 * ui)),
            height: Math.round(18 * ui),
            fontSize: 12,
          }),
          createElement(Button, {
            width: Math.round(96 * ui),
            height: btnH,
            label: "Close",
            variant: "primary",
            onPress: props.onQuit,
          }),
        ),
      ),
    ),
  );
}

/** Slider 0..1 ↔ uiScale 0.75..2.0 */
function uiScaleFromSlider(t: number): number {
  return 0.75 + Math.max(0, Math.min(1, t)) * 1.25;
}

function sliderFromUiScale(scale: number): number {
  return Math.max(0, Math.min(1, (scale - 0.75) / 1.25));
}

function displayModeLabel(modeId: string): string {
  const mode = parseDisplayMode(modeId);
  if (!mode) return modeId;
  return `${mode.width} × ${mode.height}  ·  ${refreshLabel(mode.refreshMilliHz)}`;
}

function parseDisplayMode(modeId: string): ParsedDisplayMode | null {
  const match = /^(\d+)x(\d+)@(\d+)$/.exec(modeId);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  const refreshMilliHz = Number(match[3]);
  return {
    id: modeId,
    width,
    height,
    refreshMilliHz,
    resolution: `${width}x${height}`,
  };
}

function resolutionForMode(modeId: string): string {
  return parseDisplayMode(modeId)?.resolution ?? "";
}

function refreshLabel(refreshMilliHz: number): string {
  const hz = refreshMilliHz / 1000;
  return `${Number.isInteger(hz) ? hz : hz.toFixed(2)} Hz`;
}

async function connectDisplayController(): Promise<{
  bus: SessionBus;
  controller: DisplayController;
} | null> {
  try {
    const bus = await SessionBus.connect();
    const getState = async (): Promise<DisplayState> => {
      const [reply, outputReply, outputsReply] = await Promise.all([
        bus.call({
          destination: "org.moire.Display1",
          path: "/org/moire/Display1",
          interface: "org.moire.Display1",
          member: "GetModes",
        }),
        bus.call({
          destination: "org.moire.Display1",
          path: "/org/moire/Display1",
          interface: "org.moire.Display1",
          member: "GetOutputInfo",
        }),
        bus.call({
          destination: "org.moire.Display1",
          path: "/org/moire/Display1",
          interface: "org.moire.Display1",
          member: "ListOutputs",
        }),
      ]);
      const outputRows = Array.isArray(outputsReply.body?.[0]) ? outputsReply.body[0] : [];
      return {
        modes: Array.isArray(reply.body?.[0]) ? reply.body[0].map(String) : [],
        current: String(reply.body?.[1] ?? ""),
        preferred: String(reply.body?.[2] ?? ""),
        name: String(outputReply.body?.[0] ?? "Display"),
        widthMm: Number(outputReply.body?.[1] ?? 0),
        heightMm: Number(outputReply.body?.[2] ?? 0),
        outputs: outputRows
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row) => ({
            id: String(row[0] ?? ""),
            name: String(row[1] ?? "Display"),
            make: String(row[2] ?? ""),
            model: String(row[3] ?? "Display"),
            serial: String(row[4] ?? ""),
            mode: String(row[5] ?? ""),
            x: Number(row[6] ?? 0),
            y: Number(row[7] ?? 0),
            width: Number(row[8] ?? 0),
            height: Number(row[9] ?? 0),
            scale120: Number(row[10] ?? 120),
            primary: row[11] === true,
          })),
      };
    };
    const initial = await getState();
    const callBoolean = async (member: string, body?: unknown[]) => {
      const result = await bus.call({
        destination: "org.moire.Display1",
        path: "/org/moire/Display1",
        interface: "org.moire.Display1",
        member,
        ...(body ? { signature: "s", body } : {}),
      });
      return result.body?.[0] === true;
    };
    return {
      bus,
      controller: {
        ...initial,
        getState,
        setMode: (modeId) => callBoolean("SetMode", [modeId]),
        confirmMode: () => callBoolean("ConfirmMode"),
        revertMode: () => callBoolean("RevertMode"),
        setLayout: async (outputs) => {
          const result = await bus.call({
            destination: "org.moire.Display1",
            path: "/org/moire/Display1",
            interface: "org.moire.Display1",
            member: "SetLayout",
            signature: "a(siiub)",
            body: [
              outputs.map((output) => [
                output.id,
                output.x,
                output.y,
                output.scale120,
                output.primary,
              ]),
            ],
          });
          return result.body?.[0] === true;
        },
        confirmLayout: () => callBoolean("ConfirmLayout"),
        revertLayout: () => callBoolean("RevertLayout"),
      },
    };
  } catch (error) {
    console.warn("[settings] display service unavailable:", error);
    return null;
  }
}

async function main() {
  const initial = loadSettings();
  const sysVol = readSystemVolume();
  if (sysVol != null) initial.volume = sysVol;
  applySettings(initial);
  setUiScaleFactor(initial.uiScale);
  const ui = initial.uiScale;
  const displayConnection = await connectDisplayController();

  const app = new Application();
  const win = new Window({
    title: "Settings",
    appId: "org.moire.Settings",
    width: Math.round(480 * ui),
    height: Math.round(640 * ui),
    // Accept compositor-constrained sizes on small/high-scale outputs; the
    // tab body scrolls while the action bar remains fixed.
    resizable: true,
  });
  win.setContent((size) =>
    createElement(SettingsApp, {
      ...size,
      initial,
      reducedMotion: app.getPersonalization()?.reducedMotion ?? initial.reducedMotion,
      onReducedMotionChange: (value) => app.setSessionReducedMotion(value),
      display: displayConnection?.controller ?? null,
      onQuit: () => {
        displayConnection?.bus.close();
        win.destroy();
        app.quit();
      },
    }),
  );
  win.onClose(() => {
    displayConnection?.bus.close();
    app.quit();
  });
  app.addWindow(win);
  await app.run();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((err) => {
    console.error("[settings]", err);
    process.exit(1);
  });
