import React, { type ReactNode } from "react";
import { Box, Button, getUiScaleFactor, type WindowActions, type WindowSize } from "@moire/ui";
import {
  AppFrame,
  CenteredMessage,
  FileChooser,
  TitleActions,
  ToolButton,
  appFrameBody,
  formatBytes,
  initialFile,
  runApp,
  startMain,
} from "@moire/app-tools";
import { statusText, tidyPath, visibleItems } from "./model";
import { useDiskUsage } from "./use-disk-usage";
import { PlaceBar } from "./place-bar";
import { Results } from "./results";
import { StartView } from "./start";

const TITLE = "Disk Usage";
const APP_ID = "org.moire.DiskUsage";

export function DiskUsageApp(
  props: WindowSize & { initialPath?: string; window?: WindowActions | null },
): ReactNode {
  const ui = getUiScaleFactor();
  const [state, controls, places] = useDiskUsage(props.initialPath);
  const { scan, query } = state;
  const home = places.home;
  const trail = scan.kind === "ready" ? scan.trail : [];
  const current = trail.at(-1);
  const items = visibleItems(state);
  const selected = items.find((item) => item.path === state.selected) ?? null;
  const body = appFrameBody({ height: props.height, title: TITLE, controls: !!current });
  const choose = () => controls.dispatch({ type: "choosing", open: true });
  const lastRoot =
    scan.kind === "idle" ? null : scan.kind === "ready" ? scan.result.root.path : scan.root;
  const picks = places.picks.map((pick) => ({ ...pick, detail: tidyPath(pick.path, home) }));
  const toolRow = current ? (
    <PlaceBar
      width={props.width}
      trail={trail}
      home={home}
      query={query}
      onGoTo={(depth) => controls.dispatch({ type: "go-to", depth })}
      onQuery={(value) => controls.dispatch({ type: "query", query: value })}
    />
  ) : null;
  return (
    <Box width={props.width} height={props.height}>
      <AppFrame
        {...props}
        title={TITLE}
        icon="disk-usage"
        subtitle={lastRoot ? tidyPath(lastRoot, home) : undefined}
        controls={toolRow}
        status={statusText(state)}
        statusEnd={current ? `${items.length} shown` : undefined}
        actions={
          scan.kind === "scanning" ? (
            <TitleActions>
              <Button
                width={84 * ui}
                height={32 * ui}
                label="Cancel"
                focusId="usage:cancel"
                onPress={controls.cancel}
              />
            </TitleActions>
          ) : (
            <TitleActions>
              {current ? (
                <ToolButton
                  icon="forward"
                  tooltip={
                    selected ? `Show “${selected.name}” in Files` : "Show this folder in Files"
                  }
                  focusId="usage:show"
                  onPress={() => controls.show(selected?.path ?? current.path)}
                />
              ) : null}
              {lastRoot ? (
                <ToolButton
                  icon="restart"
                  tooltip="Scan again"
                  focusId="usage:rescan"
                  onPress={() => controls.scan(lastRoot)}
                />
              ) : null}
              {lastRoot ? (
                <ToolButton
                  icon="folder"
                  tooltip="Choose another folder…"
                  focusId="usage:choose-other"
                  onPress={choose}
                />
              ) : null}
            </TitleActions>
          )
        }
      >
        {scan.kind === "scanning" ? (
          <CenteredMessage
            width={props.width}
            height={body.height}
            icon="disk-usage"
            title={`Measuring ${tidyPath(scan.root, home)}`}
            message={`${scan.entries.toLocaleString()} items · ${formatBytes(scan.bytes)} so far`}
            action={
              <Button
                width={120 * ui}
                height={36 * ui}
                label="Cancel scan"
                focusId="usage:cancel-scan"
                onPress={controls.cancel}
              />
            }
            actionWidth={120 * ui}
          />
        ) : current ? (
          <Results
            width={props.width}
            height={body.height}
            current={current}
            items={items}
            view={state.view}
            sort={state.sort}
            selected={state.selected}
            filtered={!!query.trim()}
            onView={(view) => controls.dispatch({ type: "view", view })}
            onSort={(sort) => controls.dispatch({ type: "sort", sort })}
            onSelect={(item) => controls.dispatch({ type: "select", path: item.path })}
            onActivate={(item) =>
              item.kind === "directory"
                ? controls.dispatch({ type: "enter", node: item })
                : controls.show(item.path)
            }
          />
        ) : (
          <StartView
            width={props.width}
            height={body.height}
            title={
              scan.kind === "failed"
                ? "Couldn't scan this folder"
                : scan.kind === "cancelled"
                  ? "Scan cancelled"
                  : "See what uses your storage"
            }
            message={
              scan.kind === "failed"
                ? scan.message
                : "Choose a folder, or scan one of these, to rank everything in it by the space it takes."
            }
            tone={scan.kind === "failed" ? "danger" : undefined}
            picks={picks}
            onChoose={choose}
            onPick={controls.scan}
          />
        )}
      </AppFrame>
      {state.choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="folder"
          appId={APP_ID}
          title="Choose a folder to scan"
          directory={lastRoot ?? (home || undefined)}
          onChoose={controls.scan}
          onCancel={() => controls.dispatch({ type: "choosing", open: false })}
        />
      ) : null}
    </Box>
  );
}

startMain(import.meta.url, () =>
  runApp(TITLE, APP_ID, (size, window) => (
    <DiskUsageApp {...size} window={window} initialPath={initialFile() || undefined} />
  )),
);
