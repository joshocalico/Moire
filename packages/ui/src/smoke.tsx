/**
 * Headless smoke — exercises renderer contract, Application/Window, and core
 * widgets without a display.
 */
import assert from "node:assert/strict";
import React, { useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  SoftwareRenderer,
  collectHits,
  createShellRoot,
  renderShell,
  type RendererBackend,
  type SoftwareFrame,
} from "@moire/react-host";
import {
  Application,
  Window,
  Column,
  Label,
  Button,
  Checkbox,
  Toggle,
  Separator,
  Pressable,
  ScrollArea,
  List,
  ListItem,
  Grid,
  GridItem,
  TextField,
  PathBar,
  CollectionItem,
  ContextMenuTrigger,
  ContextMenu,
  OpenWithPicker,
  contextMenuSurfaceSize,
  type PlatformPopupOpts,
  type PlatformWindow,
} from "./index.js";
import { HeadlessPlatform } from "./platforms/headless/index.js";
import { notifyDragEnded } from "./widgets/dnd.js";

const NO_MODIFIERS = {
  shift: false,
  ctrl: false,
  alt: false,
  meta: false,
} as const;

function rendererSmoke(): void {
  const root = createShellRoot();
  renderShell(
    root,
    <Group x={0} y={0} width={8} height={8}>
      <Rect
        x={1}
        y={1}
        width={3}
        height={3}
        fill={0xff123456}
        onPress={() => {}}
      />
      <Rect
        x={1}
        y={4}
        width={6}
        height={4}
        radius={2}
        fill={0xff224466}
        stroke={0xff88aacc}
        strokeWidth={1}
      />
      <Rect x={7} y={0} width={1} height={1} fill={0x804080c0} />
    </Group>,
  );

  const renderer: RendererBackend<SoftwareFrame> = new SoftwareRenderer();
  const frame = renderer.render(root.container, { width: 8, height: 8 });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(renderer.id, "software");
  assert.equal(frame.width, 8);
  assert.equal(frame.height, 8);
  assert.equal(words[1 * 8 + 1], 0xff123456);
  assert.equal(words[4 * 8 + 1], 0x00000000);
  assert.equal(words[4 * 8 + 4], 0xff88aacc);
  assert.equal(words[6 * 8 + 4], 0xff224466);
  assert.equal(
    words[7],
    0x80204060,
    "translucent rect on a clear frame must preserve premultiplied alpha",
  );
  assert.equal(collectHits(root.container).length, 1);
}

async function textFieldInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Text input smoke", width: 260, height: 100 });
  let first = "Alpha";
  let second = "Beta";
  let focused: "first" | "second" | null = null;
  let submitted = "";
  win.setContent(() => (
    <Group x={0} y={0} width={260} height={100}>
      <TextField
        x={10}
        y={10}
        width={240}
        value={first}
        autoFocus
        onChange={(value) => {
          first = value;
        }}
        onSubmit={(value) => {
          submitted = value;
        }}
        onFocusChange={(next) => {
          if (next) focused = "first";
          else if (focused === "first") focused = null;
        }}
      />
      <TextField
        x={10}
        y={54}
        width={240}
        value={second}
        onChange={(value) => {
          second = value;
        }}
        onFocusChange={(next) => {
          if (next) focused = "second";
          else if (focused === "second") focused = null;
        }}
      />
    </Group>
  ));
  win.mount(backend);
  await Promise.resolve();
  win.tick();

  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow, "headless platform should contain the mounted window");
  assert.equal(focused, "first", "autoFocus should claim initial keyboard focus");
  const pointerBase = { x: 11, y: 26, button: "left" as const, timeMs: 1 };
  platformWindow.injectPointer({ ...pointerBase, type: "down" });
  platformWindow.injectPointer({ ...pointerBase, type: "up", timeMs: 2 });
  assert.equal(focused, "first");

  platformWindow.injectKey({
    type: "down",
    code: 30,
    key: "a",
    text: "a",
    modifiers: NO_MODIFIERS,
    timeMs: 3,
  });
  assert.equal(first, "aAlpha", "pointer press should place the insertion cursor");
  platformWindow.injectKey({
    type: "down",
    code: 14,
    key: "Backspace",
    modifiers: NO_MODIFIERS,
    timeMs: 4,
  });
  assert.equal(first, "Alpha");
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    text: "\n",
    modifiers: NO_MODIFIERS,
    timeMs: 5,
  });
  assert.equal(submitted, "Alpha");

  platformWindow.injectKey({
    type: "down",
    code: 15,
    key: "Tab",
    text: "\t",
    modifiers: NO_MODIFIERS,
    timeMs: 6,
  });
  assert.equal(focused, "second");
  platformWindow.injectKey({
    type: "down",
    code: 15,
    key: "Tab",
    text: "\t",
    modifiers: { ...NO_MODIFIERS, shift: true },
    timeMs: 7,
  });
  assert.equal(focused, "first");

  win.destroy();
  backend.disconnect();
}

