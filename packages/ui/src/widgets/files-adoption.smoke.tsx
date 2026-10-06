/* eslint-disable import/no-relative-parent-imports -- Exercise shared widgets through the actual Window dispatcher. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import {
  Window,
  installUiFonts,
  setUiScaleFactor,
  Table,
  Grid,
  CollectionItem,
  Tabs,
  setDndBridge,
} from "../index";
import { notifyDragEnded } from "./dnd";
import { HeadlessPlatform } from "../platforms/headless/index";

await installUiFonts();
for (const scale of [1, 1.5]) {
  setUiScaleFactor(scale);
  const backend = new HeadlessPlatform();
  await backend.connect();
  const width = 600 * scale,
    height = 360 * scale,
    headerHeight = 36 * scale,
    rowHeight = 44 * scale;
  const window = new Window({ title: "Shared Files collections", width, height, decorated: false });
  const rows = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    name: `File ${index}`,
  }));
  let payload: unknown = null,
    context = "",
    visible = new Set<string>(),
    scroll = 0;
  const selected = new Set(["0", "1"]);
  setDndBridge({
    startDrag: (value) => {
      payload = value;
    },
  });
  function Collection() {
    const [focus, setFocus] = useState("0");
    const [offset, setOffset] = useState(0);
    return (
      <Table
        width={width}
        height={height}
        headerHeight={headerHeight}
        rowHeight={rowHeight}
        rows={rows}
        getRowKey={(row) => row.id}
        selectedKeys={selected}
        focusedKey={focus}
        scrollY={offset}
        onScroll={(value) => {
          scroll = value;
          setOffset(value);
        }}
        columns={[
          {
            id: "name",
            label: "Name",
            renderCell: (row) => {
              visible.add(row.id);
              return null;
            },
          },
        ]}
        getRowProps={(row) => ({
          focusId: `file:${row.id}`,
          autoFocus: focus === row.id,
          onFocusChange: (value) => {
            if (value) setFocus(row.id);
          },
          onContextMenu: () => {
            context = selected.has(row.id) ? [...selected].join(",") : row.id;
          },
          onKeyDown: (event) => {
            if (event.key === "End") {
              setFocus("999");
              return true;
            }
            if (event.key === "ArrowUp") {
              setFocus(String(Math.max(0, Number(row.id) - 1)));
              return true;
            }
          },
          dragSource: {
            mimeTypes: ["text/uri-list"],
            getPayload: () => [...selected].map((id) => `file:///fixture/${id}`).join("\n"),
          },
          dropData: row.id === "0" ? "destination" : undefined,
        })}
      />
    );
  }
  window.setContent(<Collection />);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const key = (code: number, key: string) => {
    native.injectKey({
      type: "down",
      code,
      key,
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
      timeMs: 0,
    });
    native.injectKey({
      type: "up",
      code,
      key,
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
      timeMs: 0,
    });
    window.tick();
  };
  native.injectPointer({
    type: "down",
    button: "right",
    x: 20 * scale,
    y: headerHeight + rowHeight / 2,
    timeMs: 1,
  });
  native.injectPointer({
    type: "up",
    button: "right",
    x: 20 * scale,
    y: headerHeight + rowHeight / 2,
    timeMs: 2,
  });
  assert.equal(
    context,
    "0,1",
    "external multiselection remains attached to the semantic context target",
  );
  native.injectPointer({
    type: "down",
    button: "left",
    x: 20 * scale,
    y: headerHeight + rowHeight / 2,
    timeMs: 3,
  });
  native.injectPointer({ type: "move", x: 40 * scale, y: headerHeight + rowHeight / 2, timeMs: 4 });
  assert.equal(
    payload,
    "file:///fixture/0\nfile:///fixture/1",
    "table delegates the real grouped drag payload",
  );
  notifyDragEnded();
  visible = new Set();
  key(107, "End");
  window.tick();
  assert.ok(scroll > 0);
  assert.ok(visible.has("999"));
  assert.ok(visible.size < 30, "large collections stay virtualized");
  key(103, "ArrowUp");
  window.tick();
  assert.ok(visible.has("998"), "the revealed row receives subsequent keys");
  window.destroy();
  backend.disconnect();
  setDndBridge(null);

  // Restored offsets outside a resized or filtered grid must still render real cells.
  const gridBackend = new HeadlessPlatform();
  await gridBackend.connect();
  const gridWindow = new Window({ title: "Grid bounds", width, height, decorated: false });
  let gridVisible = new Set<string>();
  gridWindow.setContent(
    <Grid
      width={width}
      height={height}
      items={rows.slice(0, 10).reverse()}
      itemWidth={100 * scale}
      itemHeight={100 * scale}
      getKey={(row) => row.id}
      scrollY={1_000_000}
      renderItem={(row) => {
        gridVisible.add(row.id);
        return <CollectionItem width={100 * scale} height={100 * scale} focusId={row.id} />;
      }}
    />,
  );
  gridWindow.mount(gridBackend);
  await Promise.resolve();
  gridWindow.tick();
  assert.equal(gridVisible.size, 10, "clamped grid restoration retains every keyed cell");
  gridWindow.destroy();
  gridBackend.disconnect();

  const tabBackend = new HeadlessPlatform();
  await tabBackend.connect();
  const tabWindow = new Window({
    title: "Folder tabs",
    width: 260 * scale,
    height: 44 * scale,
    decorated: false,
  });
  let active = 0;
  function FolderTabs() {
    const [index, setIndex] = useState(0);
    return (
      <Tabs
        width={260 * scale}
        height={44 * scale}
        variant="titlebar"
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Disabled", disabled: true },
          { id: "c", label: "Gamma" },
        ]}
        active={index}
        onChange={(next) => {
          active = next;
          setIndex(next);
        }}
      />
    );
  }
  tabWindow.setContent(<FolderTabs />);
  tabWindow.mount(tabBackend);
  await Promise.resolve();
  tabWindow.tick();
  const tabNative = tabBackend.getWindows()[0]!;
  const tabKey = (code: number, key: string) => {
    tabNative.injectKey({
      type: "down",
      code,
      key,
      modifiers: { ctrl: false, alt: false, shift: false, meta: false },
      timeMs: 0,
    });
    tabWindow.tick();
  };
  tabKey(15, "Tab");
  tabKey(106, "ArrowRight");
  assert.equal(active, 2, "titlebar arrows skip disabled and overflowed tabs");
  tabKey(105, "ArrowLeft");
  assert.equal(active, 0, "keyboard focus follows the changed titlebar tab");
  tabWindow.destroy();
  tabBackend.disconnect();
}
setUiScaleFactor(1);
console.log(
  "Shared Files widgets: scaled Table context/group drag/virtual focus, Grid restoration, and titlebar tab keyboard passed",
);
