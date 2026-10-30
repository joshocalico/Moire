/**
 * Sound: outputs, inputs and apps playing, through the desktop controls — the same audio
 * service Quick Settings uses, so the two always agree. The default output's volume and mute
 * come from the service's `audio`; device lists, the input and per-app volumes from its `sound`,
 * which older services don't send, so those sections only appear when it is there.
 */
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Icon,
  IconButton,
  ProgressBar,
  Slider,
  Toggle,
  getUiScaleFactor,
  useWidgetTheme,
} from "@moire/ui";
import type {
  DesktopAudio,
  DesktopStatusClient,
  DesktopSoundStream,
} from "@moire/system-management/desktop-status";
import type { SettingRowSpec } from "@moire/ui";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { infoRow, section, selectRow, toggleRow } from "#settings-view/rows";
import { settingEntry } from "#settings/catalog";
import {
  appsSummary,
  defaultDevice,
  deviceChoices,
  meterStep,
  streamDescription,
  volumePercent,
  type ReadySound,
} from "./sound-model";

export { volumePercent } from "./sound-model";

const PAGE = "sound";
/** The mute button beside an app's slider, and the gap before it (unscaled). */
const MUTE_BUTTON = 32;
const MUTE_GAP = 8;
type ReadyAudio = Extract<DesktopAudio, { kind: "ready" }>;

/**
 * A slider that follows the drag locally and calls the service when it rests, so a drag doesn't
 * queue a service call per step. It follows the service again once the value lands.
 */
function LevelSlider(props: {
  value: number;
  width: number;
  height: number;
  focusId?: string;
  disabled?: boolean;
  onCommit: (value: number) => void;
}): ReactNode {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [props.value]);
  return (
    <Slider
      width={props.width}
      height={props.height}
      value={Math.min(1, draft ?? props.value)}
      focusId={props.focusId}
      disabled={props.disabled}
      onChange={setDraft}
      onCommit={props.onCommit}
    />
  );
}

/** The default output's volume; Overview's Sound tile uses it too. */
export function VolumeSlider(props: {
  context: PageContext;
  audio: ReadyAudio;
  width: number;
  height: number;
  focusId?: string;
}): ReactNode {
  return (
    <LevelSlider
      value={props.audio.volume}
      width={props.width}
      height={props.height}
      focusId={props.focusId}
      disabled={props.context.desktop.busy === "volume"}
      onCommit={(value) =>
        props.context.attempt(PAGE, () =>
          props.context.desktop.run("volume", (client) => client.setVolume(value)),
        )
      }
    />
  );
}

/**
 * The input level, live while it is on screen: mounting it starts the service's meter for this
 * client and unmounting stops it, so the microphone is only read while someone is looking.
 */
function InputLevelMeter(props: {
  client: DesktopStatusClient;
  width: number;
  onError: (message: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  // Line the bar up with the sliders' tracks, which start half a thumb in.
  const inset = Math.floor(useWidgetTheme().recipes.slider.medium.metrics.thumbSize / 2);
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const remove = props.client.onInputLevel((peak) =>
      setLevel((previous) => meterStep(previous, peak)),
    );
    props.client
      .startInputMeter()
      .catch((error: unknown) =>
        props.onError(error instanceof Error ? error.message : String(error)),
      );
    return () => {
      remove();
      void props.client.stopInputMeter().catch(() => {});
    };
  }, [props.client]);
  return (
    <Box width={props.width} height={24 * ui}>
      <ProgressBar
        x={inset}
        y={8 * ui}
        width={Math.max(1, props.width - inset * 2)}
        height={8 * ui}
        value={level}
      />
    </Box>
  );
}

function setMuted(context: PageContext, muted: boolean) {
  context.attempt(PAGE, () => context.desktop.run("mute", (client) => client.setMute(muted)));
}

/** A wide control row whose control is a level slider. */
function sliderRow(
  id: string,
  description: string,
  render: (width: number) => ReactNode,
  label = settingEntry(id).label,
): SettingRowSpec {
  return {
    id,
    label,
    description,
    focusId: `setting:${id}`,
    control: { kind: "wide", height: 24, render },
  };
}

function outputSection(context: PageContext, audio: ReadyAudio, sound: ReadySound | null) {
  const ui = getUiScaleFactor();
  const outputs = sound?.outputs ?? [];
  const current = defaultDevice(outputs);
  return section("sound.output-section", "Output", [
    outputs.length > 1
      ? selectRow(
          "sound.output",
          context,
          current?.id ?? null,
          deviceChoices(outputs),
          (id) =>
            context.attempt(PAGE, () =>
              context.desktop.run("output", (client) => client.setDefaultSoundDevice("output", id)),
            ),
          { disabled: context.desktop.busy === "output" },
        )
      : infoRow(
          "sound.output",
          settingEntry("sound.output").label,
          audio.name,
          "The default output",
        ),
    sliderRow("sound.volume", audio.muted ? "Muted" : volumePercent(audio.volume), (width) => (
      <VolumeSlider
        context={context}
        audio={audio}
        width={width}
        height={24 * ui}
        focusId="setting:sound.volume"
      />
    )),
  ]);
}

