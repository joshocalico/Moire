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
  IconButton,
  WidgetThemeProvider,
  createWidgetTheme,
  Checkbox,
  Toggle,
  Slider,
  ProgressBar,
  Separator,
  Pressable,
  ScrollArea,
  List,
  ListItem,
  Grid,
  GridItem,
  TextField,
  SearchField,
  Tabs,
  Menu,
  MenuItem,
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

function buttonRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const medium = theme.recipes.button.primary.medium;
  const customFill = 0xff633ad6;
  const customTheme = {
    ...theme,
    name: "button-recipe-smoke",
    recipes: {
      ...theme.recipes,
      button: {
        ...theme.recipes.button,
        primary: {
          ...theme.recipes.button.primary,
          medium: {
            ...medium,
            root: {
              ...medium.root,
              base: {
                ...medium.root.base,
                fill: customFill,
                radius: 0,
                stroke: undefined,
                strokeWidth: 0,
              },
            },
            rim: undefined,
          },
        },
      },
    },
  };
  let receivedSlotSize = 0;
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <Button
        x={2}
        y={2}
        width={96}
        label="Recipe"
        variant="primary"
        leadingIcon={(style) => {
          receivedSlotSize = style.size;
          return (
            <Rect
              x={0}
              y={0}
              width={style.size}
              height={style.size}
              radius={2}
              fill={style.color}
            />
          );
        }}
      />
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 102,
    height: 42,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(
    words[2 * frame.width + 2],
    customFill,
    "Button should take its fill and square geometry from a subtree recipe",
  );
  assert.equal(
    words[37 * frame.width + 4],
    0,
    "Button without an explicit height should use the medium recipe height",
  );
  assert.equal(
    receivedSlotSize,
    medium.leadingIcon.base.size,
    "Button artwork slots should receive the recipe's semantic icon style",
  );
}

function textFieldRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const medium = theme.recipes.textField.medium;
  const fill = 0xff342a52;
  const invalidStroke = 0xffff6b8a;
  const customTheme = {
    ...theme,
    name: "text-field-recipe-smoke",
    recipes: {
      ...theme.recipes,
      textField: {
        ...theme.recipes.textField,
        medium: {
          ...medium,
          root: {
            ...medium.root,
            base: { ...medium.root.base, fill, radius: 0 },
            states: {
              ...medium.root.states,
              invalid: { stroke: invalidStroke },
            },
          },
          metrics: { ...medium.metrics, height: 38 },
        },
      },
    },
  };
  let leadingSize = 0;
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <TextField
        x={2}
        y={2}
        width={116}
        value="Recipe"
        focused
        invalid
        leading={(style) => {
          leadingSize = style.size;
          return <Rect width={style.size} height={style.size} fill={style.color} />;
        }}
      />
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 122,
    height: 44,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(words[4 * frame.width + 4], fill);
  assert.equal(
    words[2 * frame.width + 12],
    invalidStroke,
    "TextField should combine focus geometry with the later invalid color state",
  );
  assert.equal(
    words[41 * frame.width + 4],
    0,
    "TextField should take its implicit height from the selected recipe",
  );
  assert.equal(leadingSize, medium.leadingIcon.base.size);
}

function tabsRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const medium = theme.recipes.tabs.medium;
  const rootFill = 0xff2d2946;
  const indicatorFill = 0xffffb347;
  const customTheme = {
    ...theme,
    name: "tabs-recipe-smoke",
    recipes: {
      ...theme.recipes,
      tabs: {
        ...theme.recipes.tabs,
        medium: {
          ...medium,
          root: { ...medium.root, fill: rootFill, radius: 0 },
          indicator: { ...medium.indicator, fill: indicatorFill, radius: 0 },
          metrics: {
            ...medium.metrics,
            height: 38,
            indicatorHeight: 3,
          },
        },
      },
    },
  };
  let slotSize = 0;
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <Tabs
        x={2}
        y={2}
        width={120}
        tabs={[
          {
            id: "one",
            label: "One",
            leading: (style) => {
              slotSize = style.size;
              return <Rect width={style.size} height={style.size} fill={style.color} />;
            },
          },
          { id: "two", label: "Two" },
        ]}
        active={0}
      />
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 126,
    height: 44,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(words[4 * frame.width + 4], rootFill);
  assert.equal(words[38 * frame.width + 20], indicatorFill);
  assert.equal(words[41 * frame.width + 4], 0);
  assert.equal(slotSize, medium.icon.base.size);
}

function menuRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const medium = theme.recipes.menu.medium;
  const surfaceFill = 0xff28233d;
  const selectedFill = 0xff5a3d78;
  const customTheme = {
    ...theme,
    name: "menu-recipe-smoke",
    recipes: {
      ...theme.recipes,
      menu: {
        ...theme.recipes.menu,
        medium: {
          ...medium,
          surface: { ...medium.surface, fill: surfaceFill, radius: 0 },
          item: {
            ...medium.item,
            states: {
              ...medium.item.states,
              selected: { fill: selectedFill },
            },
          },
        },
      },
    },
  };
  let slotSize = 0;
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <Menu
        width={140}
        items={[
          {
            id: "selected",
            label: "Selected",
            selected: true,
            leading: (style) => {
              slotSize = style.size;
              return <Rect width={style.size} height={style.size} fill={style.color} />;
            },
          },
          {
            id: "danger",
            label: "Remove",
            danger: true,
            separatorBefore: true,
          },
        ]}
      />
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 144,
    height: 100,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(words[2 * frame.width + 2], surfaceFill);
  assert.equal(words[12 * frame.width + 8], selectedFill);
  assert.equal(slotSize, medium.leadingIcon.base.size);
}

function formControlRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const checkbox = theme.recipes.checkbox.medium;
  const toggle = theme.recipes.toggle.medium;
  const slider = theme.recipes.slider.medium;
  const progress = theme.recipes.progressBar.medium;
  const checkboxFill = 0xff6e4aa1;
  const toggleFill = 0xffd3783f;
  const sliderFill = 0xff41a872;
  const progressFill = 0xffd34f68;
  const customTheme = {
    ...theme,
    name: "form-control-recipe-smoke",
    recipes: {
      ...theme.recipes,
      checkbox: {
        ...theme.recipes.checkbox,
        medium: {
          ...checkbox,
          control: {
            ...checkbox.control,
            states: {
              ...checkbox.control.states,
              selected: { fill: checkboxFill, stroke: checkboxFill },
            },
          },
        },
      },
      toggle: {
        ...theme.recipes.toggle,
        medium: {
          ...toggle,
          track: {
            ...toggle.track,
            states: {
              ...toggle.track.states,
              selected: { fill: toggleFill, stroke: toggleFill },
            },
          },
        },
      },
      slider: {
        ...theme.recipes.slider,
        medium: {
          ...slider,
          fill: {
            ...slider.fill,
            base: { ...slider.fill.base, fill: sliderFill },
          },
        },
      },
      progressBar: {
        ...theme.recipes.progressBar,
        medium: {
          ...progress,
          fill: { ...progress.fill, fill: progressFill },
        },
      },
    },
  };
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <Group width={120} height={100}>
        <Checkbox x={2} y={2} checked />
        <Toggle x={42} y={2} on />
        <Slider x={2} y={42} width={100} value={0.5} />
        <ProgressBar x={2} y={82} width={100} value={0.5} />
      </Group>
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 120,
    height: 100,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(words[10 * frame.width + 3], checkboxFill);
  assert.equal(words[10 * frame.width + 43], toggleFill);
  assert.equal(words[56 * frame.width + 16], sliderFill);
  assert.equal(words[84 * frame.width + 16], progressFill);
}

function collectionRecipeSmoke(): void {
  const theme = createWidgetTheme();
  const icon = theme.recipes.iconButton.standard.medium;
  const list = theme.recipes.listItem.medium;
  const grid = theme.recipes.gridItem.medium;
  const iconFill = 0xff315f8f;
  const selectionFill = 0xff56356f;
  const indicatorFill = 0xffffc857;
  const gridSelectionFill = 0xff8a4b2f;
  const customTheme = {
    ...theme,
    name: "collection-recipe-smoke",
    recipes: {
      ...theme.recipes,
      iconButton: {
        ...theme.recipes.iconButton,
        standard: {
          ...theme.recipes.iconButton.standard,
          medium: {
            ...icon,
            root: {
              ...icon.root,
              base: {
                ...icon.root.base,
                fill: iconFill,
                radius: 0,
                stroke: undefined,
                strokeWidth: 0,
              },
            },
          },
        },
      },
      listItem: {
        ...theme.recipes.listItem,
        medium: {
          ...list,
          selection: {
            ...list.selection,
            fill: selectionFill,
            radius: 0,
          },
          indicator: { fill: indicatorFill, width: 5 },
        },
      },
      gridItem: {
        ...theme.recipes.gridItem,
        medium: {
          ...grid,
          selection: {
            ...grid.selection,
            fill: gridSelectionFill,
            radius: 0,
            stroke: undefined,
            strokeWidth: 0,
          },
        },
      },
    },
  };
  let iconSlotSize = 0;
  const root = createShellRoot();
  renderShell(
    root,
    <WidgetThemeProvider theme={customTheme}>
      <Group x={0} y={0} width={128} height={164}>
        <IconButton
          x={2}
          y={2}
          icon={(style) => {
            iconSlotSize = style.size;
            return (
              <Rect
                width={style.size}
                height={style.size}
                radius={3}
                fill={style.color}
              />
            );
          }}
        />
        <ListItem
          x={2}
          y={42}
          width={124}
          title="Recipe row"
          selected
          interactive={false}
        />
        <GridItem
          x={2}
          y={86}
          width={76}
          height={74}
          label="Grid recipe"
          selected
          interactive={false}
        />
      </Group>
    </WidgetThemeProvider>,
  );
  const frame = new SoftwareRenderer().render(root.container, {
    width: 128,
    height: 164,
  });
  const words = new Uint32Array(frame.pixels.buffer);
  assert.equal(words[2 * frame.width + 2], iconFill);
  assert.equal(words[52 * frame.width + 2], indicatorFill);
  assert.equal(words[52 * frame.width + 8], selectionFill);
  assert.equal(words[90 * frame.width + 4], gridSelectionFill);
  assert.equal(iconSlotSize, icon.icon.base.size);
}