async function pathBarInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Path bar smoke", width: 280, height: 60 });
  let committed = "";
  let navigated = "";
  win.setContent(
    <PathBar
      x={10}
      y={10}
      width={260}
      value="/Alpha"
      segments={[
        { id: "/", label: "/" },
        { id: "/Alpha", label: "Alpha" },
      ]}
      onNavigate={(id) => {
        navigated = id;
      }}
      onCommit={(value) => {
        committed = value;
        return undefined;
      }}
    />,
  );
  win.mount(backend);
  await Promise.resolve();
  win.tick();

  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);
  platformWindow.injectPointer({
    type: "down",
    x: 230,
    y: 26,
    button: "left",
    timeMs: 1,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 230,
    y: 26,
    button: "left",
    timeMs: 2,
  });
  platformWindow.injectKey({
    type: "down",
    code: 45,
    key: "x",
    text: "x",
    modifiers: NO_MODIFIERS,
    timeMs: 3,
  });
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    modifiers: NO_MODIFIERS,
    timeMs: 4,
  });
  assert.equal(committed, "/Alphax", "Edit should autofocus and commit typed input");

  platformWindow.injectPointer({
    type: "down",
    x: 16,
    y: 26,
    button: "left",
    timeMs: 5,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 16,
    y: 26,
    button: "left",
    timeMs: 6,
  });
  assert.equal(navigated, "/", "Breadcrumb segment should navigate on activation");

  win.destroy();
  backend.disconnect();
}

async function openWithPickerInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Open With smoke", width: 620, height: 520 });
  let selected = "editor.desktop";
  let opened = "";
  let dismissed = false;

  function Picker(): ReactNode {
    const [selectedId, setSelectedId] = useState(selected);
    return (
      <OpenWithPicker
        viewportWidth={620}
        viewportHeight={520}
        fileName="Notes.txt"
        mimeType="text/plain"
        choices={[
          {
            id: "editor.desktop",
            name: "Editor",
            description: "Edit plain text",
            recommended: true,
            isDefault: true,
          },
          {
            id: "writer.desktop",
            name: "Writer",
            description: "Create rich documents",
            recommended: true,
          },
          {
            id: "terminal.desktop",
            name: "Terminal",
            description: "Run a command-line application",
            recommended: false,
          },
        ]}
        selectedId={selectedId}
        onSelect={(id) => {
          selected = id;
          setSelectedId(id);
        }}
        onOpen={(id) => {
          opened = id;
        }}
        onMakeDefault={() => {}}
        onDismiss={() => {
          dismissed = true;
        }}
      />
    );
  }

  win.setContent(<Picker />);
  win.mount(backend);
  await Promise.resolve();
  win.tick();
  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);

  platformWindow.injectKey({
    type: "down",
    code: 108,
    key: "ArrowDown",
    modifiers: NO_MODIFIERS,
    timeMs: 1,
  });
  assert.equal(selected, "writer.desktop", "ArrowDown should move picker selection");
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    text: "\n",
    modifiers: NO_MODIFIERS,
    timeMs: 2,
  });
  assert.equal(opened, "writer.desktop", "Enter should open the selected app");
  platformWindow.injectKey({
    type: "down",
    code: 1,
    key: "Escape",
    modifiers: NO_MODIFIERS,
    timeMs: 3,
  });
  assert.equal(dismissed, true, "Escape should dismiss the picker");

  win.destroy();
  backend.disconnect();
}

