/** Screenshot naming, save targets and gesture edits, without rendering. */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  displayFolder,
  editedName,
  gestureEdit,
  saveTarget,
  screenshotName,
  type Gesture,
} from "./model";

assert.equal(
  screenshotName(new Date(2026, 0, 2, 3, 4, 5)),
  "Screenshot 2026-01-02 at 03.04.05.png",
  "names sort by time and avoid characters some filesystems refuse",
);
assert.equal(editedName("/pictures/Holiday.PNG"), "Holiday (edited).png");

const folder = "/pictures/shots";
assert.equal(saveTarget("Shot.png", folder), "/pictures/shots/Shot.png");
assert.equal(saveTarget("  Shot  ", folder), "/pictures/shots/Shot.png", "bare names get .png");
assert.equal(saveTarget("/tmp/elsewhere.png", folder), "/tmp/elsewhere.png");
assert.equal(saveTarget("~/Desktop/a.png", folder), path.join(os.homedir(), "Desktop/a.png"));
assert.equal(saveTarget("notes.txt", folder), "/pictures/shots/notes.txt", "other types stay");
assert.equal(displayFolder(path.join(os.homedir(), "Pictures")), "~/Pictures");
assert.equal(displayFolder("/srv/shots"), "/srv/shots");

const image = { width: 10, height: 10, rgba: new Uint8Array(400) };
const drag: Gesture = {
  start: { x: 8, y: 2 },
  points: [
    { x: 8, y: 2 },
    { x: 3, y: 7 },
  ],
  end: { x: 3, y: 7 },
};
assert.deepEqual(gestureEdit("crop", drag, image, "#FF0000"), {
  kind: "crop",
  bounds: { x: 3, y: 2, width: 5, height: 5 },
});
assert.equal(gestureEdit("pen", drag, image, "#00FF00").kind, "pen");
assert.deepEqual(gestureEdit("rectangle", drag, image, "#0000FF"), {
  kind: "rectangle",
  bounds: { x: 3, y: 2, width: 5, height: 5 },
  color: [0, 0, 255, 255],
  width: 4,
});
const still = { start: drag.start, points: [drag.start], end: drag.start };
assert.throws(() => gestureEdit("crop", still, image, "#FF0000"), /positive width/);
assert.throws(() => gestureEdit("pen", drag, image, "red"), /#RRGGBB/);
console.log("[screenshot/model] names, save targets, folders and gesture edits passed");
