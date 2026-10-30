/**
 * Keyboard & Mouse: the layouts you type with and how to switch them, Caps Lock, key repeat
 * with a field to try it, the pointer, and the touchpad when the compositor has one open.
 * Everything is written to prefs, which the compositor follows within a second.
 */
import React, { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Horizontal,
  Icon,
  IconButton,
  ScrollArea,
  SearchField,
  SettingsSection,
  TextField,
  getUiScaleFactor,
  settingsSectionHeight,
  type SettingRowSpec,
} from "@moire/ui";
import {
  MAX_KEYBOARD_LAYOUTS,
  REPEAT_DELAY_RANGE,
  REPEAT_RATE_RANGE,
  keyboardLayoutId,
  type KeyboardLayoutRef,
  type KeyboardSettings,
  type PointerSettings,
} from "@moire/prefs";
import {
  touchpadPresence,
  type KeyboardLayoutCatalog,
} from "@moire/system-management/input-settings";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section, segmentedRow, selectRow, sliderRow, toggleRow } from "#settings-view/rows";
import { fold } from "#settings/search-settings";

const PAGE = "keyboard";
const PICKER_RESULTS = 60;

export type LayoutChoice = KeyboardLayoutRef & { label: string; detail: string };

/** Every layout and variant in the catalog as one pickable list. */
export function layoutChoices(catalog: KeyboardLayoutCatalog): LayoutChoice[] {
  return catalog.layouts.flatMap((layout) => [
    { layout: layout.name, variant: "", label: layout.description, detail: layout.name },
    ...layout.variants.map((variant) => ({
      layout: layout.name,
      variant: variant.name,
      label: variant.description,
      detail: `${layout.name} (${variant.name})`,
    })),
  ]);
}

/** Choices whose name or code contains every word of the query, layouts before variants. */
export function filterLayouts(
  choices: readonly LayoutChoice[],
  query: string,
  limit = PICKER_RESULTS,
) {
  const words = fold(query).split(" ").filter(Boolean);
  return choices
    .filter((choice) => {
      const text = fold(`${choice.label} ${choice.detail}`);
      return words.every((word) => text.includes(word));
    })
    .slice(0, limit);
}

/** A layout's name from the catalog, or its XKB id when the catalog doesn't know it. */
export function layoutName(catalog: KeyboardLayoutCatalog | null, ref: KeyboardLayoutRef): string {
  const layout = catalog?.layouts.find((entry) => entry.name === ref.layout);
  if (!layout) return keyboardLayoutId(ref);
  if (!ref.variant) return layout.description;
  return (
    layout.variants.find((variant) => variant.name === ref.variant)?.description ??
    keyboardLayoutId(ref)
  );
}

/** Move one entry up or down a list. */
export function moved<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function setKeyboard(context: PageContext, patch: Partial<KeyboardSettings>) {
  const client = context.input.client;
  if (!client) return;
  context.attempt(PAGE, () => client.setKeyboard(patch).then(() => null));
}

function setPointer(context: PageContext, patch: Partial<PointerSettings>) {
  const client = context.input.client;
  if (!client) return;
  context.attempt(PAGE, () => client.setPointer(patch).then(() => null));
}