async function collectionFocusRecipeSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const theme = createWidgetTheme();
  const outline = theme.recipes.collectionItem.outline;
  const focusColor = 0xffff5f87;
  const customTheme = {
    ...theme,
    recipes: {
      ...theme.recipes,
      collectionItem: {
        outline: {
          ...outline,
          base: { ...outline.base, radius: 0 },
          states: {
            ...outline.states,
            focused: { stroke: focusColor, strokeWidth: 2 },
          },
        },
      },
    },
  };
  const win = new Window({ title: "Collection recipe", width: 80, height: 54 });
  win.setContent(
    <WidgetThemeProvider theme={customTheme}>
      <CollectionItem x={10} y={10} width={40} height={30}>
        <Rect width={40} height={30} fill={0xff223344} />
      </CollectionItem>
    </WidgetThemeProvider>,
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
    button: "left",
    timeMs: 1,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 20,
    y: 20,
    button: "left",
    timeMs: 2,
  });
  await Promise.resolve();
  win.tick();
  assert.ok(platformWindow.lastFrame);
  const words = new Uint32Array(platformWindow.lastFrame.buffer);
  assert.equal(
    words[11 * 80 + 11],
    focusColor,
    "CollectionItem focus outline should resolve through its subtree recipe",
  );
  win.destroy();
  backend.disconnect();
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

async function searchFieldInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Search field smoke", width: 220, height: 60 });
  let query = "Needle";
  let cleared = 0;
  win.setContent(() => (
    <SearchField
      x={10}
      y={10}
      width={200}
      value={query}
      onChange={(value) => {
        query = value;
      }}
      onClear={() => {
        cleared++;
      }}
    />
  ));
  win.mount(backend);
  await Promise.resolve();
  win.tick();

  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);
  platformWindow.injectPointer({
    type: "down",
    x: 192,
    y: 26,
    button: "left",
    timeMs: 1,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 192,
    y: 26,
    button: "left",
    timeMs: 2,
  });
  assert.equal(query, "", "SearchField clear affordance should clear its value");
  assert.equal(cleared, 1);

  win.destroy();
  backend.disconnect();
}

