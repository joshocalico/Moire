/**
 * Appearance: a live desktop preview beside the colour scheme, accent and interface size, then
 * the style, the wallpaper, and the panel's shape, each as pictures of what it changes.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  ColorBands,
  DesktopPreview,
  Icon,
  OptionCard,
  PageHero,
  PictureOptions,
  SegmentedControl,
  Slider,
  Surface,
  SwatchPicker,
  TextBlock,
  colorWithAlpha,
  ImageWidget,
  getUiScaleFactor,
  mixColor,
  type DesktopPreviewWallpaper,
  pictureOptionsHeight,
  swatchesThatFit,
  type SettingRowSpec,
  type ThemePalette,
} from "@moire/ui";
import { THEME_FAMILIES, type ThemeFamily } from "@moire/theme";
import type { WallpaperSettings } from "@moire/prefs";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section, segmentedRow, sliderRow, toggleRow } from "#settings-view/rows";
import { settingEntry } from "#settings/catalog";
import {
  ACCENTS,
  WALLPAPER_LABELS,
  accentId,
  chosenPalette,
  familyPalette,
  hexToArgb,
  scaleFromSlider,
  sliderFromScale,
  styleLabel,
  wallpaperChoice,
  wallpaperPicture,
  wallpaperSetting,
  type WallpaperChoice,
} from "./appearance-model";
import {
  SCHEME_CHOICES,
  autoDarkSection,
  chooseScheme,
  schemeChoice,
  schemeSummary,
} from "./auto-dark";

const PAGE = "appearance";
const HERO = 196;
/** Below this column width the preview sits above the controls. */
const STACK_HERO = 460;
/** Below this column width the panel pictures become segments. */
const PANEL_PICTURES = 560;
const STYLE_CARD = 84;
const SWATCH = 20;

/** The hero's right-hand controls: scheme, accent and interface size. */
function HeroControls(props: { context: PageContext; width: number }): ReactNode {
  const { context } = props;
  const pal = context.palette;
  const ui = getUiScaleFactor();
  const values = context.prefs.values;
  const swatches = ACCENTS.slice(0, swatchesThatFit(props.width + 6 * ui, SWATCH)).map((entry) => ({
    id: entry.id,
    label: entry.label,
    color: entry.hex ? hexToArgb(entry.hex) : familyPalette(values.themeFamily, values.dark).accent,
  }));
  const label = (y: number, text: string, muted = false) => (
    <TextBlock
      y={y}
      width={props.width}
      height={(muted ? 16 : 18) * ui}
      text={text}
      fontSize={muted ? 11 : 13}
      fontWeight={muted ? "regular" : "medium"}
      color={muted ? pal.muted : pal.text}
      verticalAlign="center"
      maxLines={1}
      overflow="ellipsis"
    />
  );
  return (
    <Box width={props.width} height={170 * ui}>
      {label(2 * ui, "Color scheme")}
      <SegmentedControl
        y={26 * ui}
        width={props.width}
        height={32 * ui}
        value={schemeChoice(values)}
        options={SCHEME_CHOICES}
        onChange={(value) => chooseScheme(context, value)}
      />
      {label(72 * ui, "Accent")}
      <SwatchPicker
        x={-3 * ui}
        y={94 * ui}
        size={SWATCH}
        swatches={swatches}
        value={accentId(values.accent)}
        focusId="setting:appearance.accent"
        onChange={(id) => {
          const entry = ACCENTS.find((candidate) => candidate.id === id)!;
          context.prefs.set(
            { accent: entry.hex },
            { label: `Accent set to ${entry.hex ? entry.label : "the style's own"}`, page: PAGE },
          );
        }}
      />
      {label(134 * ui, `Interface size · ${Math.round(values.uiScale * 100)}%`, true)}
      <Slider
        y={150 * ui}
        width={props.width}
        height={20 * ui}
        value={sliderFromScale(values.uiScale)}
        focusId="setting:appearance.size"
        onChange={(value) => context.prefs.setScaleLive(scaleFromSlider(value), PAGE)}
      />
    </Box>
  );
}