async function interactionOwnershipSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Interaction smoke", width: 180, height: 100 });
  let itemContexts = 0;
  let backgroundContexts = 0;
  let selections = 0;
  let opens = 0;
  win.setContent(
    <ContextMenuTrigger
      width={180}
      height={100}
      onContextMenu={() => {
        backgroundContexts++;
      }}
    >
      <CollectionItem
        x={10}
        y={10}
        width={70}
        height={48}
        dragSource={{
          mimeTypes: ["text/plain"],
          getPayload: () => "Alpha",
        }}
        onPress={() => {
          selections++;
        }}
        onDoublePress={() => {
          opens++;
        }}
        onContextMenu={() => {
          itemContexts++;
        }}
      >
        <Rect x={0} y={0} width={70} height={48} fill={0xff223344} />
      </CollectionItem>
    </ContextMenuTrigger>,
  );
  win.mount(backend);
  await Promise.resolve();
  win.tick();
  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);

  platformWindow.injectPointer({
    type: "down",
    x: 20,
    y: 20,
    button: "right",
    timeMs: 1,
  });
  platformWindow.injectPointer({
    type: "down",
    x: 140,
    y: 70,
    button: "right",
    timeMs: 2,
  });
  assert.equal(itemContexts, 1, "item context should win over its background");
  assert.equal(backgroundContexts, 1, "empty space should retain its own context");

  platformWindow.injectPointer({
    type: "down",
    x: 20,
    y: 20,
    button: "left",
    timeMs: 3,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 20,
    y: 20,
    button: "left",
    timeMs: 4,
  });
  assert.equal(selections, 1);
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    modifiers: NO_MODIFIERS,
    timeMs: 5,
  });
  assert.equal(opens, 1, "focused collection item should activate with Enter");
  platformWindow.injectKey({
    type: "down",
    code: 68,
    key: "F10",
    modifiers: { ...NO_MODIFIERS, shift: true },
    timeMs: 6,
  });
  assert.equal(itemContexts, 2, "Shift+F10 should open the focused item menu");
  platformWindow.injectKey({
    type: "repeat",
    code: 68,
    key: "F10",
    modifiers: { ...NO_MODIFIERS, shift: true },
    timeMs: 7,
  });
  assert.equal(itemContexts, 2, "held context-menu keys must not reopen menus");

  platformWindow.injectPointer({
    type: "down",
    x: 20,
    y: 20,
    button: "left",
    timeMs: 8,
  });
  platformWindow.injectPointer({
    type: "move",
    x: 27,
    y: 20,
    button: "left",
    timeMs: 9,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 27,
    y: 20,
    button: "left",
    timeMs: 10,
  });
  assert.equal(selections, 1, "crossing the drag threshold must suppress click");

  notifyDragEnded();
  win.destroy();
  backend.disconnect();
}

class PopupHeadlessPlatform extends HeadlessPlatform {
  createPopup(opts: PlatformPopupOpts): PlatformWindow {
    return this.createWindow({
      title: "Popup",
      appId: "smoke.popup",
      width: opts.width,
      height: opts.height,
      resizable: false,
    });
  }
}

async function nativePopupLifecycleSmoke(): Promise<void> {
  const backend = new PopupHeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Popup smoke", width: 240, height: 160 });
  win.setContent(<Rect x={0} y={0} width={240} height={160} fill={0xff102030} />);
  win.mount(backend);
  await Promise.resolve();
  win.tick();

  const actions = [
    { id: "open", label: "Open", onPress: () => {} },
    {
      id: "delete",
      label: "Delete",
      separatorBefore: true,
      onPress: () => {},
    },
  ];
  const size = contextMenuSurfaceSize(actions, "Example");
  let closed = 0;
  const popup = win.showPopup({
    x: 225,
    y: 145,
    width: size.width,
    height: size.height,
    content: (surface) => (
      <ContextMenu
        viewportWidth={surface.width}
        viewportHeight={surface.height}
        x={0}
        y={0}
        title="Example"
        actions={actions}
        surface
        onDismiss={() => {}}
      />
    ),
    onClose: () => {
      closed++;
    },
  });
  assert.ok(popup, "popup-capable platform should create a child surface");
  await Promise.resolve();
  win.tick();

  const popupWindow = backend.getWindows()[1];
  assert.ok(popupWindow, "native popup should have its own platform window");
  assert.equal(popupWindow.lastFrame?.byteLength, size.width * size.height * 4);
  popupWindow.requestClose();
  assert.equal(closed, 1, "popup_done should clean up and notify its owner once");

  win.destroy();
  backend.disconnect();
}