async function formControlInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Form controls smoke", width: 240, height: 150 });
  let checked = false;
  let toggled = false;
  let sliderValue = 0.5;

  function Harness(): ReactNode {
    const [checkboxValue, setCheckboxValue] = useState(false);
    const [toggleValue, setToggleValue] = useState(false);
    const [rangeValue, setRangeValue] = useState(0.5);
    return (
      <Group width={240} height={150}>
        <Checkbox
          x={10}
          y={10}
          checked={checkboxValue}
          label="Checkbox"
          autoFocus
          onChange={(value) => {
            checked = value;
            setCheckboxValue(value);
          }}
        />
        <Toggle
          x={10}
          y={52}
          on={toggleValue}
          label="Toggle"
          onChange={(value) => {
            toggled = value;
            setToggleValue(value);
          }}
        />
        <Slider
          x={10}
          y={100}
          width={200}
          value={rangeValue}
          step={0.1}
          onChange={(value) => {
            sliderValue = value;
            setRangeValue(value);
          }}
        />
      </Group>
    );
  }

  win.setContent(<Harness />);
  win.mount(backend);
  await Promise.resolve();
  win.tick();
  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);

  platformWindow.injectKey({
    type: "down",
    code: 57,
    key: " ",
    text: " ",
    modifiers: NO_MODIFIERS,
    timeMs: 1,
  });
  assert.equal(checked, true, "Checkbox should toggle from the keyboard");
  platformWindow.injectKey({
    type: "down",
    code: 15,
    key: "Tab",
    text: "\t",
    modifiers: NO_MODIFIERS,
    timeMs: 2,
  });
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    modifiers: NO_MODIFIERS,
    timeMs: 3,
  });
  assert.equal(toggled, true, "Toggle should participate in focus traversal");
  platformWindow.injectKey({
    type: "down",
    code: 15,
    key: "Tab",
    text: "\t",
    modifiers: NO_MODIFIERS,
    timeMs: 4,
  });
  platformWindow.injectKey({
    type: "down",
    code: 106,
    key: "ArrowRight",
    modifiers: NO_MODIFIERS,
    timeMs: 5,
  });
  assert.equal(sliderValue, 0.6, "Slider should honor its keyboard step");

  platformWindow.injectPointer({
    type: "down",
    x: 30,
    y: 114,
    button: "left",
    timeMs: 6,
  });
  platformWindow.injectPointer({
    type: "move",
    x: 190,
    y: 114,
    button: "left",
    timeMs: 7,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 190,
    y: 114,
    button: "left",
    timeMs: 8,
  });
  assert.ok(sliderValue >= 0.9, "Slider should update throughout a captured drag");

  win.destroy();
  backend.disconnect();
}

async function menuItemInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Menu item smoke", width: 200, height: 60 });
  let presses = 0;
  win.setContent(
    <MenuItem
      x={10}
      y={10}
      width={180}
      label="Keyboard action"
      autoFocus
      onPress={() => {
        presses++;
      }}
    />,
  );
  win.mount(backend);
  await Promise.resolve();
  win.tick();

  const platformWindow = backend.getWindows()[0];
  assert.ok(platformWindow);
  platformWindow.injectKey({
    type: "down",
    code: 28,
    key: "Enter",
    modifiers: NO_MODIFIERS,
    timeMs: 1,
  });
  assert.equal(presses, 1, "MenuItem should expose keyboard activation");

  win.destroy();
  backend.disconnect();
}

async function tabsInteractionSmoke(): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const win = new Window({ title: "Tabs smoke", width: 240, height: 60 });
  let active = 0;
  win.setContent(
    <Tabs
      x={10}
      y={10}
      width={220}
      tabs={[
        { id: "first", label: "First" },
        { id: "disabled", label: "Disabled", disabled: true },
        { id: "third", label: "Third" },
      ]}
      active={active}
      onChange={(index) => {
        active = index;
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
    x: 46,
    y: 25,
    button: "left",
    timeMs: 1,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 46,
    y: 25,
    button: "left",
    timeMs: 2,
  });
  assert.equal(active, 0);
  platformWindow.injectKey({
    type: "down",
    code: 106,
    key: "ArrowRight",
    modifiers: NO_MODIFIERS,
    timeMs: 3,
  });
  assert.equal(active, 2, "Tabs arrow navigation should skip disabled items");

  platformWindow.injectPointer({
    type: "down",
    x: 120,
    y: 25,
    button: "left",
    timeMs: 4,
  });
  platformWindow.injectPointer({
    type: "up",
    x: 120,
    y: 25,
    button: "left",
    timeMs: 5,
  });
  assert.equal(active, 2, "Disabled tabs should not activate");

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
  const win = new Window({
    title: "Open With smoke",
    width: 620,
    height: 520,
    decorated: false,
  });
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
            id: "editor.desktop",
            name: "Duplicate Editor Association",
            description: "A malformed duplicate must be ignored",
            recommended: true,
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
        standalone
        onDrag={() => win.beginMove()}
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

  platformWindow.injectPointer({
    type: "down",
    x: 320,
    y: 42,
    button: "left",
    timeMs: 4,
  });
  assert.equal(
    platformWindow.moveRequests,
    1,
    "Standalone picker header should begin an interactive window move",
  );

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
  buttonRecipeSmoke();
  textFieldRecipeSmoke();
  tabsRecipeSmoke();
  menuRecipeSmoke();
  formControlRecipeSmoke();
  collectionRecipeSmoke();
  await collectionFocusRecipeSmoke();
  await textFieldInteractionSmoke();
  await searchFieldInteractionSmoke();
  await menuItemInteractionSmoke();
  await formControlInteractionSmoke();
  await tabsInteractionSmoke();
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
