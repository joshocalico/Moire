/**
 * Headless smoke — exercises Application/Window/widgets without a display.
 * Covers: basic widgets, Pressable, ScrollArea, List, Grid.
 */
import { createElement, useState } from "react";
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
} from "./index.js";

/* ---------- ScrollArea smoke ---------- */

function ScrollSmoke(): React.ReactNode {
  return createElement(
    ScrollArea,
    { width: 300, height: 120, contentHeight: 400, scrollbar: true },
    ...Array.from({ length: 10 }, (_, i) =>
      createElement(Label, {
        key: i,
        x: 8,
        y: i * 40,
        text: `Item ${i + 1}`,
        width: 280,
        height: 40,
      }),
    ),
  );
}

/* ---------- List smoke ---------- */

type SmokeItem = { title: string; subtitle: string };

function ListSmoke(): React.ReactNode {
  const [selected, setSelected] = useState(0);
  const items: SmokeItem[] = [
    { title: "Alpha", subtitle: "First item" },
    { title: "Beta", subtitle: "Second item" },
    { title: "Gamma", subtitle: "Third item" },
  ];
  return createElement(List<SmokeItem>, {
    width: 300,
    height: 120,
    items,
    itemHeight: 40,
    selectedIndex: selected,
    onSelect: setSelected,
    renderItem: (item, _i, sel) =>
      createElement(ListItem, {
        title: item.title,
        subtitle: item.subtitle,
        selected: sel,
        width: 300,
        height: 40,
        onPress: () => setSelected(_i),
      }),
  });
}

/* ---------- Grid smoke ---------- */

function GridSmoke(): React.ReactNode {
  const items = Array.from({ length: 9 }, (_, i) => `Cell ${i}`);
  return createElement(Grid<string>, {
    width: 300,
    height: 160,
    items,
    itemWidth: 80,
    itemHeight: 80,
    gap: 8,
    renderItem: (label, _i) =>
      createElement(GridItem, {
        width: 80,
        height: 80,
        label,
        onPress: () => {},
      }),
  });
}

/* ---------- Pressable smoke ---------- */

function PressableSmoke(): React.ReactNode {
  const [count, setCount] = useState(0);
  return createElement(
    Pressable,
    {
      width: 160,
      height: 40,
      onPress: () => setCount((c) => c + 1),
    },
    createElement(Label, {
      x: 8,
      y: 12,
      text: `Pressed: ${count}`,
      width: 144,
      height: 20,
    }),
  );
}

/* ---------- Main smoke app ---------- */

function SmokeApp(props: { onQuit: () => void }): React.ReactNode {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(false);
  return createElement(
    Column,
    { x: 0, y: 0, width: 420, height: 580, padding: 16, gap: 12 },
    createElement(Label, {
      text: "Moire UI smoke",
      fontSize: 20,
      fontWeight: "bold",
      height: 28,
      width: 388,
    }),
    createElement(Separator, { width: 388, height: 1 }),
    createElement(Toggle, {
      on,
      label: "Dark mode",
      onChange: setOn,
      width: 200,
      height: 28,
    }),
    createElement(Checkbox, {
      checked,
      label: "Enable notifications",
      onChange: setChecked,
      width: 280,
      height: 28,
    }),
    createElement(PressableSmoke),
    createElement(ScrollSmoke),
    createElement(ListSmoke),
    createElement(GridSmoke),
    createElement(Button, {
      width: 120,
      height: 36,
      label: "Quit",
      variant: "primary",
      onPress: props.onQuit,
    }),
  );
}

async function main() {
  process.env.MOIRE_UI_PLATFORM = "headless";
  const app = new Application({ platform: "headless" });
  const win = new Window({ title: "Smoke", width: 460, height: 600 });
  win.setContent(
    createElement(SmokeApp, {
      onQuit: () => app.quit(),
    }),
  );
  app.addWindow(win);
  // Auto-quit after a few frames so CI doesn't hang.
  setTimeout(() => app.quit(), 300);
  await app.run();
  console.log("[ui/smoke] ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