function LayoutPicker(props: { context: PageContext; width: number; height: number }): ReactNode {
  const { context } = props;
  const ui = getUiScaleFactor();
  const [query, setQuery] = useState("");
  const catalog = context.input.catalog;
  const choices = useMemo(() => (catalog ? layoutChoices(catalog) : []), [catalog]);
  const results = useMemo(() => filterLayouts(choices, query), [choices, query]);
  const layouts = context.input.state?.keyboard.layouts ?? [];
  const have = new Set(layouts.map(keyboardLayoutId));
  const inner = props.width - 32 * ui;
  const list = section(
    "layouts",
    undefined,
    catalog
      ? results.length
        ? results.map((choice) => {
            const added = have.has(keyboardLayoutId(choice));
            return {
              id: `choice:${keyboardLayoutId(choice)}`,
              label: choice.label,
              description: added ? `${choice.detail} · added` : choice.detail,
              labelTone: added ? ("muted" as const) : undefined,
              focusId: `keyboard:add:${keyboardLayoutId(choice)}`,
              onPress: added
                ? undefined
                : () => {
                    context.closeSheet();
                    setKeyboard(context, {
                      layouts: [...layouts, { layout: choice.layout, variant: choice.variant }],
                    });
                  },
            };
          })
        : [
            {
              id: "choice:none",
              label: "No layouts match",
              description: "Try a language or country",
            },
          ]
      : [{ id: "choice:loading", label: "Reading layouts…" }],
  );
  const top = 48 * ui;
  return (
    <Box width={props.width} height={props.height}>
      <SearchField
        x={16 * ui}
        width={inner}
        height={34 * ui}
        value={query}
        placeholder="Search languages and layouts"
        autoFocus
        focusId="keyboard:layout-search"
        onChange={setQuery}
      />
      <ScrollArea
        y={top}
        width={props.width}
        height={props.height - top}
        contentHeight={settingsSectionHeight(list, inner) + 16 * ui}
      >
        <SettingsSection x={16 * ui} width={inner} section={list} />
      </ScrollArea>
    </Box>
  );
}

