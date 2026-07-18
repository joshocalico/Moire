/**
 * Moire Settings — out-of-process @moire/ui app with real prefs apply.
 */
import { createElement, useState, useEffect, useRef, type ReactNode } from "react";
import {
  Application,
  Window,
  Column,
  Row,
  Box,
  Label,
  Button,
  Toggle,
  Checkbox,
  Separator,
  Tabs,
  Slider,
  ProgressBar,
  ScrollArea,
  Surface,
  themePalette,
  setUiScaleFactor,
  getUiScaleFactor,
  DisplayArrangement,
  type DisplayArrangementItem,
  type WindowSize,
} from "@moire/ui";
import {
  applySettings,
  loadSettings,
  readSystemVolume,
  type MoireSettings,
  type WallpaperSettings,
} from "@moire/prefs";
import { SessionBus } from "@moire/dbus";

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
const BODY_MIN_H = 300;

function SettingsApp(
  props: WindowSize & {
    onQuit: () => void;
    initial: MoireSettings;
    display: DisplayController | null;
  },
): ReactNode {
  const pal = themePalette();
  const [tab, setTab] = useState(
    Math.max(0, Math.min(3, Number(process.env.MOIRE_SETTINGS_TAB ?? 0))),
  );
  const [dark, setDark] = useState(props.initial.dark);
  const [notifs, setNotifs] = useState(props.initial.notifications);
  const [volume, setVolume] = useState(props.initial.volume);
  const [scale, setScale] = useState(sliderFromUiScale(props.initial.uiScale));
  const [showDesktopIcons, setShowDesktopIcons] = useState(props.initial.showDesktopIcons);
  const [wallpaper, setWallpaper] = useState<WallpaperSettings | null>(props.initial.wallpaper);
  const [status, setStatus] = useState("");
  const [displayMode, setDisplayMode] = useState(props.display?.current ?? "");
  const [displayModes, setDisplayModes] = useState(props.display?.modes ?? []);
  const [displayPreferred, setDisplayPreferred] = useState(
    props.display?.preferred ?? "",
  );
  const [displayName, setDisplayName] = useState(props.display?.name ?? "Display");
  const [connectedOutputs, setConnectedOutputs] = useState(
    props.display?.outputs ?? [],
  );
  const [selectedOutputId, setSelectedOutputId] = useState(
    props.display?.outputs.find((output) => output.primary)?.id ??
      props.display?.outputs[0]?.id ?? "",
  );
  const [pendingDisplayLayout, setPendingDisplayLayout] = useState<{
    previous: ConnectedOutput[];
    deadlineMs: number;
  } | null>(null);
  const [selectedResolution, setSelectedResolution] = useState(
    resolutionForMode(props.display?.current ?? ""),
  );
  const [pendingDisplayMode, setPendingDisplayMode] =
    useState<PendingDisplayMode | null>(null);
  const [displayCountdown, setDisplayCountdown] = useState(0);
  const volumeReady = useRef(false);
  const ui = getUiScaleFactor();
  const pad = Math.round(16 * ui);
  const innerW = Math.max(1, props.width - pad * 2);
  const bodyH = Math.max(1, props.height - pad * 2);
  const bodyMin = Math.round(BODY_MIN_H * ui);
  const rowH = Math.round(28 * ui);
  const labelH = Math.round(20 * ui);
  const titleH = Math.round(28 * ui);
  const tabH = Math.round(32 * ui);
  const footH = Math.round(40 * ui);
  const btnH = Math.round(36 * ui);
  const sliderH = Math.round(24 * ui);

  const push = (patch: Partial<MoireSettings>, note?: string) => {
    const next: MoireSettings = {
      dark,
      notifications: notifs,
      volume,
      uiScale: uiScaleFromSlider(scale),
      displayMode: displayMode || props.initial.displayMode,
      // Display layout is persisted by the compositor after confirmation.
      // Re-read it so an unrelated Appearance save never erases that state.
      displayOutputs: loadSettings().displayOutputs,
      showDesktopIcons,
      wallpaper,
      ...patch,
    };
    if (patch.dark != null) setDark(patch.dark);
    if (patch.notifications != null) setNotifs(patch.notifications);
    if (patch.volume != null) setVolume(patch.volume);
    if (patch.uiScale != null) setScale(sliderFromUiScale(patch.uiScale));
    if (patch.showDesktopIcons != null) setShowDesktopIcons(patch.showDesktopIcons);
    if ("wallpaper" in patch) setWallpaper(patch.wallpaper ?? null);
    const result = applySettings(next);
    setUiScaleFactor(next.uiScale);
    setStatus(
      note ??
        (result.volume.ok
          ? `Saved · ${result.theme.name}`
          : `Saved · ${result.volume.detail}`),
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

  useEffect(() => {
    if (!pendingDisplayMode) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((pendingDisplayMode.deadlineMs - Date.now()) / 1000),
      );
      setDisplayCountdown(remaining);
      if (remaining === 0) {
        setDisplayMode(pendingDisplayMode.previous);
        setSelectedResolution(resolutionForMode(pendingDisplayMode.previous));
        setPendingDisplayMode(null);
        setStatus("Display mode reverted automatically");
      }
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [pendingDisplayMode]);

  useEffect(() => {
    if (!pendingDisplayLayout) return;
    const delay = Math.max(0, pendingDisplayLayout.deadlineMs - Date.now());
    const timer = setTimeout(() => {
      setConnectedOutputs(pendingDisplayLayout.previous);
      setPendingDisplayLayout(null);
      setStatus("Display arrangement reverted automatically");
    }, delay + 100);
    return () => clearTimeout(timer);
  }, [pendingDisplayLayout]);

  useEffect(() => {
    const display = props.display;
    if (!display) return;
    let disposed = false;
    const refresh = () => {
      if (pendingDisplayMode) return;
      void display.getState().then((next) => {
        if (disposed) return;
        setDisplayModes(next.modes);
        setDisplayPreferred(next.preferred);
        setDisplayName(next.name || "Display");
        setConnectedOutputs(next.outputs);
        if (next.current && next.current !== displayMode) {
          setDisplayMode(next.current);
          setSelectedResolution(resolutionForMode(next.current));
          setStatus(`Display updated · ${displayModeLabel(next.current)}`);
        }
      }).catch((error) => {
        if (!disposed) console.warn("[settings] display refresh failed:", error);
      });
    };
    const timer = setInterval(refresh, 2_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [props.display, pendingDisplayMode, displayMode]);

  const parsedModes = displayModes
    .map(parseDisplayMode)
    .filter((mode): mode is ParsedDisplayMode => mode != null);
  const resolutions = [...new Set(parsedModes.map((mode) => mode.resolution))]
    .sort((a, b) => {
      if (a === resolutionForMode(displayMode)) return -1;
      if (b === resolutionForMode(displayMode)) return 1;
      const am = parsedModes.find((mode) => mode.resolution === a)!;
      const bm = parsedModes.find((mode) => mode.resolution === b)!;
      return bm.width * bm.height - am.width * am.height;
    });
  const refreshModes = parsedModes.filter(
    (mode) => mode.resolution === selectedResolution,
  );
  const resolutionRows: string[][] = [];
  for (let index = 0; index < resolutions.length; index += 2) {
    resolutionRows.push(resolutions.slice(index, index + 2));
  }
  const arrangementItems: DisplayArrangementItem[] = connectedOutputs.map(
    (output) => ({
      id: output.id,
      label: output.model || output.name,
      x: output.x,
      y: output.y,
      width: output.width,
      height: output.height,
      primary: output.primary,
    }),
  );
  const selectedOutput =
    connectedOutputs.find((output) => output.id === selectedOutputId) ??
    connectedOutputs[0];

  const requestDisplayMode = (modeId: string) => {
    if (!props.display || modeId === displayMode) return;
    const previous = displayMode;
    setStatus(`Switching to ${displayModeLabel(modeId)}…`);
    void props.display
      .setMode(modeId)
      .then((changed) => {
        if (!changed) return;
        setDisplayMode(modeId);
        setSelectedResolution(resolutionForMode(modeId));
        setPendingDisplayMode({
          previous,
          target: modeId,
          deadlineMs: Date.now() + 15_000,
        });
        setStatus("");
      })
      .catch((error: unknown) => {
        setStatus(
          `Display change failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };

  const confirmDisplayMode = () => {
    if (!props.display || !pendingDisplayMode) return;
    void props.display.confirmMode().then((confirmed) => {
      if (!confirmed) return;
      setPendingDisplayMode(null);
      setStatus(`Kept ${displayModeLabel(displayMode)}`);
    });
  };

  const revertDisplayMode = () => {
    if (!props.display || !pendingDisplayMode) return;
    const previous = pendingDisplayMode.previous;
    void props.display.revertMode().then(() => {
      setDisplayMode(previous);
      setSelectedResolution(resolutionForMode(previous));
      setPendingDisplayMode(null);
      setStatus(`Reverted to ${displayModeLabel(previous)}`);
    });
  };

  const requestDisplayLayout = (next: ConnectedOutput[]) => {
    if (!props.display) return;
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
    setStatus("Applying display arrangement…");
    void props.display.setLayout(normalized).then((changed) => {
      if (!changed) return;
      setConnectedOutputs(normalized);
      setPendingDisplayLayout({ previous, deadlineMs: Date.now() + 15_000 });
      setStatus("");
    }).catch((error: unknown) => {
      setStatus(`Arrangement rejected: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const confirmDisplayLayout = () => {
    void props.display?.confirmLayout().then((confirmed) => {
      if (!confirmed) return;
      setPendingDisplayLayout(null);
      setStatus("Display arrangement saved");
    });
  };

  const revertDisplayLayout = () => {
    if (!pendingDisplayLayout) return;
    const previous = pendingDisplayLayout.previous;
    void props.display?.revertLayout().then(() => {
      setConnectedOutputs(previous);
      setPendingDisplayLayout(null);
      setStatus("Display arrangement reverted");
    });
  };

  return createElement(
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
        fontWeight: "bold",
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
      tab === 0
        ? createElement(
            Column,
            {
              width: innerW,
              height: bodyMin,
              minHeight: bodyMin,
              gap: Math.round(12 * ui),
            },
            createElement(Toggle, {
              on: dark,
              label: "Dark theme",
              onChange: (on) =>
                push({ dark: on }, on ? "Dark theme" : "Light theme"),
              width: Math.min(Math.round(280 * ui), innerW),
              height: rowH,
            }),
            createElement(Checkbox, {
              checked: notifs,
              label: "Show desktop notifications",
              onChange: (v) =>
                push(
                  { notifications: v },
                  v ? "Notifications on" : "Notifications off",
                ),
              width: Math.min(Math.round(360 * ui), innerW),
              height: rowH,
            }),
            createElement(Label, {
              text: `UI scale  ${Math.round(uiScaleFromSlider(scale) * 100)}%`,
              width: innerW,
              height: labelH,
            }),
            createElement(Slider, {
              width: Math.min(Math.round(360 * ui), innerW),
              value: scale,
              onChange: setScaleLive,
              height: sliderH,
            }),
            createElement(Separator, { width: innerW, height: 1 }),
            createElement(Label, {
              text: "Wallpaper",
              fontWeight: "medium",
              width: innerW,
              height: labelH,
            }),
            createElement(
              Row,
              {
                width: innerW,
                height: btnH,
                gap: Math.round(8 * ui),
                align: "center",
              },
              createElement(Button, {
                width: Math.round(100 * ui),
                height: btnH,
                label: "Atmosphere",
                variant: wallpaper?.mode === "atmosphere" || wallpaper == null ? "primary" : "secondary",
                onPress: () =>
                  push({ wallpaper: { mode: "atmosphere" } }, "Wallpaper: Atmosphere"),
              }),
              createElement(Button, {
                width: Math.round(88 * ui),
                height: btnH,
                label: "Gradient",
                variant: wallpaper?.mode === "gradient" ? "primary" : "secondary",
                onPress: () =>
                  push({ wallpaper: { mode: "gradient" } }, "Wallpaper: Gradient"),
              }),
              createElement(Button, {
                width: Math.round(76 * ui),
                height: btnH,
                label: "Solid",
                variant: wallpaper?.mode === "solid" ? "primary" : "secondary",
                onPress: () =>
                  push({ wallpaper: { mode: "solid" } }, "Wallpaper: Solid"),
              }),
            ),
            createElement(Checkbox, {
              checked: showDesktopIcons,
              label: "Show desktop icons",
              onChange: (v) =>
                push(
                  { showDesktopIcons: v },
                  v ? "Desktop icons on" : "Desktop icons off",
                ),
              width: Math.min(Math.round(360 * ui), innerW),
              height: rowH,
            }),
          )
        : null,
      tab === 1
        ? createElement(
            Column,
            {
              width: innerW,
              height: bodyMin,
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
                  onChange: pendingDisplayLayout ? undefined : (items: DisplayArrangementItem[]) => {
                    const positions = new Map(items.map((item) => [item.id, item]));
                    requestDisplayLayout(connectedOutputs.map((output) => {
                      const item = positions.get(output.id);
                      return item ? { ...output, x: item.x, y: item.y } : output;
                    }));
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
                    label: connectedOutputs.find((output) => output.id === selectedOutputId)?.primary
                      ? "Primary display"
                      : "Make primary",
                    variant: connectedOutputs.find((output) => output.id === selectedOutputId)?.primary
                      ? "primary"
                      : "secondary",
                    disabled: pendingDisplayLayout != null,
                    onPress: () => requestDisplayLayout(connectedOutputs.map((output) => ({
                      ...output,
                      primary: output.id === selectedOutputId,
                    }))),
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
                  ...[120, 150, 180, 210, 240].map((scale120) =>
                    createElement(Button, {
                      key: `scale-${scale120}`,
                      width: Math.round(62 * ui),
                      height: btnH,
                      label: `${Math.round((scale120 / 120) * 100)}%`,
                      variant:
                        selectedOutput.scale120 === scale120
                          ? "primary"
                          : "secondary",
                      disabled: pendingDisplayLayout != null,
                      onPress: () => requestDisplayLayout(
                        connectedOutputs.map((output) =>
                          output.id === selectedOutput.id
                            ? { ...output, scale120 }
                            : output,
                        ),
                      ),
                    }),
                  ),
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
                    onPress: confirmDisplayLayout,
                  }),
                  createElement(Button, {
                    width: Math.round(104 * ui),
                    height: btnH,
                    label: "Revert",
                    variant: "secondary",
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
              ? createElement(
                  ScrollArea,
                  {
                    width: Math.min(Math.round(380 * ui), innerW),
                    height: Math.round(112 * ui),
                    contentHeight: Math.max(
                      1,
                      resolutionRows.length *
                        (btnH + Math.round(6 * ui)),
                    ),
                  },
                  createElement(
                    Column,
                    {
                      width: Math.min(Math.round(368 * ui), innerW),
                      height: Math.max(
                        1,
                        resolutionRows.length *
                          (btnH + Math.round(6 * ui)),
                      ),
                      gap: Math.round(6 * ui),
                    },
                    ...resolutionRows.map((row, rowIndex) =>
                      createElement(
                        Row,
                        {
                          key: `resolution-${rowIndex}`,
                          width: Math.min(Math.round(368 * ui), innerW),
                          height: btnH,
                          gap: Math.round(6 * ui),
                        },
                        ...row.map((resolution) => {
                          const isCurrent =
                            resolution === resolutionForMode(displayMode);
                          const isPreferred =
                            resolution ===
                            resolutionForMode(displayPreferred);
                          return createElement(Button, {
                            key: resolution,
                            width: Math.round(178 * ui),
                            height: btnH,
                            label: `${resolution.replace("x", " × ")}${isCurrent ? " · Current" : isPreferred ? " · Preferred" : ""}`,
                            variant:
                              selectedResolution === resolution
                                ? "primary"
                                : "secondary",
                            onPress: () => setSelectedResolution(resolution),
                          });
                        }),
                      ),
                    ),
                  ),
                )
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
              ? createElement(
                  Row,
                  {
                    width: Math.min(Math.round(380 * ui), innerW),
                    height: Math.round(32 * ui),
                    gap: Math.round(6 * ui),
                  },
                  ...refreshModes.map((mode) =>
                    createElement(Button, {
                      key: mode.id,
                      width: Math.round(86 * ui),
                      height: Math.round(32 * ui),
                      label: refreshLabel(mode.refreshMilliHz),
                      variant:
                        displayMode === mode.id ? "primary" : "secondary",
                      onPress: () => requestDisplayMode(mode.id),
                    }),
                  ),
                )
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
                      onPress: confirmDisplayMode,
                    }),
                    createElement(Button, {
                      width: Math.round(112 * ui),
                      height: Math.round(32 * ui),
                      label: "Revert",
                      variant: "secondary",
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
      createElement(Box, {
        width: innerW,
        height: 1,
        flexGrow: 1,
        minHeight: Math.round(8 * ui),
      }),
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
          text: status || " ",
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
      const outputRows = Array.isArray(outputsReply.body?.[0])
        ? outputsReply.body[0]
        : [];
      return {
        modes: Array.isArray(reply.body?.[0])
          ? reply.body[0].map(String)
          : [],
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
            body: [outputs.map((output) => [
              output.id,
              output.x,
              output.y,
              output.scale120,
              output.primary,
            ])],
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
    resizable: false,
  });
  win.setContent((size) =>
    createElement(SettingsApp, {
      ...size,
      initial,
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

main().catch((err) => {
  console.error("[settings]", err);
  process.exit(1);
});
