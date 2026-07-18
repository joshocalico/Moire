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
} from "./index.js";
import { HeadlessPlatform } from "./platforms/headless/index.js";

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
