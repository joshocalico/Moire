/**
 * Search results as a page: where to look, the best match, then sections by kind with a reason
 * per result. Images show as a strip of thumbnails. Focus stays in the search field while the
 * arrow keys move the highlight; the results are also pointer and keyboard targets themselves.
 */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  ChipGroup,
  CollectionItem,
  EmptyState,
  Surface,
  TextBlock,
  filterChipHeight,
  getUiScaleFactor,
  mixColor,
  usePalette,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/ui";
import type { SearchHit } from "@moire/system-management/index-status";
import { formatBytes, formatDay, tidyPath } from "#files/format";
import { kindName } from "#files/kind-style";
import type { ResultSection, SearchView } from "#files/search/results";
import { reasonLabel } from "#files/search/results";
import type { ScopeChoice, SearchScope } from "#files/search/scope";
import { sameScope } from "#files/search/scope";
import { FileRow, ROW_PITCH } from "./file-row";
import { PageScroller, type PageBlock } from "./page-scroller";
import { previewSummary } from "#files/preview/model";
import { usePreview } from "#files/preview/use-preview";
import { Thumbnail } from "./thumbnail";

const HEADING = 36;
const BEST_HEIGHT = 96;
const STRIP_TILE = 112;
const STRIP_MAX = 7;
const GAP = 10;

const resultFocusId = (file: string) => `result:${file}`;

type SearchPageProps = {
  width: number;
  height: number;
  pad: number;
  home: string;
  scopes: readonly ScopeChoice[];
  scope: SearchScope;
  onScope(scope: SearchScope): void;
  view: SearchView | null;
  searching: boolean;
  /** "Searching names only; …" when the index did not answer. */
  notice: string | null;
  active: string | null;
  onActive(file: string): void;
  onOpen(hit: SearchHit): void;
  onShow(hit: SearchHit): void;
  onShowAll(section: ResultSection): void;
  onSearchEverywhere: (() => void) | null;
  onContextMenu(hit: SearchHit, event: HitPointerEvent): void;
  onKeyDown(event: HitKeyEvent): boolean;
  scrollY: number;
  onScroll(scrollY: number): void;
};

function Heading(props: { width: number; text: string; action?: () => void }) {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const height = Math.round(HEADING * ui);
  return (
    <Box width={props.width} height={height}>
      <TextBlock
        width={props.width}
        height={height}
        text={props.text}
        fontSize={13}
        fontWeight="medium"
        verticalAlign="center"
      />
      {props.action ? (
        <Button
          x={props.width - Math.round(72 * ui)}
          y={Math.round((height - 28 * ui) / 2)}
          width={Math.round(72 * ui)}
          height={Math.round(28 * ui)}
          size="small"
          variant="ghost"
          color={pal.accentLine}
          label="Show all"
          onPress={props.action}
        />
      ) : null}
    </Box>
  );
}