function inputSection(context: PageContext, sound: ReadySound) {
  const ui = getUiScaleFactor();
  const input = sound.input;
  const current = defaultDevice(sound.inputs);
  const client = context.desktop.client;
  if (!sound.inputs.length)
    return section("sound.input-section", "Input", [
      infoRow(
        "sound.input",
        settingEntry("sound.input").label,
        "None",
        "No microphone is connected",
      ),
    ]);
  const meter = sound.meter;
  return section("sound.input-section", "Input", [
    sound.inputs.length > 1
      ? selectRow(
          "sound.input",
          context,
          current?.id ?? null,
          deviceChoices(sound.inputs),
          (id) =>
            context.attempt(PAGE, () =>
              context.desktop.run("input", (client) => client.setDefaultSoundDevice("input", id)),
            ),
          { disabled: context.desktop.busy === "input" },
        )
      : infoRow(
          "sound.input",
          settingEntry("sound.input").label,
          current?.name ?? sound.inputs[0]!.name,
          "The default input",
        ),
    input &&
      toggleRow(
        "sound.input-mute",
        !input.muted,
        (on) =>
          context.attempt(PAGE, () =>
            context.desktop.run("input-mute", (client) => client.setInputMute(!on)),
          ),
        {
          description: input.muted ? "Muted: apps hear silence" : "On",
          disabled: context.desktop.busy === "input-mute",
        },
      ),
    input &&
      sliderRow(
        "sound.input-volume",
        input.muted ? "Muted" : volumePercent(input.volume),
        (width) => (
          <LevelSlider
            value={input.volume}
            width={width}
            height={24 * ui}
            focusId="setting:sound.input-volume"
            disabled={context.desktop.busy === "input-volume"}
            onCommit={(value) =>
              context.attempt(PAGE, () =>
                context.desktop.run("input-volume", (client) => client.setInputVolume(value)),
              )
            }
          />
        ),
      ),
    // The meter needs a PipeWire capture stream; without one the row says why instead of showing a
    // dead bar.
    input && client && meter.kind !== "unavailable"
      ? sliderRow("sound.input-level", settingEntry("sound.input-level").description, (width) => (
          <InputLevelMeter
            client={client}
            width={width}
            onError={(message) => context.report(PAGE, message)}
          />
        ))
      : input && meter.kind === "unavailable"
        ? infoRow(
            "sound.input-level",
            settingEntry("sound.input-level").label,
            "Unavailable",
            meter.message,
          )
        : null,
  ]);
}

function streamRow(context: PageContext, stream: DesktopSoundStream): SettingRowSpec {
  const ui = getUiScaleFactor();
  const busy = context.desktop.busy === `stream:${stream.id}`;
  const run = (action: (client: DesktopStatusClient) => Promise<void>) =>
    context.attempt(PAGE, () => context.desktop.run(`stream:${stream.id}`, action));
  return sliderRow(
    `sound.app.${stream.id}`,
    streamDescription(stream),
    (width) => {
      const slider = Math.max(40 * ui, width - (MUTE_BUTTON + MUTE_GAP) * ui);
      return (
        <Box width={width} height={24 * ui}>
          <LevelSlider
            value={stream.volume}
            width={slider}
            height={24 * ui}
            focusId={`setting:sound.app.${stream.id}`}
            disabled={busy}
            onCommit={(value) => run((client) => client.setStreamVolume(stream.id, value))}
          />
          <IconButton
            x={slider + MUTE_GAP * ui}
            y={(24 - MUTE_BUTTON) * ui * 0.5}
            width={MUTE_BUTTON * ui}
            height={MUTE_BUTTON * ui}
            icon={(style) => (
              <Icon
                name={stream.muted ? "volume-muted" : "volume"}
                size={style.size}
                color={style.color}
                symbolic
              />
            )}
            variant="ghost"
            selected={stream.muted}
            tooltip={stream.muted ? `Unmute ${stream.app}` : `Mute ${stream.app}`}
            focusId={`setting:sound.app.${stream.id}:mute`}
            disabled={busy}
            onPress={() => run((client) => client.setStreamMute(stream.id, !stream.muted))}
          />
        </Box>
      );
    },
    stream.app,
  );
}

function appsSection(context: PageContext, sound: ReadySound) {
  return section(
    "sound.apps",
    settingEntry("sound.apps").label,
    sound.streams.length
      ? sound.streams.map((stream) => streamRow(context, stream))
      : [infoRow("sound.apps.none", "No apps are playing", "", appsSummary(sound.streams))],
  );
}

export function soundPage(context: PageContext): PageContent {
  const audio = context.desktop.snapshot?.audio;
  const sound = context.desktop.snapshot?.sound;
  const ready = sound?.kind === "ready" ? sound : null;
  if (audio?.kind !== "ready")
    return {
      summary: "Output volume",
      sections: [],
      empty: {
        icon: "volume",
        title: "Sound controls aren't available",
        message:
          audio?.message ??
          "The desktop controls service isn't running, so Settings can't reach the audio system.",
      },
    };
  const muteToggle = (focusId: string) => (
    <Toggle
      on={!audio.muted}
      focusId={focusId}
      disabled={context.desktop.busy === "mute"}
      onChange={(on) => setMuted(context, !on)}
    />
  );
  return {
    summary: `${audio.name} · ${audio.muted ? "muted" : volumePercent(audio.volume)}`,
    hero: {
      kind: "status",
      icon: audio.muted ? "volume-muted" : "volume",
      title: "Sound",
      detail: audio.muted
        ? `Muted · ${audio.name}`
        : `On · ${volumePercent(audio.volume)} on ${audio.name}`,
      control: muteToggle("setting:sound.mute"),
    },
    searchRows: [
      {
        id: "sound.mute",
        label: "Sound on",
        description: settingEntry("sound.mute").description,
        control: { kind: "compact", width: 52, render: () => muteToggle("search:sound.mute") },
      },
    ],
    banners:
      sound && sound.kind !== "ready" && sound.kind !== "loading"
        ? [
            {
              id: "sound-devices",
              title: "Other sound devices can't be listed",
              message: sound.message,
              tone: "warning",
            },
          ]
        : undefined,
    sections: [
      outputSection(context, audio, ready),
      ...(ready ? [inputSection(context, ready), appsSection(context, ready)] : []),
    ],
  };
}