/** The hero's controls as rows of their own, for search results. */
function heroRows(context: PageContext): SettingRowSpec[] {
  const { values } = context.prefs;
  return [
    segmentedRow(
      "appearance.scheme",
      schemeChoice(values),
      SCHEME_CHOICES,
      (value) => chooseScheme(context, value),
      { description: schemeSummary(context) },
    ),
    {
      id: "appearance.accent",
      label: settingEntry("appearance.accent").label,
      description: settingEntry("appearance.accent").description,
      control: {
        kind: "wide",
        height: 28,
        render: (width) => (
          <SwatchPicker
            size={SWATCH}
            swatches={ACCENTS.slice(0, swatchesThatFit(width, SWATCH)).map((entry) => ({
              id: entry.id,
              label: entry.label,
              color: entry.hex
                ? hexToArgb(entry.hex)
                : familyPalette(values.themeFamily, values.dark).accent,
            }))}
            value={accentId(values.accent)}
            onChange={(id) => {
              const entry = ACCENTS.find((candidate) => candidate.id === id)!;
              context.prefs.set(
                { accent: entry.hex },
                {
                  label: `Accent set to ${entry.hex ? entry.label : "the style's own"}`,
                  page: PAGE,
                },
              );
            }}
          />
        ),
      },
    },
    sliderRow(
      "appearance.size",
      sliderFromScale(values.uiScale),
      { onChange: (value) => context.prefs.setScaleLive(scaleFromSlider(value), PAGE) },
      { description: `${Math.round(values.uiScale * 100)}% · applies to Moire apps and the panel` },
    ),
  ];
}

function heroHeight(width: number): number {
  return width < STACK_HERO * getUiScaleFactor() ? 14 + 150 + 16 + 170 + 14 : HERO;
}

