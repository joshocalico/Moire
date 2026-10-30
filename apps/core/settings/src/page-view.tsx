/**
 * A page in the content area: its title and live summary in a fixed header, then banners, the
 * hero and the sections in a centred scrolling column. A deep link scrolls its row or section
 * into view and the row flashes.
 */
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Banner,
  Box,
  EmptyState,
  PageHero,
  ScrollArea,
  SettingsSection,
  TextBlock,
  bannerHeight,
  getUiScaleFactor,
  settingsRowOffset,
  settingsSectionHeight,
  usePalette,
  type SettingsSectionSpec,
} from "@moire/ui";
import type { Banner as BannerSpec, Hero, PageContent } from "./model";

/** The fixed header above the scrolling column: title and summary. */
export const HEADER = 76;
const MAX_COLUMN = 660;
const GUTTER = 24;
const GAP = 18;
const BANNER_GAP = 12;

/** The page column's width and left edge inside an area this wide. */
export function pageColumn(areaWidth: number): { x: number; width: number } {
  const ui = getUiScaleFactor();
  const width = Math.max(1, Math.min(areaWidth - GUTTER * 2 * ui, MAX_COLUMN * ui));
  return { x: Math.round((areaWidth - width) / 2), width };
}

function heroHeight(hero: Hero | undefined): number {
  const ui = getUiScaleFactor();
  if (!hero) return 0;
  return hero.kind === "custom" ? hero.height * ui : 84 * ui;
}

/** Where each block sits in the column, and the column's whole height. */
function layout(props: {
  banners: readonly BannerSpec[];
  hero?: Hero;
  sections: readonly SettingsSectionSpec[];
  width: number;
}) {
  const ui = getUiScaleFactor();
  let y = 8 * ui;
  const banners = props.banners.map((banner) => {
    const top = y;
    y += bannerHeight(banner) + BANNER_GAP * ui;
    return top;
  });
  const heroY = y;
  if (props.hero) y += heroHeight(props.hero) + GAP * ui;
  const sections = props.sections.map((section) => {
    const top = y;
    y += settingsSectionHeight(section, props.width) + GAP * ui;
    return top;
  });
  return { banners, heroY, sections, height: y + 6 * ui };
}

/** The scroll offset that brings an anchor (a section or a row) to the top. */
function anchorOffset(
  anchor: string | null | undefined,
  sections: readonly SettingsSectionSpec[],
  tops: readonly number[],
  width: number,
): number {
  if (!anchor) return 0;
  const ui = getUiScaleFactor();
  for (const [index, section] of sections.entries()) {
    if (section.id === anchor) return Math.max(0, tops[index]! - 8 * ui);
    const row = settingsRowOffset(section, width, anchor);
    if (row != null) return Math.max(0, tops[index]! + row - 24 * ui);
  }
  return 0;
}

export type PageViewProps = {
  x: number;
  width: number;
  height: number;
  title: string;
  summary: string;
  /** The page's colour, for its hero. */
  tint?: number;
  /** Room kept clear at the header's right for the window controls. */
  controlsWidth: number;
  /** Replaces the title, for the search field on a narrow window. */
  header?: ReactNode;
  banners?: readonly BannerSpec[];
  hero?: Hero;
  sections: readonly SettingsSectionSpec[];
  empty?: PageContent["empty"];
  /** Scroll here when the page opens: a section or row id. */
  anchor?: string | null;
  /** The row drawn with an accent wash (a deep link's target, the active search result). */
  highlightedId?: string | null;
};

export function PageView(props: PageViewProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const column = pageColumn(props.width);
  const banners = props.banners ?? [];
  const sections = props.sections.filter((section) => section.rows.length > 0);
  const placed = layout({ banners, hero: props.hero, sections, width: column.width });
  const header = HEADER * ui;
  const bodyH = Math.max(1, props.height - header);
  const [scrollY, setScrollY] = useState(() =>
    anchorOffset(props.anchor, sections, placed.sections, column.width),
  );
  useEffect(() => {
    setScrollY(anchorOffset(props.anchor, sections, placed.sections, column.width));
  }, [props.anchor]);
  const maxScroll = Math.max(0, placed.height - bodyH);
  const titleW = Math.max(
    1,
    Math.min(column.width, props.width - column.x - props.controlsWidth) - 4 * ui,
  );
  return (
    <Box x={props.x} width={props.width} height={props.height}>
      {props.header ? (
        <Box x={column.x} y={14 * ui} width={titleW} height={36 * ui}>
          {props.header}
        </Box>
      ) : (
        <TextBlock
          x={column.x + 2 * ui}
          y={22 * ui}
          width={titleW}
          height={28 * ui}
          text={props.title}
          fontSize={20}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      )}
      <TextBlock
        x={column.x + 2 * ui}
        y={50 * ui}
        width={column.width - 4 * ui}
        height={18 * ui}
        text={props.summary}
        fontSize={12}
        color={pal.muted}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.empty ? (
        <EmptyState
          y={header}
          width={props.width}
          height={bodyH}
          title={props.empty.title}
          message={props.empty.message}
          icon={props.empty.icon}
          action={props.empty.action}
        />
      ) : (
        <ScrollArea
          y={header}
          width={props.width}
          height={bodyH}
          contentHeight={Math.max(bodyH, placed.height)}
          scrollY={Math.min(scrollY, maxScroll)}
          onScroll={setScrollY}
          keyboard={{ focusId: "page:scroll" }}
          fill={pal.bg}
        >
          <Box width={props.width} height={Math.max(bodyH, placed.height)}>
            {banners.map((banner, index) => (
              <Banner
                key={banner.id}
                x={column.x}
                y={placed.banners[index]}
                width={column.width}
                title={banner.title}
                message={banner.message}
                tone={banner.tone}
                icon={banner.icon}
                action={banner.action}
                actionWidth={banner.actionWidth ? banner.actionWidth * ui : undefined}
              />
            ))}
            {props.hero ? (
              <Box
                x={column.x}
                y={placed.heroY}
                width={column.width}
                height={heroHeight(props.hero)}
              >
                {props.hero.kind === "custom" ? (
                  props.hero.render(column.width)
                ) : (
                  <PageHero
                    width={column.width}
                    tint={props.tint}
                    icon={props.hero.icon}
                    title={props.hero.title}
                    detail={props.hero.detail}
                    control={props.hero.control}
                    controlWidth={
                      props.hero.control ? (props.hero.controlWidth ?? 52) * ui : undefined
                    }
                  />
                )}
              </Box>
            ) : null}
            {sections.map((section, index) => (
              <SettingsSection
                key={section.id}
                x={column.x}
                y={placed.sections[index]}
                width={column.width}
                section={section}
                highlightedId={props.highlightedId}
              />
            ))}
          </Box>
        </ScrollArea>
      )}
    </Box>
  );
}
