/** Image Viewer's state transitions and folder navigation, without rendering. */
import assert from "node:assert/strict";
import { folderPosition, initialState, isImage, neighbour, reduce, sortImages } from "./model";

const folder = sortImages(["/p/img10.png", "/p/img2.png", "/p/Img1.JPG"]);
assert.deepEqual(folder, ["/p/Img1.JPG", "/p/img2.png", "/p/img10.png"], "natural name order");
assert.ok(isImage("/p/photo.TIFF") && !isImage("/p/notes.txt"));
assert.deepEqual(folderPosition(folder, "/p/img2.png"), { index: 1, total: 3 });
assert.equal(folderPosition(folder, "/elsewhere/x.png"), null);
assert.equal(neighbour(folder, "/p/img2.png", 1), "/p/img10.png");
assert.equal(neighbour(folder, "/p/img10.png", 1), null, "no wrap past the last image");
assert.equal(neighbour(folder, "/p/Img1.JPG", -1), null, "no wrap before the first image");

let state = initialState("file:///p/img2.png");
assert.deepEqual(state, {
  kind: "open",
  file: "/p/img2.png",
  turns: 0,
  attempt: 0,
});
state = reduce(state, { type: "rotate", by: -1 });
state = reduce(state, { type: "retry" });
assert.deepEqual(state, {
  kind: "open",
  file: "/p/img2.png",
  turns: -1,
  attempt: 1,
});
state = reduce(state, { type: "open", file: "/p/img10.png" });
assert.equal(state.kind === "open" && state.turns, 0, "another image starts unrotated");
assert.equal(initialState("https://example.com/a.png").kind, "empty", "remote URLs are refused");
assert.equal(reduce(state, { type: "close", error: "x" }).kind, "empty");
console.log("[image-viewer/model] natural folder order, neighbours, rotation and file URLs passed");