function layoutRows(context: PageContext, keyboard: KeyboardSettings): SettingRowSpec[] {
  const ui = getUiScaleFactor();
  const catalog = context.input.catalog;
  const active = context.input.state?.activeLayout;
  const layouts = keyboard.layouts;
  const button = (
    icon: "chevron-up" | "chevron-down" | "close",
    tooltip: string,
    focusId: string,
    disabled: boolean,
    onPress: () => void,
  ) => (
    <IconButton
      key={icon}
      width={28 * ui}
      height={28 * ui}
      variant="ghost"
      tooltip={tooltip}
      focusId={focusId}
      disabled={disabled}
      icon={(style) => <Icon name={icon} size={14 * ui} color={style.color} symbolic />}
      onPress={onPress}
    />
  );
  const rows: SettingRowSpec[] = layouts.map((ref, index) => {
    const id = keyboardLayoutId(ref);
    const name = layoutName(catalog, ref);
    return {
      id: index === 0 ? "keyboard.layouts" : `layout:${id}`,
      label: name,
      description: [
        id,
        index === 0 ? "Default" : null,
        active && active.index === index && layouts.length > 1 ? "In use now" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      icon: "keyboard",
      tint: index === 0 ? 0xff5aa2f0 : 0xff8a94a6,
      control: {
        kind: "compact",
        width: 96,
        render: () => (
          <Horizontal width={96 * ui} height={28 * ui} gap={6 * ui} align="center" justify="end">
            {button("chevron-up", `Move ${name} up`, `keyboard:up:${id}`, index === 0, () =>
              setKeyboard(context, { layouts: moved(layouts, index, -1) }),
            )}
            {button(
              "chevron-down",
              `Move ${name} down`,
              `keyboard:down:${id}`,
              index === layouts.length - 1,
              () => setKeyboard(context, { layouts: moved(layouts, index, 1) }),
            )}
            {button("close", `Remove ${name}`, `keyboard:remove:${id}`, layouts.length <= 1, () =>
              setKeyboard(context, { layouts: layouts.filter((_, other) => other !== index) }),
            )}
          </Horizontal>
        ),
      },
    };
  });
  if (layouts.length < MAX_KEYBOARD_LAYOUTS)
    rows.push({
      id: "layout:add",
      label: "Add a layout…",
      description: `Up to ${MAX_KEYBOARD_LAYOUTS}; the first is the default`,
      icon: "plus",
      tint: 0xff8a94a6,
      chevron: true,
      focusId: "keyboard:add",
      onPress: () => {
        context.input.loadCatalog();
        context.openSheet(PAGE, "add-layout");
      },
    });
  return rows;
}

/** Repeat delay and rate as slider positions and back, within the compositor's ranges. */
const delayToSlider = (ms: number) =>
  (ms - REPEAT_DELAY_RANGE.min) / (REPEAT_DELAY_RANGE.max - REPEAT_DELAY_RANGE.min);
const sliderToDelay = (value: number) =>
  Math.round(
    (REPEAT_DELAY_RANGE.min + value * (REPEAT_DELAY_RANGE.max - REPEAT_DELAY_RANGE.min)) / 10,
  ) * 10;
const rateToSlider = (rate: number) =>
  (rate - REPEAT_RATE_RANGE.min) / (REPEAT_RATE_RANGE.max - REPEAT_RATE_RANGE.min);
const sliderToRate = (value: number) =>
  Math.round(REPEAT_RATE_RANGE.min + value * (REPEAT_RATE_RANGE.max - REPEAT_RATE_RANGE.min));

function TryTyping(props: { width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const [text, setText] = useState("");
  return (
    <TextField
      width={props.width}
      height={32 * ui}
      value={text}
      placeholder="Type here to try the keyboard"
      focusId="keyboard:try"
      onChange={setText}
    />
  );
}

function touchpadRows(
  context: PageContext,
  pointer: PointerSettings,
  pad: { clickpad: boolean },
): SettingRowSpec[] {
  return [
    toggleRow("keyboard.tap-to-click", pointer.tapToClick, (on) =>
      setPointer(context, { tapToClick: on }),
    ),
    segmentedRow(
      "keyboard.scroll-method",
      pointer.scrollMethod,
      [
        { id: "two-finger", label: "Fingers" },
        { id: "edge", label: "Edge" },
        { id: "none", label: "Off" },
      ],
      (id) => setPointer(context, { scrollMethod: id as PointerSettings["scrollMethod"] }),
      { width: 260 },
    ),
    pointer.scrollMethod !== "none"
      ? toggleRow("keyboard.touchpad-natural-scroll", pointer.naturalScrollTouchpad, (on) =>
          setPointer(context, { naturalScrollTouchpad: on }),
        )
      : null,
    pointer.scrollMethod === "two-finger"
      ? toggleRow("keyboard.kinetic-scroll", pointer.kineticScroll, (on) =>
          setPointer(context, { kineticScroll: on }),
        )
      : null,
    pad.clickpad
      ? segmentedRow(
          "keyboard.click-method",
          pointer.clickMethod,
          [
            { id: "clickfinger", label: "Fingers" },
            { id: "areas", label: "Corners" },
          ],
          (id) => setPointer(context, { clickMethod: id as PointerSettings["clickMethod"] }),
          {
            width: 200,
            description:
              pointer.clickMethod === "clickfinger"
                ? "Click with two fingers to right-click, three to middle-click"
                : "Click the bottom right to right-click, the middle to middle-click",
          },
        )
      : null,
    toggleRow("keyboard.disable-while-typing", pointer.disableWhileTyping, (on) =>
      setPointer(context, { disableWhileTyping: on }),
    ),
  ].filter((row): row is SettingRowSpec => row !== null);
}

export function keyboardPage(context: PageContext): PageContent {
  const state = context.input.state;
  if (!state || !context.input.client)
    return {
      summary: "Layouts, key repeat and the pointer",
      sections: [],
      empty: {
        icon: "keyboard",
        title: "Keyboard settings aren't available",
        message: "Settings couldn't read the input preferences.",
      },
    };
  const { keyboard, pointer } = state;
  const viewport = { width: context.width, height: context.height };
  const pad = touchpadPresence(state);
  return {
    summary: [
      layoutName(context.input.catalog, keyboard.layouts[0] ?? { layout: "us", variant: "" }),
      keyboard.layouts.length > 1 ? `${keyboard.layouts.length} layouts` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    sections: [
      section("keyboard.layouts-section", "Layouts", layoutRows(context, keyboard)),
      section("keyboard.keys", "Keys", [
        keyboard.layouts.length > 1
          ? selectRow(
              "keyboard.switch",
              viewport,
              keyboard.switchShortcut,
              [
                { id: "super-space", label: "Super+Space" },
                { id: "alt-shift", label: "Alt+Shift" },
                { id: "ctrl-shift", label: "Ctrl+Shift" },
                { id: "none", label: "None" },
              ],
              (id) =>
                setKeyboard(context, { switchShortcut: id as KeyboardSettings["switchShortcut"] }),
            )
          : null,
        selectRow(
          "keyboard.caps",
          viewport,
          keyboard.capsLock,
          [
            { id: "normal", label: "Caps Lock" },
            { id: "ctrl", label: "Another Ctrl" },
            { id: "escape", label: "Escape" },
          ],
          (id) => setKeyboard(context, { capsLock: id as KeyboardSettings["capsLock"] }),
        ),
      ]),
      section("keyboard.repeat-section", "Key repeat", [
        toggleRow("keyboard.repeat", keyboard.repeatEnabled, (on) =>
          setKeyboard(context, { repeatEnabled: on }),
        ),
        keyboard.repeatEnabled
          ? sliderRow(
              "keyboard.repeat-delay",
              delayToSlider(keyboard.repeatDelayMs),
              {
                onCommit: (value) => setKeyboard(context, { repeatDelayMs: sliderToDelay(value) }),
              },
              { description: `${keyboard.repeatDelayMs} ms before repeating` },
            )
          : null,
        keyboard.repeatEnabled
          ? sliderRow(
              "keyboard.repeat-rate",
              rateToSlider(keyboard.repeatRate),
              { onCommit: (value) => setKeyboard(context, { repeatRate: sliderToRate(value) }) },
              { description: `${keyboard.repeatRate} characters a second` },
            )
          : null,
        {
          id: "keyboard:try",
          label: "Try it",
          control: { kind: "wide", height: 32, render: (width) => <TryTyping width={width} /> },
        },
      ]),
      section(
        "keyboard.pointer",
        "Mouse and pointer",
        [
          sliderRow(
            "keyboard.pointer-speed",
            (pointer.speed + 1) / 2,
            {
              onCommit: (value) =>
                setPointer(context, { speed: Math.round((value * 2 - 1) * 20) / 20 }),
            },
            {
              description:
                pointer.speed === 0 ? "Default" : pointer.speed < 0 ? "Slower" : "Faster",
            },
          ),
          segmentedRow(
            "keyboard.acceleration",
            pointer.accelProfile,
            [
              { id: "adaptive", label: "Adaptive" },
              { id: "flat", label: "Flat" },
            ],
            (id) => setPointer(context, { accelProfile: id as PointerSettings["accelProfile"] }),
            { width: 200 },
          ),
          toggleRow("keyboard.natural-scroll", pointer.naturalScrollMouse, (on) =>
            setPointer(context, { naturalScrollMouse: on }),
          ),
          toggleRow("keyboard.left-handed", pointer.leftHanded, (on) =>
            setPointer(context, { leftHanded: on }),
          ),
          toggleRow("keyboard.middle-click", pointer.middleEmulation, (on) =>
            setPointer(context, { middleEmulation: on }),
          ),
        ],
        {
          footnote: "Speed and acceleration move mice and touchpads, not tablets or touch screens",
        },
      ),
      // Only a touchpad Moire's multitouch driver has open gets these; elsewhere they'd do nothing.
      section(
        "keyboard.touchpad",
        "Touchpad",
        pad.touchpad ? touchpadRows(context, pointer, pad) : [],
      ),
    ],
    sheet: (id) =>
      id === "add-layout"
        ? { title: "Add a layout", body: (size) => <LayoutPicker context={context} {...size} /> }
        : null,
  };
}
