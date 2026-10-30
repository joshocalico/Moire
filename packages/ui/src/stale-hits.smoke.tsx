/** Input that arrives after a React commit but before the next frame reaches the current handlers. */
import assert from "node:assert/strict";
import React, { useEffect, useState } from "react";
import { Rect } from "@moire/react-host";
import { Window } from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

const backend = new HeadlessPlatform();
await backend.connect();
const window = new Window({ title: "Stale hits", width: 100, height: 100 });
const seen: string[] = [];
let load: (value: string) => void = () => {};
function Loader() {
  const [value, setValue] = useState("loading");
  useEffect(() => {
    load = setValue;
  }, []);
  return <Rect width={100} height={100} fill={0xff000000} onPress={() => seen.push(value)} />;
}
window.setContent(<Loader />);
window.mount(backend);
window.tick();
const native = backend.getWindows()[0]!;
// An asynchronous result commits (as a folder listing does) and input arrives before a frame.
load("loaded");
await new Promise((resolve) => setTimeout(resolve, 0));
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
native.injectPointer({ type: "down", button: "left", x: 50, y: 50, modifiers, timeMs: 1 });
native.injectPointer({ type: "up", button: "left", x: 50, y: 50, modifiers, timeMs: 2 });
assert.deepEqual(seen, ["loaded"], "the press reaches the handler from the latest commit");
window.destroy();
backend.disconnect();
console.log("[ui/stale-hits] input after an asynchronous commit uses current handlers");
