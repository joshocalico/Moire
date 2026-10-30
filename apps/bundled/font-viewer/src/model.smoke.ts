/** Font Viewer's state transitions and install messages, without rendering. */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_SAMPLE,
  initialState,
  installMessage,
  isFontFile,
  reduce,
  type FontState,
} from "./model";

assert.ok(isFontFile("/f/A.TTF") && isFontFile("/f/b.ttc"));
assert.ok(!isFontFile("/f/a.woff2"));

let state: FontState = initialState("file:///fonts/a.ttf");
assert.equal(state.kind === "open" && state.file, "/fonts/a.ttf");
state = reduce(state, { type: "mode", mode: "tester" });
state = reduce(state, { type: "draft", sample: "Hello" });
assert.equal(
  state.kind === "open" && state.tester.rendered.sample,
  DEFAULT_SAMPLE,
  "drafts render on Preview only",
);
state = reduce(state, { type: "page", page: 2 });
state = reduce(state, { type: "preview" });
assert.deepEqual(state.kind === "open" && state.tester.rendered, {
  sample: "Hello",
  size: 36,
  page: 0,
});
for (let step = 0; step < 30; step++) state = reduce(state, { type: "resize", by: 1 });
assert.equal(state.kind === "open" && state.tester.rendered.size, 96, "size stops at 96");

// Installs report against their own font only.
state = reduce(state, {
  type: "install-state",
  file: "/fonts/other.ttf",
  install: { kind: "installing" },
});
assert.equal(state.kind === "open" && state.install.kind, "unknown");
state = reduce(state, {
  type: "install-state",
  file: "/fonts/a.ttf",
  install: { kind: "installing" },
});
assert.equal(state.kind === "open" && state.install.kind, "installing");

// Another font keeps the view and the sample but forgets the install state.
state = reduce(state, { type: "open", file: "/fonts/b.otf" });
assert.ok(state.kind === "open" && state.mode === "tester" && state.install.kind === "unknown");
assert.equal(state.kind === "open" && state.tester.draft, "Hello");

const target = path.join(os.homedir(), ".local/share/fonts/a.ttf");
assert.equal(
  installMessage({
    kind: "installed",
    result: { path: target, copied: true, cache: { kind: "refreshed" } },
  }),
  "Installed in ~/.local/share/fonts/a.ttf · font cache refreshed",
);
assert.match(
  installMessage({
    kind: "installed",
    result: { path: target, copied: true, cache: { kind: "unavailable" } },
  })!,
  /fc-cache isn't installed/,
);
assert.equal(installMessage({ kind: "not-installed" }), null);
assert.equal(initialState("http://x/a.ttf").kind, "empty");
console.log(
  "[font-viewer/model] tester preview/size bounds, install scoping, reopen and messages passed",
);