function AppearanceHero(props: { context: PageContext; width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const { values } = props.context.prefs;
  const stacked = props.width < STACK_HERO * ui;
  const height = heroHeight(props.width) * ui;
  const palette = chosenPalette(values);
  const previewW = stacked
    ? props.width - 28 * ui
    : Math.min(300 * ui, Math.round(props.width * 0.46));
  const previewH = stacked ? 150 * ui : height - 28 * ui;
  const controlsX = stacked ? 14 * ui : 14 * ui + previewW + 20 * ui;
  const controlsW = stacked ? props.width - 28 * ui : props.width - controlsX - 18 * ui;
  return (
    <PageHero width={props.width} height={height} tint={palette.accent}>
      <DesktopPreview
        x={14 * ui}
        y={14 * ui}
        width={previewW}
        height={previewH}
        palette={palette}
        wallpaper={wallpaperPicture(wallpaperChoice(values.wallpaper), values, palette)}
        panel={values.panelFullWidth ? "full-width" : "islands"}
        iconsOnly={values.panelIconsOnly}
        desktopIcons={values.showDesktopIcons}
      />
      <Box
        x={controlsX}
        y={stacked ? 14 * ui + previewH + 16 * ui : 14 * ui}
        width={controlsW}
        height={170 * ui}
      >
        <HeroControls context={props.context} width={controlsW} />
      </Box>
    </PageHero>
  );
}

/** A wallpaper thumbnail: its colours, or the picture itself. */
function WallpaperPicture(props: {
  picture: DesktopPreviewWallpaper;
  width: number;
  height: number;
}) {
  return props.picture.kind === "image" ? (
    <ImageWidget
      width={props.width}
      height={props.height}
      src={props.picture.path}
      fit="cover"
      placeholder={false}
    />
  ) : (
    <ColorBands width={props.width} height={props.height} colors={props.picture.colors} />
  );
}

/** A style in miniature: its own background, window, titlebar and accent. */
function StylePicture(props: {
  family: ThemeFamily;
  dark: boolean;
  width: number;
  height: number;
}) {
  const ui = getUiScaleFactor();
  const fam = familyPalette(props.family, props.dark);
  const inset = 10 * ui;
  const innerW = props.width - inset * 2;
  const innerH = props.height - inset * 2;
  const pill = Math.min(22 * ui, Math.round(innerW * 0.28));
  return (
    <>
      <Surface width={props.width} height={props.height} fill={fam.bg} />
      <Surface
        x={inset}
        y={inset}
        width={innerW}
        height={innerH}
        radius={Math.min(8 * ui, fam.radiusWindow)}
        fill={fam.surface}
        stroke={fam.border}
        strokeWidth={1}
        clip
      >
        <Surface width={innerW} height={10 * ui} fill={fam.titlebar} />
        <Surface
          x={8 * ui}
          y={17 * ui}
          width={innerW * 0.4}
          height={5 * ui}
          radius={2 * ui}
          fill={colorWithAlpha(fam.muted, 0x99)}
        />
        <Surface
          x={8 * ui}
          y={26 * ui}
          width={innerW * 0.26}
          height={5 * ui}
          radius={2 * ui}
          fill={colorWithAlpha(fam.muted, 0x66)}
        />
        <Surface
          x={innerW - 8 * ui - pill}
          y={innerH - 14 * ui}
          width={pill}
          height={9 * ui}
          radius={4 * ui}
          fill={fam.accent}
        />
      </Surface>
    </>
  );
}

/** The panel's two shapes, drawn over a wash of the accent. */
function PanelPicture(props: {
  mode: "islands" | "full-width";
  palette: ThemePalette;
  width: number;
  height: number;
}) {
  const ui = getUiScaleFactor();
  const pal = props.palette;
  const bar = 12 * ui;
  const y = props.height - bar - (props.mode === "islands" ? 8 * ui : 0);
  const w = props.width;
  return (
    <>
      <ColorBands
        width={w}
        height={props.height}
        colors={[
          mixColor(pal.bg, pal.accent, 0.12),
          mixColor(pal.bg, pal.accent, 0.21),
          mixColor(pal.bg, pal.accent, 0.3),
        ]}
      />
      {props.mode === "islands" ? (
        <>
          <Surface
            x={8 * ui}
            y={y}
            width={w * 0.16}
            height={bar}
            radius={bar / 2}
            fill={pal.panel}
          />
          <Surface
            x={w * 0.32}
            y={y}
            width={w * 0.36}
            height={bar}
            radius={bar / 2}
            fill={pal.panel}
          >
            <Surface
              x={4 * ui}
              y={3 * ui}
              width={w * 0.12}
              height={6 * ui}
              radius={3 * ui}
              fill={pal.accent}
            />
          </Surface>
          <Surface
            x={w * 0.76}
            y={y}
            width={w * 0.24 - 8 * ui}
            height={bar}
            radius={bar / 2}
            fill={pal.panel}
          />
        </>
      ) : (
        <Surface y={props.height - bar - 2 * ui} width={w} height={bar + 2 * ui} fill={pal.panel}>
          <Surface
            x={w * 0.36}
            y={4 * ui}
            width={w * 0.12}
            height={6 * ui}
            radius={3 * ui}
            fill={pal.accent}
          />
        </Surface>
      )}
    </>
  );
}

function styleRow(context: PageContext, width: number): SettingRowSpec {
  const ui = getUiScaleFactor();
  const { values } = context.prefs;
  const inner = width - 32 * ui;
  const columns = inner / THEME_FAMILIES.length < 96 * ui ? 3 : THEME_FAMILIES.length;
  const height = pictureOptionsHeight(THEME_FAMILIES.length, STYLE_CARD * ui, columns, 8);
  return {
    id: "appearance.style",
    label: settingEntry("appearance.style").label,
    control: {
      kind: "block",
      height: height / ui,
      render: (blockWidth) => (
        <PictureOptions
          width={blockWidth}
          height={STYLE_CARD * ui}
          gap={8}
          columns={columns}
          focusId="setting:appearance.style"
          value={values.themeFamily}
          options={THEME_FAMILIES.map((family) => ({
            id: family,
            label: styleLabel(family),
            picture: (size) => <StylePicture family={family} dark={values.dark} {...size} />,
          }))}
          onChange={(id) => {
            const family = THEME_FAMILIES.find((candidate) => candidate === id)!;
            context.prefs.set(
              { themeFamily: family },
              { label: `Desktop style set to ${styleLabel(family)}`, page: PAGE },
            );
          }}
        />
      ),
    },
  };
}

function wallpaperRow(context: PageContext, width: number): SettingRowSpec {
  const ui = getUiScaleFactor();
  const { values } = context.prefs;
  const palette = chosenPalette(values);
  const current = wallpaperChoice(values.wallpaper);
  const image = values.wallpaper?.mode === "image" ? values.wallpaper.path : undefined;
  const choices: WallpaperChoice[] = [
    "theme",
    "atmosphere",
    "gradient",
    "solid",
    ...(image ? ["image" as const] : []),
  ];
  const inner = width - 32 * ui;
  const count = choices.length + 1;
  const columns = inner / count < 88 * ui ? 3 : count;
  const gap = 10 * ui;
  const cardW = Math.floor((inner - gap * (columns - 1)) / columns);
  const cardH = Math.round(cardW * 0.62) + 26 * ui;
  const rows = Math.ceil(count / columns);
  const height = rows * cardH + (rows - 1) * gap;
  const set = (wallpaper: WallpaperSettings | null, choice: WallpaperChoice) =>
    context.prefs.set(
      { wallpaper },
      { label: `Wallpaper set to ${WALLPAPER_LABELS[choice]}`, page: PAGE },
    );
  return {
    id: "appearance.wallpaper",
    label: settingEntry("appearance.wallpaper").label,
    control: {
      kind: "block",
      height: height / ui,
      render: (blockWidth) => (
        <Box width={blockWidth} height={height}>
          <PictureOptions
            width={(cardW + gap) * Math.min(columns, choices.length) - gap}
            height={cardH}
            columns={Math.min(columns, choices.length)}
            focusId="setting:appearance.wallpaper"
            value={current}
            options={choices.map((choice) => ({
              id: choice,
              label: WALLPAPER_LABELS[choice],
              picture: (size) => (
                <WallpaperPicture picture={wallpaperPicture(choice, values, palette)} {...size} />
              ),
            }))}
            onChange={(id) => {
              const choice = choices.find((candidate) => candidate === id)!;
              if (choice === "image") return;
              set(wallpaperSetting(choice), choice);
            }}
          />
          <OptionCard
            x={(choices.length % columns) * (cardW + gap)}
            y={Math.floor(choices.length / columns) * (cardH + gap)}
            width={cardW}
            height={cardH}
            label="Choose…"
            focusId="setting:appearance.wallpaper:choose"
            onPress={() => context.openChooser("wallpaper")}
          >
            {(size) => (
              <Icon
                x={(size.width - 20 * ui) / 2}
                y={(size.height - 20 * ui) / 2}
                name="plus"
                size={20 * ui}
                color={context.palette.muted}
                symbolic
              />
            )}
          </OptionCard>
        </Box>
      ),
    },
  };
}

function panelRow(context: PageContext, width: number): SettingRowSpec {
  const ui = getUiScaleFactor();
  const { values } = context.prefs;
  const value = values.panelFullWidth ? "full-width" : "islands";
  const set = (fullWidth: boolean) =>
    context.prefs.set(
      { panelFullWidth: fullWidth },
      {
        label: fullWidth ? "Panel set to a full-width bar" : "Panel set to floating islands",
        page: PAGE,
      },
    );
  if (width < PANEL_PICTURES * ui)
    return segmentedRow(
      "appearance.panel",
      value,
      [
        { id: "islands", label: "Islands" },
        { id: "full-width", label: "Full width" },
      ],
      (id) => set(id === "full-width"),
      { description: "Floating islands or one bar", width: 200 },
    );
  const optionW = Math.min(170 * ui, Math.floor((width - 32 * ui - 12 * ui) / 2));
  const palette = chosenPalette(values);
  return {
    id: "appearance.panel",
    label: "Panel",
    description: "The bar along the bottom of the screen",
    height: 150,
    control: {
      kind: "wide",
      width: (optionW * 2 + 12 * ui) / ui,
      height: 104,
      render: (controlWidth) => (
        <PictureOptions
          width={controlWidth}
          height={104 * ui}
          gap={12}
          focusId="setting:appearance.panel"
          value={value}
          options={(["islands", "full-width"] as const).map((mode) => ({
            id: mode,
            label: mode === "islands" ? "Floating islands" : "Full-width bar",
            picture: (size) => <PanelPicture mode={mode} palette={palette} {...size} />,
          }))}
          onChange={(id) => set(id === "full-width")}
        />
      ),
    },
  };
}

export function appearancePage(context: PageContext): PageContent {
  const { values } = context.prefs;
  const ui = getUiScaleFactor();
  const column = context.columnWidth;
  return {
    summary: `${styleLabel(values.themeFamily)} · ${schemeSummary(context)} · ${Math.round(values.uiScale * 100)}% · changes apply as you make them`,
    searchRows: heroRows(context),
    hero: {
      kind: "custom",
      height: heroHeight(column),
      render: (width) => <AppearanceHero context={context} width={width} />,
    },
    sections: [
      section("appearance.look", "Style", [styleRow(context, column)]),
      autoDarkSection(context),
      section("appearance.background", "Wallpaper", [wallpaperRow(context, column)]),
      section("appearance.panel-and-windows", "Panel and windows", [
        panelRow(context, column),
        segmentedRow(
          "appearance.window-buttons",
          values.panelIconsOnly ? "icons" : "titles",
          [
            { id: "titles", label: "Titles" },
            { id: "icons", label: "Icons only" },
          ],
          (id) =>
            context.prefs.set(
              { panelIconsOnly: id === "icons" },
              {
                label:
                  id === "icons" ? "Window buttons show icons only" : "Window buttons show titles",
                page: PAGE,
              },
            ),
          {
            description: "Titles, or icons with titles as tooltips",
            width: Math.min(220, Math.round((column / ui) * 0.4)),
          },
        ),
      ]),
      section("appearance.motion-section", "Motion", [
        toggleRow(
          "appearance.motion",
          values.reducedMotion,
          (on) => context.prefs.setReducedMotion(on, PAGE),
          { disabled: context.prefs.motionSaving },
        ),
      ]),
    ],
  };
}
