/** TextArea soft wrap, programmatic selection/replace, selection reports and highlights. */
import assert from "node:assert/strict";
import React, { useState } from "react";
import { TextArea, Window, installUiFonts, type TextAreaCommand, type TextRange } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

await installUiFonts();
const backend = new HeadlessPlatform();
await backend.connect();
type SceneNode = {
  kind: string;
  text?: string;
  fill?: number;
  children: SceneNode[];
};
const scene = (window: Window) => (window as unknown as { root: { container: SceneNode } }).root;
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" && node.text ? [node.text] : []),
  ...node.children.flatMap(texts),
];
const count = (node: SceneNode, fill: number): number =>
  (node.kind === "rect" && node.fill === fill ? 1 : 0) +
  node.children.reduce((sum, child) => sum + count(child, fill), 0);

let value = "",
  selection = { anchor: -1, focus: -1 };
let issue: (command: TextAreaCommand) => void = () => {};
function Fixture(props: { initial: string; wrap?: boolean; highlights?: TextRange[] }) {
  const [text, setText] = useState(props.initial);
  const [command, setCommand] = useState<TextAreaCommand | undefined>();
  issue = setCommand;
  return (
    <TextArea
      width={160}
      height={120}
      autoFocus
      value={text}
      wrap={props.wrap}
      lineNumbers
      fontFamily="mono"
      highlights={props.highlights}
      command={command}
      onSelectionChange={(next) => {
        selection = next;
      }}
      onChange={(next) => {
        value = next;
        setText(next);
      }}
    />
  );
}
async function mount(node: React.ReactNode) {
  const window = new Window({
    title: "TextArea commands",
    width: 160,
    height: 120,
  });
  window.setContent(node);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows().at(-1)!;
  const key = (code: number, name: string, text?: string, ctrl = false) => {
    native.injectKey({
      type: "down",
      code,
      key: name,
      text,
      timeMs: code,
      modifiers: { ctrl, shift: false, alt: false, meta: false },
    });
    window.tick();
  };
  const settle = async () => {
    await Promise.resolve();
    window.tick();
  };
  return { window, key, settle };
}

// Soft wrap: one long line becomes several rows, and Down moves between them.
const prose = "alpha beta gamma delta epsilon zeta eta theta iota";
{
  const wrapped = await mount(<Fixture initial={prose} wrap />);
  const rows = texts(scene(wrapped.window).container).filter((text) => text !== "1");
  assert.ok(rows.length >= 3, `a long line wraps into rows: ${JSON.stringify(rows)}`);
  assert.equal(rows.join(""), prose, "wrapped rows keep every character, breaking after spaces");
  assert.ok(
    rows.slice(0, -1).every((row) => row.endsWith(" ")),
    "rows break at word boundaries",
  );
  wrapped.key(102, "Home", undefined, true);
  wrapped.key(108, "ArrowDown");
  assert.equal(selection.focus, rows[0]!.length, "Down moves to the next wrapped row");
  wrapped.window.destroy();
  const unwrapped = await mount(<Fixture initial={prose} />);
  assert.deepEqual(
    texts(scene(unwrapped.window).container).filter((text) => text !== "1"),
    [prose],
    "without wrap a line stays one row",
  );
  unwrapped.window.destroy();
}

// Programmatic selection is reported and replaced by typing; a replace command is undoable.
{
  const editor = await mount(<Fixture initial={prose} />);
  issue({ select: { anchor: 6, focus: 10 } });
  await editor.settle();
  assert.deepEqual(selection, { anchor: 6, focus: 10 });
  editor.key(0, "B", "B");
  assert.equal(value, prose.replace("beta", "B"));
  issue({
    replace: { from: 0, to: 5, text: "ALPHA" },
    select: { anchor: 0, focus: 5 },
  });
  await editor.settle();
  assert.equal(value, prose.replace("beta", "B").replace("alpha", "ALPHA"));
  assert.deepEqual(selection, { anchor: 0, focus: 5 });
  editor.key(44, "z", undefined, true);
  assert.equal(value, prose.replace("beta", "B"), "a replace command is one undo step");
  editor.key(44, "z", undefined, true);
  assert.equal(value, prose, "earlier typing is still undoable after a command");
  editor.window.destroy();
}

// A selection far down the document scrolls into view.
{
  const lines = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
  const long = await mount(<Fixture initial={lines} />);
  assert.ok(!texts(scene(long.window).container).includes("line 150"));
  const start = lines.indexOf("line 150\n");
  issue({ select: { anchor: start, focus: start } });
  await long.settle();
  assert.ok(texts(scene(long.window).container).includes("line 150"), "selection is revealed");
  long.window.destroy();
}

// Highlights paint only where their ranges are.
{
  const highlighted = await mount(
    <Fixture
      initial={"one two\nthree two\nfour"}
      highlights={[
        { from: 4, to: 7 },
        { from: 14, to: 17 },
      ]}
    />,
  );
  assert.equal(count(scene(highlighted.window).container, 0x66f2b640), 2);
  highlighted.window.destroy();
}
backend.disconnect();
console.log("TextArea wrap, commands, selection reports, reveal and highlights passed");