function ScrollSmoke(): ReactNode {
  return (
    <ScrollArea width={300} height={120} contentHeight={400} scrollbar>
      {Array.from({ length: 10 }, (_, i) => (
        <Label
          key={i}
          x={8}
          y={i * 40}
          text={`Item ${i + 1}`}
          width={280}
          height={40}
        />
      ))}
    </ScrollArea>
  );
}

type SmokeItem = { title: string; subtitle: string };

function ListSmoke(): ReactNode {
  const [selected, setSelected] = useState(0);
  const items: SmokeItem[] = [
    { title: "Alpha", subtitle: "First item" },
    { title: "Beta", subtitle: "Second item" },
    { title: "Gamma", subtitle: "Third item" },
  ];
  return (
    <List<SmokeItem>
      width={300}
      height={120}
      items={items}
      itemHeight={40}
      selectedIndex={selected}
      onSelect={setSelected}
      renderItem={(item, index, selectedItem) => (
        <ListItem
          title={item.title}
          subtitle={item.subtitle}
          selected={selectedItem}
          width={300}
          height={40}
          onPress={() => setSelected(index)}
        />
      )}
    />
  );
}

function GridSmoke(): ReactNode {
  const items = Array.from({ length: 9 }, (_, i) => `Cell ${i}`);
  return (
    <Grid<string>
      width={300}
      height={160}
      items={items}
      itemWidth={80}
      itemHeight={80}
      gap={8}
      renderItem={(label) => (
        <GridItem
          width={80}
          height={80}
          label={label}
          onPress={() => {}}
        />
      )}
    />
  );
}

function PressableSmoke(): ReactNode {
  const [count, setCount] = useState(0);
  return (
    <Pressable
      width={160}
      height={40}
      onPress={() => setCount((value) => value + 1)}
    >
      <Label
        x={8}
        y={12}
        text={`Pressed: ${count}`}
        width={144}
        height={20}
      />
    </Pressable>
  );
}

function SmokeApp(props: { onQuit: () => void }): ReactNode {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  return (
    <Column x={0} y={0} width={420} height={580} padding={16} gap={12}>
      <Label
        text="Moire UI smoke"
        fontSize={20}
        fontWeight="bold"
        height={28}
        width={388}
      />
      <Separator width={388} height={1} />
      <Toggle
        on={on}
        label="Dark mode"
        onChange={setOn}
        width={200}
        height={28}
      />
      <Checkbox
        checked={checked}
        label="Enable notifications"
        onChange={setChecked}
        width={280}
        height={28}
      />
      <PressableSmoke />
      <ScrollSmoke />
      <ListSmoke />
      <GridSmoke />
      <Button
        width={120}
        height={36}
        label="Quit"
        variant="primary"
        onPress={props.onQuit}
      />
    </Column>
  );
}

async function main() {
  process.env.MOIRE_UI_PLATFORM = "headless";
  rendererSmoke();
  await textFieldInteractionSmoke();
  await pathBarInteractionSmoke();
  await openWithPickerInteractionSmoke();
  await interactionOwnershipSmoke();
  await nativePopupLifecycleSmoke();
  const app = new Application({ platform: "headless" });
  const win = new Window({ title: "Smoke", width: 460, height: 600 });
  win.setContent(<SmokeApp onQuit={() => app.quit()} />);
  app.addWindow(win);
  setTimeout(() => app.quit(), 300);
  await app.run();
  console.log("[ui/smoke] ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