function BestMatch(props: {
  width: number;
  hit: SearchHit;
  home: string;
  active: boolean;
  onActive(): void;
  onOpen(): void;
  onShow(): void;
  onContextMenu(event: HitPointerEvent): void;
  onKeyDown(event: HitKeyEvent): boolean;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const height = px(BEST_HEIGHT);
  const picture = { width: px(120), height: px(72) };
  const buttons = props.width >= px(520);
  const textX = px(12) + picture.width + px(16);
  const textWidth = Math.max(1, props.width - textX - (buttons ? px(200) : px(12)));
  const fill = props.active ? pal.selection : mixColor(pal.bg, pal.selection, 0.5);
  const hit = props.hit;
  // A name match says nothing the name doesn't; what the file holds ("12 pages · Annual report")
  // does. Folder, tag and text reasons stay: they explain a match the name doesn't show.
  const summary = previewSummary(usePreview(hit));
  const facts = [
    tidyPath(path.dirname(hit.path), props.home),
    hit.isDir ? null : formatBytes(hit.size),
    formatDay(hit.modified),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Box width={props.width} height={height}>
      <CollectionItem
        width={props.width}
        height={height}
        focusId={resultFocusId(hit.path)}
        onFocusChange={(focused) => focused && props.onActive()}
        onPress={props.onActive}
        onDoublePress={props.onOpen}
        onContextMenu={props.onContextMenu}
        onKeyDown={props.onKeyDown}
      >
        <Surface width={props.width} height={height} radius={px(14)} fill={fill} />
        <Box x={px(12)} y={px(12)} width={picture.width} height={picture.height}>
          <Thumbnail
            entry={hit}
            width={picture.width}
            height={picture.height}
            radius={px(10)}
            iconScale={0.5}
            backdrop={fill}
          />
        </Box>
        <TextBlock
          x={textX}
          y={px(14)}
          width={textWidth}
          height={px(22)}
          text={hit.name}
          fontSize={15}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        <TextBlock
          x={textX}
          y={px(38)}
          width={textWidth}
          height={px(18)}
          text={facts}
          color={pal.muted}
          fontSize={12}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        <TextBlock
          x={textX}
          y={px(58)}
          width={textWidth}
          height={px(18)}
          text={
            hit.tags.length
              ? `Tagged ${hit.tags.join(", ")}`
              : (hit.reason.kind === "name" || hit.reason.kind === "filter" ? summary : null) ||
                reasonLabel(hit.reason) ||
                kindName(hit)
          }
          color={pal.muted}
          fontSize={12}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      </CollectionItem>
      {buttons ? (
        <>
          <Button
            x={props.width - px(196)}
            y={px(32)}
            width={px(84)}
            height={px(32)}
            size="small"
            variant="primary"
            label="Open"
            focusId="search:open"
            onPress={props.onOpen}
          />
          <Button
            x={props.width - px(104)}
            y={px(32)}
            width={px(92)}
            height={px(32)}
            size="small"
            variant="secondary"
            label="Show"
            focusId="search:show"
            onPress={props.onShow}
          />
        </>
      ) : null}
    </Box>
  );
}

export function SearchPage(props: SearchPageProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const width = Math.max(1, props.width - props.pad * 2);
  const blocks: PageBlock[] = [];
  const chipsHeight = filterChipHeight() + px(12);
  blocks.push({
    key: "scopes",
    height: chipsHeight + (props.notice ? px(22) : 0),
    render: (blockWidth) => (
      <Box width={blockWidth} height={chipsHeight + (props.notice ? px(22) : 0)}>
        <ChipGroup
          y={px(4)}
          width={blockWidth}
          chips={props.scopes.map((choice) => ({ id: choice.label, label: choice.label }))}
          selectedId={
            props.scopes.find((choice) => sameScope(choice.scope, props.scope))?.label ?? null
          }
          onSelect={(chip) => {
            const choice = props.scopes.find((candidate) => candidate.label === chip.id);
            if (choice) props.onScope(choice.scope);
          }}
        />
        {props.notice ? (
          <TextBlock
            y={chipsHeight}
            width={blockWidth}
            height={px(20)}
            text={props.notice}
            color={pal.muted}
            fontSize={12}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        ) : null}
      </Box>
    ),
  });
  const view = props.view;
  const empty = !!view && !view.best && view.sections.length === 0 && !props.searching;
  const interaction = (hit: SearchHit) => ({
    focusId: resultFocusId(hit.path),
    onFocusChange: (focused: boolean) => focused && props.onActive(hit.path),
    onPress: () => props.onActive(hit.path),
    onDoublePress: () => props.onOpen(hit),
    onContextMenu: (event: HitPointerEvent) => props.onContextMenu(hit, event),
    onKeyDown: props.onKeyDown,
  });
  if (view?.best) {
    const best = view.best;
    blocks.push({
      key: "best-heading",
      height: px(HEADING),
      render: (blockWidth) => <Heading width={blockWidth} text="Best match" />,
    });
    blocks.push({
      key: "best",
      height: px(BEST_HEIGHT) + px(12),
      keys: [best.path],
      render: (blockWidth) => (
        <BestMatch
          width={blockWidth}
          hit={best}
          home={props.home}
          active={props.active === best.path}
          onActive={() => props.onActive(best.path)}
          onOpen={() => props.onOpen(best)}
          onShow={() => props.onShow(best)}
          onContextMenu={(event) => props.onContextMenu(best, event)}
          onKeyDown={props.onKeyDown}
        />
      ),
    });
  }
  for (const section of view?.sections ?? []) {
    blocks.push({
      key: `heading:${section.id}`,
      height: px(HEADING),
      render: (blockWidth) => (
        <Heading
          width={blockWidth}
          text={`${section.label} · ${section.total.toLocaleString()}`}
          action={
            section.showAll && section.total > section.hits.length
              ? () => props.onShowAll(section)
              : undefined
          }
        />
      ),
    });
    if (section.id === "images") {
      const gap = px(GAP);
      const count = Math.max(
        1,
        Math.min(STRIP_MAX, Math.floor((width + gap) / (px(STRIP_TILE) + gap))),
      );
      const tile = Math.floor((width - gap * (count - 1)) / count);
      const hits = section.hits.slice(0, count);
      const height = Math.round(tile * 0.75) + px(12);
      blocks.push({
        key: "images",
        height,
        keys: hits.map((hit) => hit.path),
        render: () =>
          hits.map((hit, index) => (
            <Box key={hit.path} x={index * (tile + gap)} width={tile} height={height}>
              <CollectionItem width={tile} height={Math.round(tile * 0.75)} {...interaction(hit)}>
                <Thumbnail
                  entry={hit}
                  width={tile}
                  height={Math.round(tile * 0.75)}
                  radius={px(10)}
                  iconScale={0.4}
                />
                {props.active === hit.path ? (
                  <Surface
                    width={tile}
                    height={Math.round(tile * 0.75)}
                    radius={px(10)}
                    fill={0x00000000}
                    stroke={pal.accentLine}
                    strokeWidth={Math.max(2, px(2))}
                  />
                ) : null}
              </CollectionItem>
            </Box>
          )),
      });
      continue;
    }
    for (const hit of section.hits)
      blocks.push({
        key: `hit:${hit.path}`,
        height: px(ROW_PITCH),
        keys: [hit.path],
        render: (blockWidth) => (
          <FileRow
            width={blockWidth}
            entry={hit}
            caption={`${tidyPath(path.dirname(hit.path), props.home)}${hit.isDir ? "" : ` · ${formatBytes(hit.size)}`}`}
            trailing={reasonLabel(hit.reason)}
            actions={[
              { id: "open", label: "Open", icon: "forward", onPress: () => props.onOpen(hit) },
              {
                id: "show",
                label: "Show in Folder",
                icon: "folder",
                onPress: () => props.onShow(hit),
              },
            ]}
            selected={false}
            highlighted={props.active === hit.path}
            interaction={interaction(hit)}
          />
        ),
      });
  }
  if (!empty && view)
    blocks.push({
      key: "hint",
      height: px(40),
      render: (blockWidth) => (
        <TextBlock
          width={blockWidth}
          height={px(40)}
          text="↑↓ move · Enter open · Ctrl+Enter show in folder · Esc back"
          color={pal.muted}
          fontSize={11}
          horizontalAlign="center"
          verticalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
      ),
    });
  if (empty) {
    const chips = blocks[0]!;
    return (
      <Box width={props.width} height={props.height}>
        <Box x={props.pad} width={width} height={chips.height}>
          {chips.render(width)}
        </Box>
        <EmptyState
          y={chips.height}
          width={props.width}
          height={Math.max(1, props.height - chips.height)}
          icon="search"
          title="No results"
          message={
            props.onSearchEverywhere
              ? "Nothing here matches. Try looking everywhere."
              : "Try different words or fewer filters."
          }
          action={
            props.onSearchEverywhere ? (
              <Button
                width={Math.round(140 * ui)}
                height={px(32)}
                label="Search everywhere"
                variant="secondary"
                focusId="search:everywhere"
                onPress={props.onSearchEverywhere}
              />
            ) : undefined
          }
        />
      </Box>
    );
  }
  return (
    <PageScroller
      width={props.width}
      height={props.height}
      pad={props.pad}
      blocks={blocks}
      sticky={null}
      scrollY={props.scrollY}
      onScroll={props.onScroll}
      focusKey={props.active}
      bottomReserve={px(16)}
      band={null}
    />
  );
}
