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
  Surface,
  themePalette,
  setUiScaleFactor,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import {
  applySettings,
  loadSettings,
  readSystemVolume,
  type MoireSettings,
} from "@moire/prefs";

/** Appearance / Sound body height so parent Yoga gets a real flex slot (nested
 *  Columns without height collapse to 0 and overlap siblings). */
const BODY_MIN_H = 168;

function SettingsApp(
  props: WindowSize & {
    onQuit: () => void;
    initial: MoireSettings;
  },
): ReactNode {
  const pal = themePalette();
  const [tab, setTab] = useState(0);
  const [dark, setDark] = useState(props.initial.dark);
  const [notifs, setNotifs] = useState(props.initial.notifications);
  const [volume, setVolume] = useState(props.initial.volume);
  const [scale, setScale] = useState(sliderFromUiScale(props.initial.uiScale));
  const [status, setStatus] = useState("");
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
      ...patch,
    };
    if (patch.dark != null) setDark(patch.dark);
    if (patch.notifications != null) setNotifs(patch.notifications);
    if (patch.volume != null) setVolume(patch.volume);
    if (patch.uiScale != null) setScale(sliderFromUiScale(patch.uiScale));
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
        tabs: ["Appearance", "Sound", "About"],
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
          )
        : null,
      tab === 1
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
      tab === 2
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
          fill: pal.accentLine,
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

async function main() {
  const initial = loadSettings();
  const sysVol = readSystemVolume();
  if (sysVol != null) initial.volume = sysVol;
  applySettings(initial);
  setUiScaleFactor(initial.uiScale);
  const ui = initial.uiScale;

  const app = new Application();
  const win = new Window({
    title: "Settings",
    appId: "org.moire.Settings",
    width: Math.round(480 * ui),
    height: Math.round(360 * ui),
    resizable: false,
  });
  win.setContent((size) =>
    createElement(SettingsApp, {
      ...size,
      initial,
      onQuit: () => {
        win.destroy();
        app.quit();
      },
    }),
  );
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((err) => {
  console.error("[settings]", err);
  process.exit(1);
});
